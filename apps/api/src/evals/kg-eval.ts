// src/evals/kg-eval.ts — Knowledge Graph eval scenarios

import { MemoryService } from '../api/service.js';
import * as fs from 'node:fs';

const STORAGE_DIR = '/tmp/scratchpad/seme-kg-eval';
const EMBEDDING_DIM = 4;

function cleanup(dir: string) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
}

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  time_ms: number;
}

async function runTest(name: string, fn: (svc: MemoryService) => Promise<{ passed: boolean; details: string }>): Promise<TestResult> {
  const dir = STORAGE_DIR + '-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  cleanup(dir);
  const svc = new MemoryService({ storageDir: dir, embeddingDim: EMBEDDING_DIM });
  await svc.seedIdentityCore({ name: 'Test' }, 'Test user.');
  const start = Date.now();
  try {
    const result = await fn(svc);
    const time_ms = Date.now() - start;
    svc.close();
    return { name, ...result, time_ms };
  } catch (e: any) {
    const time_ms = Date.now() - start;
    svc.close();
    return { name, passed: false, details: `EXCEPTION: ${e.message}`, time_ms };
  }
}

const tests: { name: string; fn: (svc: MemoryService) => Promise<{ passed: boolean; details: string }> }[] = [];

// Helper: create a populated graph
async function populateGraph(svc: MemoryService) {
  const t = await svc.recordTurn('s1', 'user', 'I work at Ponti Studios in Edinburgh. My wife Sarah is a doctor. I use TypeScript.');
  const episode = (svc as any).ingest.getOpenEpisode('s1');
  await svc.endSession('s1');
  const charles = svc.createEntity('Charles', 'person', [], 'User', 'user_stated', 0.9);
  const ponti = svc.createEntity('Ponti Studios', 'organization', [], 'Company', 'user_stated', 0.9);
  const edinburgh = svc.createEntity('Edinburgh', 'place', [], 'City', 'user_stated', 0.9);
  const sarah = svc.createEntity('Sarah', 'person', ['wife'], 'Doctor', 'user_stated', 0.9);
  const ts = svc.createEntity('TypeScript', 'tool', ['TS'], 'Language', 'user_stated', 0.9);
  svc.createRelationship(charles, ponti, 'works_at', 'Charles works at Ponti Studios', t.turn_id, episode.id);
  svc.createRelationship(ponti, edinburgh, 'located_in', 'Ponti Studios is in Edinburgh', t.turn_id, episode.id);
  svc.createRelationship(charles, sarah, 'married_to', 'Charles is married to Sarah', t.turn_id, episode.id);
  svc.createRelationship(charles, ts, 'uses', 'Charles uses TypeScript', t.turn_id, episode.id);
  return { charles, ponti, edinburgh, sarah, ts, t, episode };
}

// --- Entity CRUD ---
tests.push({
  name: 'KG-CRUD: create and get entity',
  fn: async (svc) => {
    const id = svc.createEntity('Sarah', 'person', ['wife'], 'Doctor', 'user_stated', 0.9);
    const entity = svc.getEntity(id);
    return { passed: entity !== null && entity.name === 'Sarah' && entity.type === 'person', details: `Entity: ${entity?.name} (${entity?.type})` };
  },
});

tests.push({
  name: 'KG-CRUD: get entity by name (alias match)',
  fn: async (svc) => {
    svc.createEntity('John', 'person', ['Johnny'], 'Friend', 'user_stated', 0.9);
    const entity = svc.getEntityByName('Johnny');
    return { passed: entity !== null && entity.name === 'John', details: `Found: ${entity?.name}` };
  },
});

tests.push({
  name: 'KG-CRUD: list entities by type',
  fn: async (svc) => {
    await populateGraph(svc);
    const tools = svc.listEntities('tool');
    return { passed: tools.total >= 1 && tools.entities.every(e => e.type === 'tool'), details: `Tools: ${tools.total}` };
  },
});

tests.push({
  name: 'KG-CRUD: update entity',
  fn: async (svc) => {
    const id = svc.createEntity('Sarah', 'person', [], 'Doctor', 'user_stated', 0.9);
    svc.updateEntity(id, { aliases: ['wife'], description: 'Wife and doctor' });
    const entity = svc.getEntity(id);
    return { passed: !!entity?.aliases.includes('wife') && entity?.description === 'Wife and doctor', details: `Aliases: ${entity?.aliases}, Desc: ${entity?.description}` };
  },
});

