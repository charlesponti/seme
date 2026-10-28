// src/scripts/entity-type-eval.ts — Eval 50 entity types

import { MemoryService } from '../api/service.js';
import * as fs from 'node:fs';

const STORAGE_DIR = '/tmp/scratchpad/seme-entity-type-eval';
const EMBEDDING_DIM = 1024;

function cleanup() {
  if (fs.existsSync(STORAGE_DIR)) fs.rmSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// 50 sentences, each mentioning a different entity type
const SENTENCES = [
  "My dog is named Rex.",
  "I live in Tokyo.",
  "I work at Google.",
  "I'm building a project called Atlas.",
  "I use VS Code for editing.",
  "I believe in karma.",
  "I'm studying philosophy.",
  "I prefer dark mode.",
  "I have a cat named Whiskers.",
  "I visited Paris last summer.",
  "I founded a startup called NovaTech.",
  "I use Docker for containers.",
  "I value honesty.",
  "I'm learning about quantum physics.",
  "I like jazz music.",
  "My car is a Tesla Model 3.",
  "I have a bird named Tweety.",
  "I grew up in Melbourne.",
  "I volunteer at the Red Cross.",
  "I'm writing a book called 'The Algorithm'.",
  "I use Figma for design.",
  "I think meditation is important.",
  "I'm interested in astronomy.",
  "I enjoy cooking Italian food.",
  "My bike is a Trek.",
  "I have a fish named Bubbles.",
  "I moved to Berlin.",
  "I donate to Wikipedia.",
  "I'm reading about machine learning.",
  "I use Notion for notes.",
  "I believe in work-life balance.",
  "I study economics.",
  "I like classical music.",
  "My phone is an iPhone.",
  "I have a hamster named Nibbles.",
  "I traveled to Rome.",
  "I work with the Linux Foundation.",
  "I'm building an app called Pulse.",
  "I use GitHub for version control.",
  "I think privacy matters.",
  "I study neuroscience.",
  "I enjoy painting landscapes.",
  "My tablet is an iPad.",
  "I have a rabbit named Thumper.",
  "I lived in Stockholm.",
  "I support the EFF.",
  "I'm researching blockchain.",
  "I use Slack for communication.",
  "I value creativity.",
  "I study linguistics.",
];

async function main() {
  console.log('=== Entity Type Eval: 50 different entity types ===\n');
  cleanup();
  const seme = new MemoryService({ storageDir: STORAGE_DIR, embeddingDim: 4 });
  await seme.seedIdentityCore({ name: 'Test' }, 'Test user.');

  // Send all sentences in one session
  const sessionId = 'eval-session';
  for (const sentence of SENTENCES) {
    await seme.recordTurn(sessionId, 'user', sentence);
  }
  await seme.recordTurn(sessionId, 'assistant', 'Noted all of that!');
  await seme.endSession(sessionId);

  console.log('Waiting 45s for extraction...');
  await new Promise(r => setTimeout(r, 45000));

  const db = seme.getStorage().getDb();
  const entities = db.prepare('SELECT name, type, description FROM entities ORDER BY name').all() as { name: string; type: string; description: string }[];

  console.log(`\n=== Extracted ${entities.length} entities ===\n`);
  console.log('Name'.padEnd(20) + 'Type'.padEnd(20) + 'Description');
  console.log('-'.repeat(70));
  for (const e of entities) {
    console.log(e.name.padEnd(20) + e.type.padEnd(20) + (e.description || ''));
  }

  // Analyze type distribution
  const typeCounts: Record<string, number> = {};
  for (const e of entities) {
    typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
  }
  console.log('\n=== Type Distribution ===\n');
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`\nUnique types: ${Object.keys(typeCounts).length}`);
  console.log(`Total entities: ${entities.length}`);

  // Save results
  const results = { timestamp: new Date().toISOString(), entities, typeCounts, total: entities.length, uniqueTypes: Object.keys(typeCounts).length };
  fs.writeFileSync('/tmp/scratchpad/entity-type-eval-results.json', JSON.stringify(results, null, 2));

  seme.close();
  console.log('\nResults saved to /tmp/scratchpad/entity-type-eval-results.json');
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });