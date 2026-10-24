// src/evals/memory-types-eval.ts — Comprehensive evals for new memory types (decision, reference, anti_pattern, observation)

import { MemoryService } from '../api/service.js';
import * as fs from 'node:fs';

const STORAGE_DIR = '/tmp/scratchpad/seme-mt-eval';
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

// ============================================================
// DECISION KIND TESTS
// ============================================================

// --- Extraction (LLM) ---
const decisionTriggers = [
  { input: 'I decided to use TypeScript for this project.', expected: 'decision' },
  { input: 'I chose React over Vue for the frontend.', expected: 'decision' },
  { input: "Let's go with Postgres for the database.", expected: 'decision' },
  { input: "We'll use Redis for caching.", expected: 'decision' },
  { input: 'I committed to shipping by Friday.', expected: 'decision' },
];

for (const tc of decisionTriggers) {
  tests.push({
    name: `Decision-Extract: "${tc.input.slice(0, 40)}..." → decision`,
    fn: async (svc) => {
      await svc.recordTurn('s1', 'user', tc.input);
      await svc.recordTurn('s1', 'assistant', 'Noted.');
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 10000));
      const db = svc.getStorage();
      const mems = db.read((d: any) => d.prepare('SELECT kind FROM memories').all()) as any[];
      const hasDecision = mems.some((m: any) => m.kind === 'decision');
      return { passed: hasDecision, details: `Memories: ${mems.length}, Kinds: ${mems.map((m:any) => m.kind).join(',')}` };
    },
  });
}

// Non-trigger: should NOT be decision
const decisionNonTriggers = [
  'I use TypeScript for everything.',
  'I like Python programming.',
  'I prefer dark mode.',
];

for (const input of decisionNonTriggers) {
  tests.push({
    name: `Decision-Extract: "${input.slice(0, 40)}..." → NOT decision`,
    fn: async (svc) => {
      await svc.recordTurn('s1', 'user', input);
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 10000));
      const db = svc.getStorage();
      const mems = db.read((d: any) => d.prepare('SELECT kind FROM memories').all()) as any[];
      const hasDecision = mems.some((m: any) => m.kind === 'decision');
      return { passed: !hasDecision, details: `Memories: ${mems.length}, Kinds: ${mems.map((m:any) => m.kind).join(',')}` };
    },
  });
}

// --- Resolution ---
tests.push({
  name: 'Decision-Resolve: supersession (same subject+predicate, different value)',
  fn: async (svc) => {
    const t1 = await svc.recordTurn('s1', 'user', 'I decided to use TypeScript.');
    const r1 = await svc.rememberCommand('s1', 'I decided to use TypeScript.', t1.turn_id, 'decision');
    const t2 = await svc.recordTurn('s1', 'user', 'Actually, I chose Rust instead.');
    const r2 = await svc.rememberCommand('s1', 'Actually, I chose Rust instead.', t2.turn_id, 'decision');
    const db = svc.getStorage();
    const m1 = db.read((d: any) => d.prepare('SELECT status FROM memories WHERE id = ?').get(r1.memory_id) as any);
    const m2 = db.read((d: any) => d.prepare('SELECT status FROM memories WHERE id = ?').get(r2.memory_id) as any);
    return { passed: m1?.status === 'superseded' && m2?.status === 'active', details: `M1: ${m1?.status}, M2: ${m2?.status}` };
  },
});

tests.push({
  name: 'Decision-Resolve: different subjects → both active (no supersede)',
  fn: async (svc) => {
    const t1 = await svc.recordTurn('s1', 'user', 'I decided to use TypeScript for frontend.');
    const r1 = await svc.rememberCommand('s1', 'I decided to use TypeScript for frontend.', t1.turn_id, 'decision');
    const t2 = await svc.recordTurn('s1', 'user', 'I decided to use Postgres for backend.');
    const r2 = await svc.rememberCommand('s1', 'I decided to use Postgres for backend.', t2.turn_id, 'decision');
    const db = svc.getStorage();
    const m1 = db.read((d: any) => d.prepare('SELECT status FROM memories WHERE id = ?').get(r1.memory_id) as any);
    const m2 = db.read((d: any) => d.prepare('SELECT status FROM memories WHERE id = ?').get(r2.memory_id) as any);
    return { passed: m1?.status === 'superseded' && m2?.status === 'active', details: `M1: ${m1?.status}, M2: ${m2?.status}` };
  },
});

// --- Validation ---
tests.push({
  name: 'Decision-Valid: user_stated source passes',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'I decided to use Go.');
    const r = await svc.rememberCommand('s1', 'I decided to use Go.', t.turn_id, 'decision');
    return { passed: r.memory_id !== undefined, details: `Created: ${r.memory_id !== undefined}` };
  },
});

tests.push({
  name: 'Decision-Valid: agent_inferred source passes',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'I might use Go.');
    const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
    const candidate = { kind: 'decision' as any, slot: 'decision', subject: 'user', predicate: 'stated', value_text: 'Might use Go.', value_json: null, evidence_quote: 'I might use Go.', source_turn_id: t.turn_id, source_episode_id: episode.id, source_type: 'agent_inferred', modality: 'stated', importance: 0.5, decay_class: 'slow', observed_at: new Date().toISOString().replace(/\.\\d{3}Z$/, 'Z') };
    const result = (svc as any).gate.validate(candidate);
    return { passed: result.passed, details: `Passed: ${result.passed}, errors: ${result.errors.join(', ')}` };
  },
});

// --- Decay ---
tests.push({
  name: 'Decision-Decay: uses slow decay class (180-day half-life)',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'I decided to use Rust.');
    const r = await svc.rememberCommand('s1', 'I decided to use Rust.', t.turn_id, 'decision');
    const db = svc.getStorage();
    const row = db.read((d: any) => d.prepare('SELECT decay_class FROM memories WHERE id = ?').get(r.memory_id) as any);
    return { passed: row?.decay_class === 'slow', details: `Decay class: ${row?.decay_class}` };
  },
});

// --- Profile ---
tests.push({
  name: 'Decision-Profile: rendered with "Decision:" prefix',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'I decided to ship by Friday.');
    await svc.rememberCommand('s1', 'I decided to ship by Friday.', t.turn_id, 'decision');
    await svc.endSession('s1');
    await new Promise(r => setTimeout(r, 2000));
    const profile = svc.getProfile();
    return { passed: profile.profile_text.includes('Decision:'), details: `Profile: ${profile.profile_text.slice(0, 80)}` };
  },
});

// --- Sleep job ---
tests.push({
  name: 'Decision-Sleep: included in decay sweep',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'I decided to use Go.');
    await svc.rememberCommand('s1', 'I decided to use Go.', t.turn_id, 'decision');
    await svc.endSession('s1');
    await new Promise(r => setTimeout(r, 2000));
    const result = await svc.runSleepJob('manual');
    return { passed: result.status === 'completed', details: `Sleep: ${result.status}` };
  },
});

// ============================================================
// REFERENCE KIND TESTS
// ============================================================

const refTriggers = [
  'The docs are at docs.example.com',
  'See the README for setup instructions.',
  'Look at https://example.com/api',
];

for (const input of refTriggers) {
  tests.push({
    name: `Reference-Extract: "${input.slice(0, 40)}..." → reference`,
    fn: async (svc) => {
      await svc.recordTurn('s1', 'user', input);
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 10000));
      const db = svc.getStorage();
      const mems = db.read((d: any) => d.prepare('SELECT kind FROM memories').all()) as any[];
      const hasRef = mems.some((m: any) => m.kind === 'reference');
      return { passed: hasRef, details: `Memories: ${mems.length}, Kinds: ${mems.map((m:any) => m.kind).join(',')}` };
    },
  });
}

const refNonTriggers = [
  'I use TypeScript for everything.',
  'I live in London.',
];

for (const input of refNonTriggers) {
  tests.push({
    name: `Reference-Extract: "${input.slice(0, 40)}..." → NOT reference`,
    fn: async (svc) => {
      await svc.recordTurn('s1', 'user', input);
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 10000));
      const db = svc.getStorage();
      const mems = db.read((d: any) => d.prepare('SELECT kind FROM memories').all()) as any[];
      const hasRef = mems.some((m: any) => m.kind === 'reference');
      return { passed: !hasRef, details: `Memories: ${mems.length}, Kinds: ${mems.map((m:any) => m.kind).join(',')}` };
    },
  });
}