tests.push({
  name: 'KG-CRUD: delete entity (cascade)',
  fn: async (svc) => {
    const { charles, ts } = await populateGraph(svc);
    const before = svc.getGraphSnapshot();
    svc.deleteEntity(ts);
    const after = svc.getGraphSnapshot();
    return { passed: after.entities.length === before.entities.length - 1 && after.relationships.length < before.relationships.length, details: `Before: ${before.entities.length}e/${before.relationships.length}r, After: ${after.entities.length}e/${after.relationships.length}r` };
  },
});

// --- Relationships ---
tests.push({
  name: 'KG-Rel: create and get relationship',
  fn: async (svc) => {
    const { charles, ponti, t, episode } = await populateGraph(svc);
    const rels = svc.listRelationships(charles, ponti, 'works_at');
    return { passed: rels.total >= 1, details: `Relationships: ${rels.total}` };
  },
});

tests.push({
  name: 'KG-Rel: list by source',
  fn: async (svc) => {
    const { charles } = await populateGraph(svc);
    const rels = svc.listRelationships(charles);
    return { passed: rels.total >= 3, details: `Rels from Charles: ${rels.total}` };
  },
});

tests.push({
  name: 'KG-Rel: delete relationship',
  fn: async (svc) => {
    const { charles, ponti } = await populateGraph(svc);
    const rels = svc.listRelationships(charles, ponti, 'works_at');
    if (rels.total === 0) return { passed: false, details: 'No relationship found' };
    svc.deleteRelationship(rels.relationships[0].id);
    const after = svc.listRelationships(charles, ponti, 'works_at');
    return { passed: after.total === 0, details: `After delete: ${after.total}` };
  },
});

// --- Traversal ---
tests.push({
  name: 'KG-Traverse: neighborhood 1-hop',
  fn: async (svc) => {
    const { charles } = await populateGraph(svc);
    const neigh = svc.getNeighborhood(charles, 1);
    // Charles → Ponti Studios, Sarah, TypeScript (1-hop) + Charles itself
    return { passed: neigh.entities.length >= 3, details: `Entities: ${neigh.entities.map(e => e.name).join(', ')}` };
  },
});

tests.push({
  name: 'KG-Traverse: neighborhood 2-hop',
  fn: async (svc) => {
    const { charles } = await populateGraph(svc);
    const neigh = svc.getNeighborhood(charles, 2);
    // Should include Edinburgh (via Ponti Studios)
    const hasEdinburgh = neigh.entities.some(e => e.name === 'Edinburgh');
    return { passed: hasEdinburgh, details: `Entities: ${neigh.entities.map(e => e.name).join(', ')}` };
  },
});

tests.push({
  name: 'KG-Traverse: find path',
  fn: async (svc) => {
    const { charles, edinburgh } = await populateGraph(svc);
    const path = svc.findPath(charles, edinburgh);
    return { passed: path !== null && path.path.length >= 2, details: `Path: ${path?.path.map(e => e.name).join(' → ')}` };
  },
});

tests.push({
  name: 'KG-Traverse: no path returns null',
  fn: async (svc) => {
    const { charles } = await populateGraph(svc);
    const isolated = svc.createEntity('Isolated', 'concept', [], 'No connections', 'user_stated', 0.9);
    const path = svc.findPath(charles, isolated);
    return { passed: path === null, details: `Path: ${path}` };
  },
});

tests.push({
  name: 'KG-Traverse: graph snapshot',
  fn: async (svc) => {
    const { charles } = await populateGraph(svc);
    const snap = svc.getGraphSnapshot();
    return { passed: snap.entities.length >= 5 && snap.relationships.length >= 4, details: `Entities: ${snap.entities.length}, Rels: ${snap.relationships.length}` };
  },
});

// --- Retrieval ---
tests.push({
  name: 'KG-Retrieve: graph summary in context',
  fn: async (svc) => {
    const { charles } = await populateGraph(svc);
    const ctx = svc.retrieveContext('s2', 'Where does Charles work?');
    return { passed: ctx.graph_summary !== undefined && ctx.graph_summary.entities.length > 0, details: `Graph entities: ${ctx.graph_summary?.entities.length}, rels: ${ctx.graph_summary?.relationships.length}` };
  },
});

tests.push({
  name: 'KG-Retrieve: entity lookup by name',
  fn: async (svc) => {
    const { charles } = await populateGraph(svc);
    const entity = svc.getEntityByName('Charles');
    return { passed: entity !== null && entity.name === 'Charles', details: `Found: ${entity?.name}` };
  },
});

