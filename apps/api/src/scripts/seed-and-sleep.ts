// src/scripts/seed-and-sleep.ts — Seed 300 memories and run sleep job with JSONL logging

import { MemoryService } from '../api/service.js';
import * as fs from 'node:fs';

const STORAGE_DIR = '/tmp/scratchpad/seme-sleep-demo';
const LOG_PATH = '/tmp/scratchpad/seme-sleep-demo/sleep-job.jsonl';
const EMBEDDING_DIM = 1024;

function cleanup() {
  if (fs.existsSync(STORAGE_DIR)) fs.rmSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

async function seedMemories(svc: MemoryService): Promise<number> {
  const slots = ['home_city', 'dietary_restriction', 'name', null, null, null];
  const kinds = ['fact', 'preference', 'interest', 'routine', 'fact', 'fact'];
  const decayClasses = ['exempt', 'slow', 'medium', 'fast', 'session', 'medium'];
  const cities = ['London', 'Edinburgh', 'Glasgow', 'Manchester', 'Tokyo', 'Paris', 'Berlin', 'New York', 'Sydney', 'Toronto'];
  const foods = ['vegetarian', 'vegan', 'gluten-free', 'no nuts', 'keto', 'paleo', 'no dairy'];
  const languages = ['TypeScript', 'Python', 'Rust', 'Go', 'Java', 'C++', 'Swift', 'Kotlin', 'Ruby', 'Haskell'];
  const interests = ['photography', 'hiking', 'cooking', 'reading', 'gaming', 'music', 'painting', 'travel', 'fitness', 'chess'];
  const routines = ['morning coffee', 'evening walk', 'weekly review', 'daily standup', 'meditation', 'journaling'];

  let count = 0;
  const sessions = 30;

  for (let s = 0; s < sessions; s++) {
    const sessionId = `session-${s}`;
    // 10 memories per session
    for (let i = 0; i < 10; i++) {
      const idx = (s * 10 + i) % 10;
      const slotIdx = (s * 10 + i) % slots.length;
      const slot = slots[slotIdx];
      const kind = kinds[slotIdx];
      const decay = decayClasses[slotIdx];

      let content: string;
      if (slot === 'home_city') {
        content = `I live in ${cities[idx]}.`;
      } else if (slot === 'dietary_restriction') {
        content = `I am ${foods[idx]}.`;
      } else if (slot === 'name') {
        content = `My name is User${s}.`;
      } else if (kind === 'interest') {
        content = `I enjoy ${interests[idx]}.`;
      } else if (kind === 'routine') {
        content = `I have a routine: ${routines[idx]}.`;
      } else {
        content = `Fact number ${s * 10 + i}: I like topic ${idx}.`;
      }

      const t = await svc.recordTurn(sessionId, 'user', content);
      try {
        await svc.rememberCommand(sessionId, content, t.turn_id, kind);
        count++;
      } catch (e: any) {
        // skip validation errors
      }
    }
    await svc.endSession(sessionId);
  }

  // Add some exact duplicates (to exercise dedup sweep)
  for (let i = 0; i < 20; i++) {
    const sessionId = `dup-session-${i}`;
    const content = `I enjoy ${interests[i % interests.length]}.`;
    const t = await svc.recordTurn(sessionId, 'user', content);
    try {
      await svc.rememberCommand(sessionId, content, t.turn_id, 'interest');
      count++;
    } catch (e: any) {}
    await svc.endSession(sessionId);
  }

  // Add some single-valued slot conflicts (to exercise contradiction sweep)
  for (let i = 0; i < 5; i++) {
    const sessionId = `conflict-session-${i}`;
    const city = cities[i];
    const t = await svc.recordTurn(sessionId, 'user', `I live in ${city}.`);
    try {
      await svc.rememberCommand(sessionId, `I live in ${city}.`, t.turn_id, 'fact');
      count++;
    } catch (e: any) {}
    await svc.endSession(sessionId);
  }

  // Add some old memories with low confidence (to exercise decay sweep)
  // These will be created as candidates that should be archived
  for (let i = 0; i < 10; i++) {
    const sessionId = `old-session-${i}`;
    const content = `Old fact ${i}: I used to like topic ${i}.`;
    const t = await svc.recordTurn(sessionId, 'user', content);
    try {
      await svc.rememberCommand(sessionId, content, t.turn_id, 'fact');
      count++;
    } catch (e: any) {}
    await svc.endSession(sessionId);
  }

  return count;
}

async function main() {
  cleanup();
  console.log('=== Seeding 300+ memories ===');
  const svc = new MemoryService({
    storageDir: STORAGE_DIR,
    embeddingDim: EMBEDDING_DIM,
    sleepLogPath: LOG_PATH,
  });
  await svc.seedIdentityCore({ name: 'Demo User' }, 'The user is a demo user for sleep job testing.');

  const seeded = await seedMemories(svc);
  console.log(`Seeded ${seeded} memories`);

  // Wait for async extractions to settle
  console.log('Waiting for async extractions...');
  await new Promise(r => setTimeout(r, 10000));

  const beforeCounts = svc.listMemories();
  const byStatus: Record<string, number> = {};
  const db = svc.getStorage();
  const statusRows = db.read((d: any) => d.prepare('SELECT status, COUNT(*) as c FROM memories GROUP BY status').all() as any[]);
  for (const r of statusRows) byStatus[r.status] = r.c;
  console.log('Before sleep job:', JSON.stringify(byStatus));
  console.log('Total memories:', beforeCounts.total);

  console.log('\n=== Running sleep job ===');
  const result = await svc.runSleepJob('manual');
  console.log('Status:', result.status);
  console.log('Steps:', JSON.stringify(result.steps, null, 2));
  console.log('Metrics:', JSON.stringify(result.metrics, null, 2));

  // After
  const afterCounts = svc.listMemories();
  const afterStatus: Record<string, number> = {};
  const afterRows = db.read((d: any) => d.prepare('SELECT status, COUNT(*) as c FROM memories GROUP BY status').all() as any[]);
  for (const r of afterRows) afterStatus[r.status] = r.c;
  console.log('\nAfter sleep job:', JSON.stringify(afterStatus));
  console.log('Total memories:', afterCounts.total);

  // Show log file
  console.log('\n=== Sleep job JSONL log ===');
  const logContent = fs.readFileSync(LOG_PATH, 'utf-8');
  const lines = logContent.trim().split('\n');
  console.log(`Total log entries: ${lines.length}`);
  for (const line of lines) {
    const entry = JSON.parse(line);
    console.log(`  [${entry.ts}] ${entry.event}${entry.step ? ' → ' + entry.step : ''}${entry.duration_ms ? ' (' + entry.duration_ms + 'ms)' : ''}`);
  }

  svc.close();
  console.log('\nDone! Log file:', LOG_PATH);
}

main().catch(console.error);