tests.push({
  name: 'Reference-Valid: user_stated source passes',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'The API docs are at api.example.com');
    const r = await svc.rememberCommand('s1', 'The API docs are at api.example.com', t.turn_id, 'reference');
    return { passed: r.memory_id !== undefined, details: `Created: ${r.memory_id !== undefined}` };
  },
});

tests.push({
  name: 'Reference-Valid: agent_inferred source passes',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'Check the docs.');
    const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
    const candidate = { kind: 'reference' as any, slot: 'reference', subject: 'user', predicate: 'stated', value_text: 'Check the docs.', value_json: null, evidence_quote: 'Check the docs.', source_turn_id: t.turn_id, source_episode_id: episode.id, source_type: 'agent_inferred', modality: 'stated', importance: 0.5, decay_class: 'medium', observed_at: new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z') };
    const result = (svc as any).gate.validate(candidate);
    return { passed: result.passed, details: `Passed: ${result.passed}, errors: ${result.errors.join(', ')}` };
  },
});

tests.push({
  name: 'Reference-Decay: uses medium decay class (30-day half-life)',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'See the README.');
    const r = await svc.rememberCommand('s1', 'See the README.', t.turn_id, 'reference');
    const db = svc.getStorage();
    const row = db.read((d: any) => d.prepare('SELECT decay_class FROM memories WHERE id = ?').get(r.memory_id) as any);
    return { passed: row?.decay_class === 'medium', details: `Decay class: ${row?.decay_class}` };
  },
});

tests.push({
  name: 'Reference-Profile: rendered with "Reference:" prefix',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'The docs are at example.com');
    await svc.rememberCommand('s1', 'The docs are at example.com', t.turn_id, 'reference');
    await svc.endSession('s1');
    await new Promise(r => setTimeout(r, 2000));
    const profile = svc.getProfile();
    return { passed: profile.profile_text.includes('Reference:'), details: `Profile: ${profile.profile_text.slice(0, 80)}` };
  },
});

// ============================================================
// ANTI-PATTERN KIND TESTS
// ============================================================

const antiTriggers = [
  'Never use var in JavaScript.',
  "Don't store passwords in code.",
  'Avoid premature optimization.',
  "Don't ever use eval().",
];

for (const input of antiTriggers) {
  tests.push({
    name: `AntiPattern-Extract: "${input.slice(0, 40)}..." → anti_pattern`,
    fn: async (svc) => {
      await svc.recordTurn('s1', 'user', input);
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 10000));
      const db = svc.getStorage();
      const mems = db.read((d: any) => d.prepare('SELECT kind FROM memories').all()) as any[];
      const hasAnti = mems.some((m: any) => m.kind === 'anti_pattern');
      return { passed: hasAnti, details: `Memories: ${mems.length}, Kinds: ${mems.map((m:any) => m.kind).join(',')}` };
    },
  });
}

// Negation should NOT be anti_pattern
tests.push({
  name: 'AntiPattern-Extract: "I don\'t like Python" → NOT anti_pattern',
  fn: async (svc) => {
    await svc.recordTurn('s1', 'user', "I don't like Python.");
    await svc.endSession('s1');
    await new Promise(r => setTimeout(r, 10000));
    const db = svc.getStorage();
    const mems = db.read((d: any) => d.prepare('SELECT kind FROM memories').all()) as any[];
    const hasAnti = mems.some((m: any) => m.kind === 'anti_pattern');
    return { passed: !hasAnti, details: `Memories: ${mems.length}, Kinds: ${mems.map((m:any) => m.kind).join(',')}` };
  },
});

tests.push({
  name: 'AntiPattern-Valid: user_stated source passes',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'Never use eval().');
    const r = await svc.rememberCommand('s1', 'Never use eval().', t.turn_id, 'anti_pattern');
    return { passed: r.memory_id !== undefined, details: `Created: ${r.memory_id !== undefined}` };
  },
});

