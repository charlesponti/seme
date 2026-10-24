// src/evals/hard-test.ts — Hard tests for Seme memory system

import { MemoryService } from '../api/service.js';
import * as fs from 'node:fs';

const STORAGE_DIR = '/tmp/scratchpad/seme-hard-test';
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

async function runTest(name: string, fn: (svc: MemoryService) => Promise<{ passed: boolean; details: string }>): Promise<TestResult> {
  const svc = new MemoryService({ storageDir: STORAGE_DIR + '-' + Date.now(), embeddingDim: EMBEDDING_DIM });
  await svc.seedIdentityCore({ name: 'Charles' }, 'The user is Charles Ponti.');
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

const tests: { name: string; fn: (svc: MemoryService) => Promise<{ passed: boolean; details: string }> }[] = [
  // === Multi-session accumulation ===
  {
    name: 'Hard: 10-session accumulation',
    fn: async (svc) => {
      const facts = [
        'I work at Ponti Studios.',
        'I use TypeScript for everything.',
        'I prefer dark mode.',
        'I drink coffee every morning.',
        'I have a cat named Pixel.',
        'I live in London.',
        'I drive a Tesla.',
        'I exercise 3 times a week.',
        'I read sci-fi books.',
        'I play guitar.',
      ];
      for (let i = 0; i < facts.length; i++) {
        const t = await svc.recordTurn(`s${i}`, 'user', facts[i]);
        await svc.rememberCommand(`s${i}`, facts[i].replace('I ', '').replace('.', ''), t.turn_id, 'fact');
        await svc.endSession(`s${i}`);
      }
      await new Promise(r => setTimeout(r, 2000));
      const ctx = svc.retrieveContext('s10', 'coffee');
      const profile = svc.getProfile();
      const memCount = svc.listMemories('active').total;
      return {
        passed: memCount >= 8 && profile.profile_text.length > 0,
        details: `Memories: ${memCount}, Profile tokens: ${profile.profile_text.split(/\s+/).length}`
      };
    },
  },

  // === Contradiction over time ===
  {
    name: 'Hard: Contradiction resolution (city change)',
    fn: async (svc) => {
      const t1 = await svc.recordTurn('s1', 'user', 'I live in London.');
      await svc.rememberCommand('s1', 'London', t1.turn_id, 'fact');
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 2000));
      const t2 = await svc.recordTurn('s2', 'user', 'I moved to Edinburgh.');
      await svc.rememberCommand('s2', 'Edinburgh', t2.turn_id, 'fact');
      await svc.endSession('s2');
      await new Promise(r => setTimeout(r, 2000));
      const ctx = svc.retrieveContext('s3', 'where do I live');
      const hasLondon = ctx.memories.some((m: any) => m.value_text.toLowerCase().includes('london'));
      const hasEdinburgh = ctx.memories.some((m: any) => m.value_text.toLowerCase().includes('edinburgh'));
      return {
        passed: hasEdinburgh && !hasLondon,
        details: `London: ${hasLondon}, Edinburgh: ${hasEdinburgh}, Total: ${ctx.memories.length}`
      };
    },
  },

  // === Abstention ===
  {
    name: 'Hard: Abstain on 5 unrelated queries',
    fn: async (svc) => {
      const t = await svc.recordTurn('s1', 'user', 'I like Python programming.');
      await svc.rememberCommand('s1', 'Python', t.turn_id, 'interest');
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 2000));
      const queries = ['quantum physics', 'ancient Rome', 'cooking recipes', 'space exploration', 'marine biology'];
      let abstained = 0;
      for (const q of queries) {
        const ctx = svc.retrieveContext('s2', q);
        if (ctx.abstain || ctx.memories.length === 0) abstained++;
      }
      return {
        passed: abstained >= 4,
        details: `Abstained on ${abstained}/5 queries`
      };
    },
  },

  // === Negation ===
  {
    name: 'Hard: Negation preserved through extraction',
    fn: async (svc) => {
      await svc.recordTurn('s1', 'user', "I don't eat meat. I'm vegetarian.");
      await svc.recordTurn('s1', 'assistant', "That's great for health!");
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 10000));
      const db = svc.getStorage();
      const mems = db.read((d: any) => d.prepare('SELECT value_text, modality FROM memories').all()) as any[];
      const hasNegation = mems.some((m: any) => m.value_text.toLowerCase().includes("don't") || m.value_text.toLowerCase().includes('not') || m.value_text.toLowerCase().includes('vegetarian'));
      return {
        passed: mems.length > 0 && hasNegation,
        details: `Memories: ${mems.length}, Negation preserved: ${hasNegation}, Mods: ${mems.map((m:any) => m.modality).join(',')}`
      };
    },
  },

  // === Hypothetical ===
  {
    name: 'Hard: Hypothetical tagged correctly',
    fn: async (svc) => {
      await svc.recordTurn('s1', 'user', 'If I won the lottery, I would buy a mansion in Scotland.');
      await svc.recordTurn('s1', 'assistant', 'That would be amazing!');
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 10000));
      const db = svc.getStorage();
      const mems = db.read((d: any) => d.prepare('SELECT value_text, modality FROM memories').all()) as any[];
      const hasStatedHypothetical = mems.some((m: any) => m.value_text.toLowerCase().includes('mansion') && m.modality === 'stated');
      return {
        passed: !hasStatedHypothetical,
        details: `Memories: ${mems.length}, Hypothetical as stated: ${hasStatedHypothetical}, Mods: ${mems.map((m:any) => m.modality).join(',')}`
      };
    },
  },

  // === Compliment as feedback ===
  {
    name: 'Hard: Compliment becomes feedback not memory',
    fn: async (svc) => {
      await svc.recordTurn('s1', 'user', 'You did an amazing job on that summary!');
      await svc.recordTurn('s1', 'assistant', 'Thank you!');
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 10000));
      const db = svc.getStorage();
      const memCount = db.read((d: any) => (d.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c);
      const fbCount = db.read((d: any) => (d.prepare('SELECT COUNT(*) as c FROM feedback_events').get() as any).c);
      return {
        passed: memCount === 0 && fbCount >= 1,
        details: `Memories: ${memCount}, Feedback: ${fbCount}`
      };
    },
  },

  // === Non-salient ===
  {
    name: 'Hard: Greetings produce nothing',
    fn: async (svc) => {
      await svc.recordTurn('s1', 'user', 'Hi!');
      await svc.recordTurn('s1', 'assistant', 'Hello! How can I help?');
      await svc.recordTurn('s1', 'user', 'Bye!');
      await svc.recordTurn('s1', 'assistant', 'Goodbye!');
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 10000));
      const db = svc.getStorage();
      const memCount = db.read((d: any) => (d.prepare('SELECT COUNT(*) as c FROM memories').get() as any).c);
      return {
        passed: memCount === 0,
        details: `Memories from greetings: ${memCount}`
      };
    },
  },

  // === Boundary ===
  {
    name: 'Hard: Boundary rule created and retrieved',
    fn: async (svc) => {
      const t = await svc.recordTurn('s1', 'user', 'Never call me Chuck. I hate that name.');
      await svc.boundaryCommand('s1', 'Never call me Chuck.', t.turn_id);
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 2000));
      const ctx = svc.retrieveContext('s2', 'Chuck');
      return {
        passed: ctx.procedural_rules.length > 0,
        details: `Procedural rules: ${ctx.procedural_rules.length}`
      };
    },
  },

  // === Sleep job compaction ===
  {
    name: 'Hard: Sleep job completes on populated store',
    fn: async (svc) => {
      for (let i = 0; i < 20; i++) {
        const turnContent = `I like programming language number ${i}.`;
        const t = await svc.recordTurn(`s${i}`, 'user', turnContent);
        await svc.rememberCommand(`s${i}`, turnContent, t.turn_id, 'interest');
        await svc.endSession(`s${i}`);
      }
      await new Promise(r => setTimeout(r, 5000));
      const result = await svc.runSleepJob('manual');
      const metrics = svc.getHealthMetrics();
      return {
        passed: result.status === 'completed' && metrics.provenance_complete_percent === 100,
        details: `Sleep: ${result.status}, Provenance: ${metrics.provenance_complete_percent}%`
      };
    },
  },

  // === Profile compilation ===
  {
    name: 'Hard: Profile renders after 10 memories',
    fn: async (svc) => {
      for (let i = 0; i < 10; i++) {
        const t = await svc.recordTurn(`s${i}`, 'user', `My favorite color is color${i}.`);
        await svc.rememberCommand(`s${i}`, `color${i}`, t.turn_id, 'preference');
        await svc.endSession(`s${i}`);
      }
      await new Promise(r => setTimeout(r, 3000));
      const profile = svc.getProfile();
      return {
        passed: profile.profile_text.length > 20 && profile.profile_text.includes('Profile'),
        details: `Profile length: ${profile.profile_text.length}, version: ${profile.profile_version}`
      };
    },
  },

  // === Rapid-fire turns ===
  {
    name: 'Hard: 50 rapid turns in one session',
    fn: async (svc) => {
      const start = Date.now();
      for (let i = 0; i < 50; i++) {
        await svc.recordTurn('s1', 'user', `Turn ${i}: I like topic ${i % 5}.`);
      }
      await svc.endSession('s1');
      const elapsed = Date.now() - start;
      const turns = svc.getStorage().read((db: any) => (db.prepare('SELECT COUNT(*) as c FROM turns').get() as any).c);
      return {
        passed: turns === 50 && elapsed < 30000,
        details: `Turns: ${turns}, Time: ${elapsed}ms`
      };
    },
  },

  // === Delete all ===
  {
    name: 'Hard: Delete all clears everything',
    fn: async (svc) => {
      for (let i = 0; i < 5; i++) {
        const turnContent = `Fact number ${i}.`;
        const t = await svc.recordTurn(`s${i}`, 'user', turnContent);
        await svc.rememberCommand(`s${i}`, turnContent, t.turn_id, 'fact');
        await svc.endSession(`s${i}`);
      }
      await new Promise(r => setTimeout(r, 3000));
      await svc.forgetCommand('all', undefined, undefined, undefined, undefined, true);
      const mems = svc.listMemories();
      const profile = svc.getProfile();
      const turns = svc.getStorage().read((db: any) => (db.prepare('SELECT COUNT(*) as c FROM turns').get() as any).c);
      return {
        passed: mems.total === 0 && turns === 0 && profile.profile_text === '',
        details: `Memories: ${mems.total}, Turns: ${turns}, Profile: ${profile.profile_text.length} chars`
      };
    },
  },

  // === Correct memory ===
  {
    name: 'Hard: Correct memory supersedes chain',
    fn: async (svc) => {
      const t = await svc.recordTurn('s1', 'user', 'I live in London.');
      const r = await svc.rememberCommand('s1', 'London', t.turn_id, 'fact');
      await svc.correctMemory(r.memory_id, 'Edinburgh');
      await svc.correctMemory(svc.listMemories('active').memories[0].id, 'Glasgow');
      const active = svc.listMemories('active');
      const superseded = svc.listMemories('superseded');
      return {
        passed: active.total === 1 && superseded.total === 2,
        details: `Active: ${active.total}, Superseded: ${superseded.total}`
      };
    },
  },

  // === Pause/resume ===
  {
    name: 'Hard: Pause blocks remember but not record',
    fn: async (svc) => {
      await svc.pauseLearning();
      const t = await svc.recordTurn('s1', 'user', 'I like Rust.');
      let pausedBlocked = false;
      try { await svc.rememberCommand('s1', 'Rust', t.turn_id, 'interest'); } catch (e: any) { pausedBlocked = e.message.includes('ERR_PAUSED'); }
      await svc.resumeLearning();
      const r = await svc.rememberCommand('s1', 'Rust', t.turn_id, 'interest');
      return {
        passed: pausedBlocked && r.memory_id !== undefined,
        details: `Blocked while paused: ${pausedBlocked}, Created after resume: ${r.memory_id !== undefined}`
      };
    },
  },

  // === Export ===
  {
    name: 'Hard: Export after full session',
    fn: async (svc) => {
      const t = await svc.recordTurn('s1', 'user', 'I like Swift.');
      await svc.rememberCommand('s1', 'Swift', t.turn_id, 'interest');
      await svc.endSession('s1');
      await new Promise(r => setTimeout(r, 2000));
      const exp = await svc.exportData();
      return {
        passed: exp.memory_count >= 1 && exp.tables_included.length >= 5,
        details: `Memories: ${exp.memory_count}, Tables: ${exp.tables_included.length}`
      };
    },
  },
];

async function main() {
  console.log('=== Seme Hard Test Suite ===\n');
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

  console.log(`\n${'='.repeat(60)}`);
  console.log(`TOTAL: ${passed}/${total} (${((passed/total)*100).toFixed(1)}%)`);
  console.log(`Total time: ${results.reduce((s, r) => s + r.time_ms, 0)}ms`);
  console.log('='.repeat(60));

  const report = { timestamp: new Date().toISOString(), passed, total, percentage: ((passed/total)*100).toFixed(1), results };
  fs.writeFileSync('/tmp/scratchpad/seme-hard-test-results.json', JSON.stringify(report, null, 2));
  console.log('\nResults written to /tmp/scratchpad/seme-hard-test-results.json');
}

main().catch(console.error);