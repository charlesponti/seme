// src/scripts/api-complex-test.ts — Complex API request pattern tests

import { MemoryService } from '../api/service.js';
import * as fs from 'node:fs';

const STORAGE_DIR = '/tmp/scratchpad/seme-api-complex';
const EMBEDDING_DIM = 4;

function cleanup() {
  if (fs.existsSync(STORAGE_DIR)) fs.rmSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

interface TestResult {
  name: string;
  passed: boolean;
  details: string;
  time_ms: number;
}

async function runTest(name: string, fn: (seme: MemoryService) => Promise<{ passed: boolean; details: string }>): Promise<TestResult> {
  const testDir = `/tmp/scratchpad/seme-api-complex/${name.replace(/[^a-z0-9]/gi, '-')}`;
  if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  fs.mkdirSync(testDir, { recursive: true });
  const seme = new MemoryService({ storageDir: testDir, embeddingDim: EMBEDDING_DIM });
  await seme.seedIdentityCore({ name: 'Charles' }, 'The user is Charles Ponti.');
  const start = Date.now();
  try {
    const result = await fn(seme);
    const time_ms = Date.now() - start;
    seme.close();
    return { name, ...result, time_ms };
  } catch (e: any) {
    const time_ms = Date.now() - start;
    seme.close();
    return { name, passed: false, details: `EXCEPTION: ${e.message}`, time_ms };
  }
}

const tests: { name: string; fn: (seme: MemoryService) => Promise<{ passed: boolean; details: string }> }[] = [];

// ============================================================
// PATTERN 1: Full conversation lifecycle
// ============================================================

tests.push({
  name: 'API-1: Record → End → Extract → Retrieve → Profile',
  fn: async (seme) => {
    await seme.recordTurn('s1', 'user', 'I prefer dark mode for all my editors.');
    await seme.recordTurn('s1', 'assistant', 'Noted! Dark mode it is.');
    await seme.recordTurn('s1', 'user', 'I also drink coffee every morning.');
    const endResult = await seme.endSession('s1');
    await new Promise(r => setTimeout(r, 20000));
    const ctx = seme.retrieveContext('s2', 'What does the user prefer?');
    const profile = seme.getProfile();
    return {
      passed: ctx.memories.length > 0 && profile.profile_text.length > 0 && endResult.accepted,
      details: `Memories: ${ctx.memories.length}, Profile: ${profile.profile_text.length} chars, Abstain: ${ctx.abstain}`
    };
  },
});

tests.push({
  name: 'API-2: Multi-session accumulation',
  fn: async (seme) => {
    for (let i = 0; i < 5; i++) {
      await seme.recordTurn(`s${i}`, 'user', `I like programming language number ${i}.`);
      await seme.endSession(`s${i}`);
    }
    await new Promise(r => setTimeout(r, 30000));
    const ctx = seme.retrieveContext('s5', 'programming');
    const profile = seme.getProfile();
    return {
      passed: ctx.memories.length > 0 && profile.profile_text.length > 20,
      details: `Memories: ${ctx.memories.length}, Profile: ${profile.profile_text.length} chars`
    };
  },
});

// ============================================================
// PATTERN 2: Graph CRUD + Traversal + Search
// ============================================================

tests.push({
  name: 'API-3: Create entity → create relationship → traverse → search',
  fn: async (seme) => {
    const t = await seme.recordTurn('s1', 'user', 'Test.');
    const episode = (seme as any).ingest.getOpenEpisode('s1');
    await seme.endSession('s1');
    const charles = seme.createEntity('Charles', 'person', [], 'User', 'user_stated', 0.9);
    const ponti = seme.createEntity('Ponti Studios', 'organization', [], 'Company', 'user_stated', 0.9);
    const edinburgh = seme.createEntity('Edinburgh', 'place', [], 'City', 'user_stated', 0.9);
    seme.createRelationship(charles, ponti, 'works_at', 'works at', t.turn_id, episode.id);
    seme.createRelationship(ponti, edinburgh, 'located_in', 'located in', t.turn_id, episode.id);
    const neigh = seme.getNeighborhood(charles, 2);
    const path = seme.findPath(charles, edinburgh);
    const snap = seme.getGraphSnapshot();
    return {
      passed: neigh.entities.length >= 3 && path !== null && snap.entities.length >= 3,
      details: `Neighborhood: ${neigh.entities.length} entities, Path: ${path?.path.map(e => e.name).join('→')}, Snapshot: ${snap.entities.length}e/${snap.relationships.length}r`
    };
  },
});

tests.push({
  name: 'API-4: Graph search returns graph_summary',
  fn: async (seme) => {
    const t = await seme.recordTurn('s1', 'user', 'Test.');
    const episode = (seme as any).ingest.getOpenEpisode('s1');
    await seme.endSession('s1');
    const charles = seme.createEntity('Charles', 'person', [], 'User', 'user_stated', 0.9);
    const ponti = seme.createEntity('Ponti Studios', 'organization', [], 'Company', 'user_stated', 0.9);
    seme.createRelationship(charles, ponti, 'works_at', 'works at', t.turn_id, episode.id);
    const ctx = seme.retrieveContext('s2', 'Charles');
    return {
      passed: ctx.graph_summary !== undefined && ctx.graph_summary.entities.length > 0,
      details: `Graph entities: ${ctx.graph_summary?.entities.length}, rels: ${ctx.graph_summary?.relationships.length}`
    };
  },
});

// ============================================================
// PATTERN 3: Memory lifecycle
// ============================================================

tests.push({
  name: 'API-5: Remember → Correct → Forget → Verify',
  fn: async (seme) => {
    const t = await seme.recordTurn('s1', 'user', 'I live in London.');
    const r = await seme.rememberCommand('s1', 'I live in London.', t.turn_id, 'fact');
    // Correct
    const corrected = await seme.correctMemory(r.memory_id, 'I live in Edinburgh.');
    // Verify corrected memory exists
    const mem = seme.getMemory(corrected.new_memory_id);
    // Forget
    await seme.forgetCommand('memory', corrected.new_memory_id);
    // Verify forgotten
    let forgotten = false;
    try { seme.getMemory(corrected.new_memory_id); } catch (e: any) { forgotten = e.message.includes('ERR_NOT_FOUND'); }
    return {
      passed: mem.status === 'active' && mem.source_type === 'user_edited' && forgotten,
      details: `Corrected: ${corrected.new_memory_id}, Forgotten: ${forgotten}`
    };
  },
});

tests.push({
  name: 'API-6: Remember → List → Filter by kind',
  fn: async (seme) => {
    const t1 = await seme.recordTurn('s1', 'user', 'I decided to use X.');
    await seme.rememberCommand('s1', 'I decided to use X.', t1.turn_id, 'decision');
    const t2 = await seme.recordTurn('s1', 'user', 'I like Python.');
    await seme.rememberCommand('s1', 'I like Python.', t2.turn_id, 'interest');
    const decisions = seme.listMemories('active', 'decision');
    const interests = seme.listMemories('active', 'interest');
    const all = seme.listMemories('active');
    return {
      passed: decisions.total >= 1 && interests.total >= 1 && all.total >= 2,
      details: `Decisions: ${decisions.total}, Interests: ${interests.total}, Total: ${all.total}`
    };
  },
});

tests.push({
  name: 'API-7: Remember → Export → Verify bundle',
  fn: async (seme) => {
    const t = await seme.recordTurn('s1', 'user', 'I like Swift.');
    await seme.rememberCommand('s1', 'I like Swift.', t.turn_id, 'interest');
    await seme.endSession('s1');
    await new Promise(r => setTimeout(r, 2000));
    const exp = await seme.exportData();
    return {
      passed: exp.memory_count >= 1 && exp.tables_included.length >= 5,
      details: `Memories: ${exp.memory_count}, Tables: ${exp.tables_included.length}`
    };
  },
});

// ============================================================
// PATTERN 4: Review queue workflow
// ============================================================

tests.push({
  name: 'API-8: Create contradiction → list → resolve → verify',
  fn: async (seme) => {
    const db = seme.getStorage().getDb();
    const now = new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z');
    db.prepare('INSERT INTO review_items (id, kind, payload_json, memory_ids, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('ri-1', 'contradiction', '{"slot":"home_city"}', '[]', 'pending', now);
    const items = seme.reviewQueueList();
    const resolved = await seme.resolveReviewItem('ri-1', 'confirm');
    const after = seme.reviewQueueList();
    return {
      passed: items.total === 1 && resolved.resolved && after.total === 0,
      details: `Before: ${items.total}, Resolved: ${resolved.resolved}, After: ${after.total}`
    };
  },
});

// ============================================================
// PATTERN 5: Adaptation store workflow
// ============================================================

tests.push({
  name: 'API-9: Feedback → aggregate → propose → lock → verify',
  fn: async (seme) => {
    const t1 = await seme.recordTurn('s1', 'user', 'Great job!');
    const ep1 = (seme as any).ingest.getOpenEpisode('s1');
    await seme.endSession('s1');
    const t2 = await seme.recordTurn('s2', 'user', 'Nice work!');
    const ep2 = (seme as any).ingest.getOpenEpisode('s2');
    await seme.endSession('s2');
    await seme.ingestFeedback({ signal_type: 'compliment_specific', target: 'register', detail_json: '{"aspect":"tone"}', episode_id: ep1.id });
    await seme.ingestFeedback({ signal_type: 'compliment_specific', target: 'register', detail_json: '{"aspect":"tone"}', episode_id: ep2.id });
    const proposals = await seme.aggregateAdaptations(2, 2);
    if (proposals.length === 0) return { passed: false, details: 'No proposals generated' };
    await seme.applyAdaptation(proposals[0].dimension);
    const state = seme.getAdaptationState(proposals[0].dimension);
    await seme.lockAdaptationDimension(proposals[0].dimension, true);
    const locked = seme.getAdaptationState(proposals[0].dimension);
    return {
      passed: proposals.length >= 1 && state?.status === 'active' && locked?.user_locked === 1,
      details: `Proposals: ${proposals.length}, State: ${state?.status}, Locked: ${locked?.user_locked}`
    };
  },
});

// ============================================================
// PATTERN 6: Sleep job with graph data
// ============================================================

tests.push({
  name: 'API-10: Sleep job with graph data → dedup + contradiction',
  fn: async (seme) => {
    const t = await seme.recordTurn('s1', 'user', 'I work at Ponti Studios.');
    const episode = (seme as any).ingest.getOpenEpisode('s1');
    await seme.endSession('s1');
    const charles = seme.createEntity('Charles', 'person', [], 'User', 'user_stated', 0.9);
    const ponti = seme.createEntity('Ponti Studios', 'organization', [], 'Company', 'user_stated', 0.9);
    const ponti2 = seme.createEntity('Ponti Studios', 'organization', ['Ponti'], 'Duplicate', 'user_stated', 0.8);
    seme.createRelationship(charles, ponti, 'works_at', 'works at', t.turn_id, episode.id);
    const london = seme.createEntity('London', 'place', [], 'City', 'user_stated', 0.9);
    const edinburgh = seme.createEntity('Edinburgh', 'place', [], 'City', 'user_stated', 0.9);
    seme.createRelationship(charles, london, 'lives_in', 'Lives in London', t.turn_id, episode.id);
    seme.createRelationship(charles, edinburgh, 'lives_in', 'Lives in Edinburgh', t.turn_id, episode.id);
    const before = seme.getGraphSnapshot().entities.length;
    const result = await seme.runSleepJob('manual');
    const after = seme.getGraphSnapshot().entities.length;
    const reviews = seme.reviewQueueList();
    return {
      passed: result.status === 'completed' && after < before && reviews.total > 0,
      details: `Sleep: ${result.status}, Entities: ${before}→${after}, Reviews: ${reviews.total}`
    };
  },
});

// ============================================================
// PATTERN 7: Error handling
// ============================================================

tests.push({
  name: 'API-11: Invalid memory ID → ERR_NOT_FOUND',
  fn: async (seme) => {
    let thrown = false;
    try { seme.getMemory('nonexistent-id'); } catch (e: any) { thrown = e.message.includes('ERR_NOT_FOUND'); }
    return { passed: thrown, details: `ERR_NOT_FOUND thrown: ${thrown}` };
  },
});

tests.push({
  name: 'API-12: Delete all without confirmation → ERR_VALIDATION',
  fn: async (seme) => {
    const t = await seme.recordTurn('s1', 'user', 'Test.');
    await seme.rememberCommand('s1', 'Test.', t.turn_id, 'fact');
    let thrown = false;
    try { await seme.forgetCommand('all', undefined, undefined, undefined, undefined, false); } catch (e: any) { thrown = e.message.includes('ERR_VALIDATION'); }
    return { passed: thrown, details: `ERR_VALIDATION thrown: ${thrown}` };
  },
});

tests.push({
  name: 'API-13: Pause blocks remember → ERR_PAUSED',
  fn: async (seme) => {
    await seme.pauseLearning();
    const t = await seme.recordTurn('s1', 'user', 'Test.');
    let thrown = false;
    try { await seme.rememberCommand('s1', 'Test.', t.turn_id, 'fact'); } catch (e: any) { thrown = e.message.includes('ERR_PAUSED'); }
    await seme.resumeLearning();
    return { passed: thrown, details: `ERR_PAUSED thrown: ${thrown}` };
  },
});

tests.push({
  name: 'API-14: Invalid entity type → error',
  fn: async (seme) => {
    let thrown = false;
    try { seme.createEntity('Test', 'invalid_type', [], 'Test', 'user_stated', 0.9); } catch (e: any) { thrown = true; }
    return { passed: thrown, details: `Error thrown: ${thrown}` };
  },
});

// ============================================================
// PATTERN 8: Pagination and filtering
// ============================================================

tests.push({
  name: 'API-15: List memories with pagination',
  fn: async (seme) => {
    for (let i = 0; i < 10; i++) {
      const t = await seme.recordTurn('s1', 'user', `Fact ${i}.`);
      await seme.rememberCommand('s1', `Fact ${i}.`, t.turn_id, 'fact');
    }
    const page1 = seme.listMemories('active', undefined, undefined, undefined, 5, 0);
    const page2 = seme.listMemories('active', undefined, undefined, undefined, 5, 5);
    return { passed: page1.memories.length === 5 && page2.memories.length === 5 && page1.total === 10, details: `Page1: ${page1.memories.length}, Page2: ${page2.memories.length}, Total: ${page1.total}` };
  },
});

tests.push({
  name: 'API-16: List entities with search filter',
  fn: async (seme) => {
    seme.createEntity('TypeScript', 'tool', [], 'Language', 'user_stated', 0.9);
    seme.createEntity('React', 'tool', [], 'Framework', 'user_stated', 0.9);
    seme.createEntity('Ponti Studios', 'organization', [], 'Company', 'user_stated', 0.9);
    const tools = seme.listEntities('tool');
    const search = seme.listEntities(undefined, 'Type');
    return { passed: tools.total === 2 && search.total === 1, details: `Tools: ${tools.total}, Search 'Type': ${search.total}` };
  },
});

async function main() {
  console.log('=== Seme API Complex Test Suite ===\\n');
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
  fs.writeFileSync('/tmp/scratchpad/seme-api-complex-results.json', JSON.stringify(report, null, 2));
  console.log('\\nResults written to /tmp/scratchpad/seme-api-complex-results.json');
}

main().catch(console.error);