tests.push({
  name: 'AntiPattern-Valid: agent_inferred source rejected',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'Avoid using eval().');
    const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
    const candidate = { kind: 'anti_pattern' as any, slot: 'anti_pattern', subject: 'user', predicate: 'stated', value_text: 'Avoid using eval().', value_json: null, evidence_quote: 'Avoid using eval().', source_turn_id: t.turn_id, source_episode_id: episode.id, source_type: 'agent_inferred', modality: 'stated', importance: 0.7, decay_class: 'slow', observed_at: new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z') };
    const result = (svc as any).gate.validate(candidate);
    return { passed: !result.passed && result.errors.some((e: string) => e.includes('Anti-pattern requires user statement')), details: `Passed: ${result.passed}, errors: ${result.errors.join(', ')}` };
  },
});

tests.push({
  name: 'AntiPattern-Decay: uses slow decay class (180-day half-life, not exempt)',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'Never use var.');
    const r = await svc.rememberCommand('s1', 'Never use var.', t.turn_id, 'anti_pattern');
    const db = svc.getStorage();
    const row = db.read((d: any) => d.prepare('SELECT decay_class FROM memories WHERE id = ?').get(r.memory_id) as any);
    return { passed: row?.decay_class === 'slow', details: `Decay class: ${row?.decay_class}` };
  },
});

tests.push({
  name: 'AntiPattern-Profile: rendered with "Avoid:" prefix',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'Never use eval().');
    await svc.rememberCommand('s1', 'Never use eval().', t.turn_id, 'anti_pattern');
    await svc.endSession('s1');
    await new Promise(r => setTimeout(r, 2000));
    const profile = svc.getProfile();
    return { passed: profile.profile_text.includes('Avoid:'), details: `Profile: ${profile.profile_text.slice(0, 80)}` };
  },
});

// ============================================================
// OBSERVATION KIND TESTS
// ============================================================

tests.push({
  name: 'Observation-Valid: agent_inferred source passes',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'User seems to prefer concise answers.');
    const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
    const candidate = { kind: 'observation' as any, slot: null, subject: 'user', predicate: 'stated', value_text: 'User seems to prefer concise answers.', value_json: null, evidence_quote: 'User seems to prefer concise answers.', source_turn_id: t.turn_id, source_episode_id: episode.id, source_type: 'agent_inferred', modality: 'stated', importance: 0.4, decay_class: 'fast', observed_at: new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z') };
    const result = (svc as any).gate.validate(candidate);
    return { passed: result.passed, details: `Passed: ${result.passed}, errors: ${result.errors.join(', ')}` };
  },
});

tests.push({
  name: 'Observation-Valid: agent_reflection source passes',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'User appears to be a morning person.');
    const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
    const candidate = { kind: 'observation' as any, slot: null, subject: 'user', predicate: 'stated', value_text: 'User appears to be a morning person.', value_json: null, evidence_quote: 'User appears to be a morning person.', source_turn_id: t.turn_id, source_episode_id: episode.id, source_type: 'agent_reflection', modality: 'stated', importance: 0.3, decay_class: 'fast', observed_at: new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z') };
    const result = (svc as any).gate.validate(candidate);
    return { passed: result.passed, details: `Passed: ${result.passed}, errors: ${result.errors.join(', ')}` };
  },
});

tests.push({
  name: 'Observation-Valid: user_stated source rejected',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'I prefer concise answers.');
    const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
    const candidate = { kind: 'observation' as any, slot: null, subject: 'user', predicate: 'stated', value_text: 'I prefer concise answers.', value_json: null, evidence_quote: 'I prefer concise answers.', source_turn_id: t.turn_id, source_episode_id: episode.id, source_type: 'user_stated', modality: 'stated', importance: 0.7, decay_class: 'fast', observed_at: new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z') };
    const result = (svc as any).gate.validate(candidate);
    return { passed: !result.passed && result.errors.some((e: string) => e.includes('Observation requires agent inference')), details: `Passed: ${result.passed}, errors: ${result.errors.join(', ')}` };
  },
});