// --- Profile ---
tests.push({
  name: 'KG-Profile: entity-centric sections',
  fn: async (svc) => {
    const { ponti, edinburgh } = await populateGraph(svc);
    svc.updateEntity(ponti, { profile_included: 1 });
    svc.updateEntity(edinburgh, { profile_included: 1 });
    await (svc as any).profileCompiler.compile('manual', []);
    const profile = svc.getProfile();
    return { passed: profile.profile_text.includes('## Entities') && profile.profile_text.includes('## Relationships'), details: `Has Entities: ${profile.profile_text.includes('## Entities')}, Has Rels: ${profile.profile_text.includes('## Relationships')}` };
  },
});

// --- Sleep Job ---
tests.push({
  name: 'KG-Sleep: graph dedup merges duplicate entities',
  fn: async (svc) => {
    const { charles } = await populateGraph(svc);
    // Create duplicate entity
    svc.createEntity('Ponti Studios', 'organization', ['Ponti'], 'Duplicate', 'user_stated', 0.8);
    const before = svc.getGraphSnapshot().entities.length;
    await svc.runSleepJob('manual');
    const after = svc.getGraphSnapshot().entities.length;
    return { passed: after < before, details: `Before: ${before}, After: ${after}` };
  },
});

tests.push({
  name: 'KG-Sleep: graph contradiction detection',
  fn: async (svc) => {
    const { charles, edinburgh } = await populateGraph(svc);
    const london = svc.createEntity('London', 'place', [], 'City', 'user_stated', 0.9);
    const t = (await svc.recordTurn('s1', 'user', 'I live in London.')).turn_id;
    const episode = (svc as any).ingest.getOpenEpisode('s1');
    svc.createRelationship(charles, edinburgh, 'lives_in', 'Lives in Edinburgh', t, episode.id);
    svc.createRelationship(charles, london, 'lives_in', 'Lives in London', t, episode.id);
    await svc.runSleepJob('manual');
    const reviews = svc.reviewQueueList();
    return { passed: reviews.total > 0, details: `Review items: ${reviews.total}` };
  },
});

// --- Pipeline Integration ---
tests.push({
  name: 'KG-Pipeline: entities extracted from conversation',
  fn: async (svc) => {
    await svc.recordTurn('s1', 'user', 'I work at Ponti Studios in Edinburgh. I use TypeScript.');
    await svc.recordTurn('s1', 'assistant', 'Noted.');
    await svc.endSession('s1');
    await new Promise(r => setTimeout(r, 20000));
    const snap = svc.getGraphSnapshot();
    return { passed: snap.entities.length > 0, details: `Entities: ${snap.entities.length}, Rels: ${snap.relationships.length}` };
  },
});

// --- Entity Types ---
tests.push({
  name: 'KG-Types: all 9 entity types accepted',
  fn: async (svc) => {
    const types = ['person', 'place', 'organization', 'project', 'tool', 'concept', 'topic', 'preference', 'other'];
    let allPassed = true;
    for (const type of types) {
      try {
        svc.createEntity(`Test ${type}`, type, [], 'Test', 'user_stated', 0.9);
      } catch (e: any) {
        allPassed = false;
      }
    }
    return { passed: allPassed, details: allPassed ? `All ${types.length} types accepted` : 'Some types rejected' };
  },
});

tests.push({
  name: 'KG-Types: invalid entity type rejected',
  fn: async (svc) => {
    try {
      svc.createEntity('Test', 'invalid_type', [], 'Test', 'user_stated', 0.9);
      return { passed: false, details: 'Invalid type was accepted' };
    } catch (e: any) {
      return { passed: true, details: 'Invalid type rejected' };
    }
  },
});

async function main() {
  console.log('=== Seme Knowledge Graph Eval Suite ===\\n');
  const results: TestResult[] = [];
  let passed = 0;
  let total = 0;

  for (const test of tests) {
    const result = await runTest(test.name, test.fn);
    results.push(result);
    total++;
    if (result.passed) passed++;
    console.log(`${result.passed ? '✓' : '✗'} ${result.name} (${result.time_ms}ms)`);
    if (!result.passed) console.log(`   ${result.details}`);
  }

  console.log(`\\n${'='.repeat(70)}`);
  console.log(`TOTAL: ${passed}/${total} (${((passed/total)*100).toFixed(1)}%)`);
  console.log(`Total time: ${results.reduce((s, r) => s + r.time_ms, 0)}ms`);
  console.log('='.repeat(70));

  const report = { timestamp: new Date().toISOString(), passed, total, percentage: ((passed/total)*100).toFixed(1), results };
  fs.writeFileSync('/tmp/scratchpad/seme-kg-eval-results.json', JSON.stringify(report, null, 2));
  console.log('\\nResults written to /tmp/scratchpad/seme-kg-eval-results.json');
}

main().catch(console.error);