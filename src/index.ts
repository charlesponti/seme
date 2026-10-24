// src/index.ts — Demo / test entry point

import { MemoryService } from './api/service.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const STORAGE_DIR = '/tmp/scratchpad/shm-test';
const EMBEDDING_DIM = 4; // small for testing

// Clean previous test
if (fs.existsSync(STORAGE_DIR)) {
  fs.rmSync(STORAGE_DIR, { recursive: true });
}
fs.mkdirSync(STORAGE_DIR, { recursive: true });

async function main() {
  console.log('=== Self-Healing Memory System — V1-tonight Demo ===\n');

  const service = new MemoryService({ storageDir: STORAGE_DIR, embeddingDim: EMBEDDING_DIM });

  // Seed identity core
  await service.seedIdentityCore(
    { name: 'Charles', pronouns: 'he/him' },
    'The user is Charles. Pronouns: he/him.'
  );
  console.log('1. Identity core seeded');

  // Session 1: state preferences
  const session1 = await service.recordTurn('session-1', 'user', 'ignored', now()).then(() => 'session-1');
  // Actually, let's use the proper flow
  console.log('\n--- Session 1 ---');

  // Record turns
  const t1 = await service.recordTurn('session-1', 'user', 'My name is Charles and I live in London.');
  console.log('  Recorded turn:', t1.turn_id);

  const t2 = await service.recordTurn('session-1', 'user', 'I love TypeScript and I am interested in memory systems.');
  console.log('  Recorded turn:', t2.turn_id);

  const t3 = await service.recordTurn('session-1', 'user', 'Never call me Chuck.');
  console.log('  Recorded turn:', t3.turn_id);

  // Remember commands
  const r1 = await service.rememberCommand('session-1', 'Charles', t1.turn_id, 'fact');
  console.log('  Remembered:', r1);

  const r2 = await service.rememberCommand('session-1', 'London', t1.turn_id, 'fact');
  console.log('  Remembered:', r2);

  const r3 = await service.rememberCommand('session-1', 'TypeScript', t2.turn_id, 'interest');
  console.log('  Remembered:', r3);

  const r4 = await service.boundaryCommand('session-1', 'Never call me Chuck.', t3.turn_id);
  console.log('  Boundary:', r4);

  // End session
  const end1 = await service.endSession('session-1');
  console.log('  Session ended:', end1);

  // Get profile
  const profile1 = service.getProfile();
  console.log('\n  Profile v1:', profile1?.profile_text?.slice(0, 200));

  // Retrieve context
  const ctx1 = service.retrieveContext('session-1', 'What do you know about me?');
  console.log('  Retrieved memories:', ctx1.memories.length);
  console.log('  Abstain:', ctx1.abstain);

  // Session 2: different city
  console.log('\n--- Session 2 ---');
  const t4 = await service.recordTurn('session-2', 'user', 'Actually, I moved to Edinburgh.');
  console.log('  Recorded turn:', t4.turn_id);

  const r5 = await service.rememberCommand('session-2', 'Edinburgh', t4.turn_id, 'fact');
  console.log('  Remembered:', r5);

  const end2 = await service.endSession('session-2');
  console.log('  Session ended:', end2);

  // Forget the interest
  console.log('\n--- Forget interest ---');
  const forgetResult = await service.forgetCommand('memory', r3.memory_id);
  console.log('  Forget result:', forgetResult);

  // Check profile after forget
  const profile2 = service.getProfile();
  console.log('  Profile after forget:', profile2?.profile_text?.slice(0, 200));

  // Health check
  const db = service.getStorage();
  console.log('\n  Integrity check:', db.integrityCheck());
  console.log('  FK check:', db.foreignKeyCheck());

  service.close();
  console.log('\n=== Demo complete ===');
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

main().catch(console.error);