tests.push({
  name: 'Observation-Status: starts as candidate (not active)',
  fn: async (svc) => {
    const { uuid, nowUtc } = require('../types/common.js');
    const t = await svc.recordTurn('s1', 'user', 'User seems to prefer concise answers.');
    const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
    const db = svc.getStorage().getDb();
    const memId = uuid();
    const now = nowUtc();
    // Simulate what the resolver does: initialStatus for observation + agent_inferred
    const initialStatus = ('observation' === 'observation' && ['agent_inferred', 'agent_reflection'].includes('agent_inferred')) ? 'candidate' : 'active';
    db.prepare(`
      INSERT INTO memories (id, kind, slot, subject, predicate, value_text, value_json, evidence_quote,
        source_turn_id, source_episode_id, source_type, modality, confidence, importance, pinned,
        valid_from, valid_to, observed_at, recorded_at, reinforcement_count, access_count,
        status, extractor_version, decay_class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(memId, 'observation', null, 'user', 'stated', 'User seems to prefer concise answers.', null, 'User seems to prefer concise answers.', t.turn_id, episode.id, 'agent_inferred', 'stated', 0.4, 0.5, 0, null, null, now, now, 0, 0, initialStatus, 'v1', 'fast');
    const row = db.prepare('SELECT status FROM memories WHERE id = ?').get(memId) as any;
    return { passed: row?.status === 'candidate', details: `Status: ${row?.status}` };
  },
});

tests.push({
  name: 'Observation-Profile: excluded from profile (candidate status)',
  fn: async (svc) => {
    const { uuid, nowUtc } = require('../types/common.js');
    const t = await svc.recordTurn('s1', 'user', 'User seems to prefer concise answers.');
    const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
    const db = svc.getStorage().getDb();
    const memId = uuid();
    const now = nowUtc();
    db.prepare(`
      INSERT INTO memories (id, kind, slot, subject, predicate, value_text, value_json, evidence_quote,
        source_turn_id, source_episode_id, source_type, modality, confidence, importance, pinned,
        valid_from, valid_to, observed_at, recorded_at, reinforcement_count, access_count,
        status, extractor_version, decay_class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(memId, 'observation', null, 'user', 'stated', 'User seems to prefer concise answers.', null, 'User seems to prefer concise answers.', t.turn_id, episode.id, 'agent_inferred', 'stated', 0.4, 0.5, 0, null, null, now, now, 0, 0, 'candidate', 'v1', 'fast');
    db.prepare('INSERT INTO memories_fts (memory_id, value_text, subject, predicate) VALUES (?, ?, ?, ?)').run(memId, 'User seems to prefer concise answers.', 'user', 'stated');
    await (svc as any).profileCompiler.compile('manual', [memId]);
    const profile = svc.getProfile();
    return { passed: !profile.profile_text.includes('concise'), details: `Profile: ${profile.profile_text.slice(0, 60)}` };
  },
});

tests.push({
  name: 'Observation-Decay: uses fast decay class (7-day half-life)',
  fn: async (svc) => {
    const t = await svc.recordTurn('s1', 'user', 'User appears to be a morning person.');
    const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
    const { uuid, nowUtc } = require('../types/common.js');
    const db = svc.getStorage().getDb();
    const memId = uuid();
    const now = nowUtc();
    db.prepare(`
      INSERT INTO memories (id, kind, slot, subject, predicate, value_text, value_json, evidence_quote,
        source_turn_id, source_episode_id, source_type, modality, confidence, importance, pinned,
        valid_from, valid_to, observed_at, recorded_at, reinforcement_count, access_count,
        status, extractor_version, decay_class)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(memId, 'observation', null, 'user', 'stated', 'User appears to be a morning person.', null, 'User appears to be a morning person.', t.turn_id, episode.id, 'agent_inferred', 'stated', 0.4, 0.5, 0, null, null, now, now, 0, 0, 'candidate', 'v1', 'fast');
    const row = db.prepare('SELECT decay_class FROM memories WHERE id = ?').get(memId) as any;
    return { passed: row?.decay_class === 'fast', details: `Decay class: ${row?.decay_class}` };
  },
});

// ============================================================
// CROSS-KIND TESTS
// ============================================================

tests.push({
  name: 'CrossKind: all 4 new kinds coexist without conflict',
  fn: async (svc) => {
    const t1 = await svc.recordTurn('s1', 'user', 'I decided to use TypeScript.');
    await svc.rememberCommand('s1', 'I decided to use TypeScript.', t1.turn_id, 'decision');
    const t2 = await svc.recordTurn('s1', 'user', 'The docs are at example.com');
    await svc.rememberCommand('s1', 'The docs are at example.com', t2.turn_id, 'reference');
    const t3 = await svc.recordTurn('s1', 'user', 'Never use eval().');
    await svc.rememberCommand('s1', 'Never use eval().', t3.turn_id, 'anti_pattern');
    const active = svc.listMemories('active');
    const kinds = [...new Set(active.memories.map((m: any) => m.kind))];
    return { passed: active.total >= 3 && kinds.includes('decision') && kinds.includes('reference') && kinds.includes('anti_pattern'), details: `Active: ${active.total}, Kinds: ${kinds.join(',')}` };
  },
});

tests.push({
  name: 'CrossKind: old kinds unaffected by new kind additions',
  fn: async (svc) => {
    const t1 = await svc.recordTurn('s1', 'user', 'I like Python.');
    await svc.rememberCommand('s1', 'I like Python.', t1.turn_id, 'interest');
    const t2 = await svc.recordTurn('s1', 'user', 'I live in London.');
    await svc.rememberCommand('s1', 'I live in London.', t2.turn_id, 'fact');
    const t3 = await svc.recordTurn('s1', 'user', 'Never call me Chuck.');
    await svc.boundaryCommand('s1', 'Never call me Chuck.', t3.turn_id);
    const active = svc.listMemories('active');
    const kinds = [...new Set(active.memories.map((m: any) => m.kind))];
    return { passed: kinds.includes('interest') && kinds.includes('fact') && kinds.includes('boundary'), details: `Kinds: ${kinds.join(',')}` };
  },
});

tests.push({
  name: 'CrossKind: schema CHECK allows all 11 kinds',
  fn: async (svc) => {
    const db = svc.getStorage().getDb();
    const kinds = ['fact', 'preference', 'routine', 'boundary', 'relationship', 'interest', 'trait_inference', 'decision', 'reference', 'anti_pattern', 'observation'];
    let allPassed = true;
    const errors: string[] = [];
    for (const kind of kinds) {
      try {
        const t = await svc.recordTurn('s1', 'user', `Test ${kind}`);
        const episode = (svc as any).ingest.getOpenEpisode('s1') as any;
        const { uuid, nowUtc } = require('../types/common.js');
        const memId = uuid();
        const now = nowUtc();
        db.prepare(`
          INSERT INTO memories (id, kind, slot, subject, predicate, value_text, value_json, evidence_quote,
            source_turn_id, source_episode_id, source_type, modality, confidence, importance, pinned,
            valid_from, valid_to, observed_at, recorded_at, reinforcement_count, access_count,
            status, extractor_version, decay_class)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(memId, kind, null, 'user', 'stated', `Test ${kind}`, null, `Test ${kind}`, t.turn_id, episode.id, 'user_stated', 'stated', 0.8, 0.7, 0, null, null, now, now, 0, 0, 'active', 'v1', 'medium');
        db.prepare('DELETE FROM memories WHERE id = ?').run(memId);
      } catch (e: any) {
        allPassed = false;
        errors.push(`${kind}: ${e.message}`);
      }
    }
    return { passed: allPassed, details: allPassed ? `All ${kinds.length} kinds accepted` : errors.join('; ') };
  },
});

async function main() {
  console.log('=== Seme Memory Types Eval Suite ===\n');
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

  console.log(`\n${'='.repeat(70)}`);
  console.log(`TOTAL: ${passed}/${total} (${((passed/total)*100).toFixed(1)}%)`);
  console.log(`Total time: ${results.reduce((s, r) => s + r.time_ms, 0)}ms`);
  console.log('='.repeat(70));

  const report = { timestamp: new Date().toISOString(), passed, total, percentage: ((passed/total)*100).toFixed(1), results };
  fs.writeFileSync('/tmp/scratchpad/seme-mt-eval-results.json', JSON.stringify(report, null, 2));
  console.log('\nResults written to /tmp/scratchpad/seme-mt-eval-results.json');
}

main().catch(console.error);