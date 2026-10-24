// src/index.ts — Demo / test entry point

import { MemoryService } from './api/service.js';
import * as fs from 'node:fs';

const STORAGE_DIR = '/tmp/scratchpad/seme-test';
const EMBEDDING_DIM = 4;

if (fs.existsSync(STORAGE_DIR)) {
  fs.rmSync(STORAGE_DIR, { recursive: true });
}
fs.mkdirSync(STORAGE_DIR, { recursive: true });

async function main() {
  console.log('=== Seme — Extraction Pipeline Demo ===\n');

  const service = new MemoryService({ storageDir: STORAGE_DIR, embeddingDim: EMBEDDING_DIM });

  await service.seedIdentityCore(
    { name: 'Charles', pronouns: 'he/him' },
    'The user is Charles. Pronouns: he/him.'
  );
  console.log('1. Identity core seeded\n');

  // Session 1: rich conversation
  console.log('--- Session 1: Recording conversation ---');
  await service.recordTurn('session-1', 'user', 'Hi! My name is Charles and I live in London.');
  await service.recordTurn('session-1', 'assistant', 'Nice to meet you, Charles! London is a great city.');
  await service.recordTurn('session-1', 'user', 'I love TypeScript and I am really interested in memory systems.');
  await service.recordTurn('session-1', 'assistant', 'TypeScript is excellent for building robust systems.');
  await service.recordTurn('session-1', 'user', 'Never call me Chuck. Also I prefer dark mode in all my apps.');
  await service.recordTurn('session-1', 'assistant', 'Got it, no Chuck. Dark mode noted.');
  await service.recordTurn('session-1', 'user', 'You did a great job with that answer!');
  console.log('  7 turns recorded\n');

  // End session — triggers extraction
  console.log('--- Ending session (triggers extraction) ---');
  const end1 = await service.endSession('session-1');
  console.log('  Session ended:', end1.episode_id);

  // Wait for async extraction
  console.log('  Waiting for extraction...');
  await new Promise(resolve => setTimeout(resolve, 15000));

  // Check profile
  const profile1 = service.getProfile();
  console.log('\n  Profile after extraction:');
  console.log(profile1?.profile_text || '(empty)');

  // Retrieve context
  const ctx1 = service.retrieveContext('session-1', 'What do you know about me?');
  console.log('\n  Retrieved memories:', ctx1.memories.length);
  for (const m of ctx1.memories) {
    console.log(`    - ${m.kind}: ${m.value_text} (${m.source_type}, conf=${m.confidence})`);
  }
  console.log('  Abstain:', ctx1.abstain);

  // Session 2: different city
  console.log('\n--- Session 2: New city ---');
  await service.recordTurn('session-2', 'user', 'Actually, I moved to Edinburgh last week.');
  await service.recordTurn('session-2', 'assistant', 'Edinburgh is beautiful! How are you settling in?');
  await service.recordTurn('session-2', 'user', 'It is great. The weather is different from London though.');
  console.log('  3 turns recorded');

  const end2 = await service.endSession('session-2');
  console.log('  Session ended:', end2.episode_id);

  console.log('  Waiting for extraction...');
  await new Promise(resolve => setTimeout(resolve, 15000));

  const profile2 = service.getProfile();
  console.log('\n  Profile after session 2:');
  console.log(profile2?.profile_text || '(empty)');

  // Health check
  const db = service.getStorage();
  console.log('\n  Integrity check:', db.integrityCheck());
  console.log('  FK check:', db.foreignKeyCheck());

  service.close();
  console.log('\n=== Demo complete ===');
}

main().catch(console.error);
