// src/evals/extraction-eval.ts — Extraction model comparison harness

import { Extractor, ExtractInput } from '../extraction/extractor.js';
import * as fs from 'node:fs';

const STORAGE_DIR = '/tmp/scratchpad/seme-eval';
const EMBEDDING_DIM = 4;

// Test cases: conversation → expected extraction behavior
interface TestCase {
  name: string;
  turns: { id: string; role: string; content: string; ts: string }[];
  checks: ((output: any) => { passed: boolean; details: string })[];
}

const testCases: TestCase[] = [
  {
    name: 'Basic facts and preferences',
    turns: [
      { id: 't1', role: 'user', content: 'My name is Charles and I live in London.', ts: '2026-10-24T10:00:00Z' },
      { id: 't2', role: 'assistant', content: 'Nice to meet you, Charles!', ts: '2026-10-24T10:00:01Z' },
      { id: 't3', role: 'user', content: 'I love TypeScript and I am interested in memory systems.', ts: '2026-10-24T10:00:02Z' },
    ],
    checks: [
      (o) => ({ passed: o.memory_candidates.length >= 3, details: `Expected ≥3 memory candidates, got ${o.memory_candidates.length}` }),
      (o) => ({ passed: o.memory_candidates.some((c: any) => c.kind === 'fact' && c.slot === 'name'), details: 'Should extract name fact' }),
      (o) => ({ passed: o.memory_candidates.some((c: any) => c.kind === 'interest'), details: 'Should extract interest' }),
      (o) => ({ passed: o.memory_candidates.every((c: any) => c.source_type === 'user_stated' || c.source_type === 'agent_inferred'), details: 'All should be user_stated or agent_inferred' }),
    ],
  },
  {
    name: 'Hypothetical should not become stated fact',
    turns: [
      { id: 't1', role: 'user', content: 'If I lived in Japan, I would eat sushi every day.', ts: '2026-10-24T10:00:00Z' },
      { id: 't2', role: 'assistant', content: 'That sounds delicious!', ts: '2026-10-24T10:00:01Z' },
    ],
    checks: [
      (o) => ({ passed: !o.memory_candidates.some((c: any) => c.modality === 'stated' && c.value_text.toLowerCase().includes('japan')), details: 'Hypothetical should not produce stated fact about living in Japan' }),
      (o) => ({ passed: o.memory_candidates.length === 0 || o.memory_candidates.every((c: any) => c.modality !== 'stated'), details: 'No stated modality candidates expected' }),
    ],
  },
  {
    name: 'Negation preserved',
    turns: [
      { id: 't1', role: 'user', content: "I don't drink alcohol and I never eat meat.", ts: '2026-10-24T10:00:00Z' },
    ],
    checks: [
      (o) => ({ passed: o.memory_candidates.length >= 1, details: `Expected ≥1 candidate, got ${o.memory_candidates.length}` }),
      (o) => ({ passed: o.memory_candidates.some((c: any) => c.modality === 'negated'), details: 'Should have negated modality' }),
      (o) => ({ passed: o.memory_candidates.every((c: any) => c.value_text.toLowerCase().includes("don't") || c.value_text.toLowerCase().includes('never') || c.value_text.toLowerCase().includes('not')), details: 'Negation should be preserved in value_text' }),
    ],
  },
  {
    name: 'Transient state not a trait',
    turns: [
      { id: 't1', role: 'user', content: "I'm exhausted today, didn't sleep well last night.", ts: '2026-10-24T10:00:00Z' },
    ],
    checks: [
      (o) => ({ passed: !o.memory_candidates.some((c: any) => c.kind === 'trait_inference'), details: 'Transient state should not produce trait_inference' }),
      (o) => ({ passed: !o.memory_candidates.some((c: any) => c.kind === 'preference' || c.kind === 'routine'), details: 'Transient state should not produce preference/routine' }),
    ],
  },
  {
    name: 'Compliment becomes feedback, not trait',
    turns: [
      { id: 't1', role: 'user', content: 'You did a great job with that answer!', ts: '2026-10-24T10:00:00Z' },
      { id: 't2', role: 'assistant', content: 'Thank you!', ts: '2026-10-24T10:00:01Z' },
    ],
    checks: [
      (o) => ({ passed: o.feedback_event_candidates.length >= 1, details: `Expected ≥1 feedback event, got ${o.feedback_event_candidates.length}` }),
      (o) => ({ passed: o.feedback_event_candidates.some((f: any) => f.signal_type === 'compliment_specific'), details: 'Should be compliment_specific' }),
      (o) => ({ passed: o.memory_candidates.length === 0, details: `Expected 0 memory candidates, got ${o.memory_candidates.length}` }),
    ],
  },
  {
    name: 'Assistant suggestion not adopted',
    turns: [
      { id: 't1', role: 'assistant', content: 'You should try using Vim for editing.', ts: '2026-10-24T10:00:00Z' },
      { id: 't2', role: 'user', content: 'Interesting, tell me more about it.', ts: '2026-10-24T10:00:01Z' },
    ],
    checks: [
      (o) => ({ passed: !o.memory_candidates.some((c: any) => c.value_text.toLowerCase().includes('vim')), details: 'Assistant suggestion not adopted should not produce memory' }),
    ],
  },
  {
    name: 'Assistant suggestion adopted',
    turns: [
      { id: 't1', role: 'assistant', content: 'You should try using Vim for editing.', ts: '2026-10-24T10:00:00Z' },
      { id: 't2', role: 'user', content: 'Yes, let me try Vim. I will switch to it.', ts: '2026-10-24T10:00:01Z' },
    ],
    checks: [
      (o) => ({ passed: o.memory_candidates.length >= 1, details: `Expected ≥1 candidate for adopted suggestion, got ${o.memory_candidates.length}` }),
      (o) => ({ passed: o.memory_candidates.some((c: any) => c.source_turn_id === 't2'), details: 'Should cite user adoption turn (t2), not assistant turn' }),
    ],
  },
  {
    name: 'Boundary statement',
    turns: [
      { id: 't1', role: 'user', content: 'Never call me Chuck. That is my boundary.', ts: '2026-10-24T10:00:00Z' },
    ],
    checks: [
      (o) => ({ passed: o.memory_candidates.some((c: any) => c.kind === 'boundary'), details: 'Should extract boundary' }),
      (o) => ({ passed: o.memory_candidates.some((c: any) => c.source_type === 'user_stated'), details: 'Boundary should be user_stated' }),
    ],
  },
  {
    name: 'Empty episode',
    turns: [],
    checks: [
      (o) => ({ passed: o.memory_candidates.length === 0 && o.feedback_event_candidates.length === 0, details: 'Empty episode should return empty arrays' }),
    ],
  },
  {
    name: 'Pasted third-party content',
    turns: [
      { id: 't1', role: 'user', content: 'Here is an article I found: "AI will replace all programmers by 2030." What do you think?', ts: '2026-10-24T10:00:00Z' },
    ],
    checks: [
      (o) => ({ passed: !o.memory_candidates.some((c: any) => c.source_type === 'user_stated' && c.value_text.toLowerCase().includes('replace all programmers')), details: 'Pasted content should not become user_stated fact' }),
    ],
  },
  {
    name: 'Non-salient turns emit nothing',
    turns: [
      { id: 't1', role: 'user', content: 'Hi there!', ts: '2026-10-24T10:00:00Z' },
      { id: 't2', role: 'assistant', content: 'Hello! How can I help?', ts: '2026-10-24T10:00:01Z' },
      { id: 't3', role: 'user', content: 'Thanks, bye!', ts: '2026-10-24T10:00:02Z' },
    ],
    checks: [
      (o) => ({ passed: o.memory_candidates.length === 0, details: `Expected 0 candidates for greetings, got ${o.memory_candidates.length}` }),
    ],
  },
];

async function runEval(model: string, apiKey: string) {
  const extractor = new (require('../extraction/extractor.js').Extractor)(null, model, apiKey);
  const results: { name: string; passed: number; total: number; details: string[] }[] = [];

  for (const tc of testCases) {
    const input = {
      episode_id: 'eval-episode',
      turns: tc.turns,
      rolling_summary: null,
      recent_messages: tc.turns.slice(-3),
    };

    let output;
    try {
      output = await extractor.extract(input);
    } catch (e: any) {
      results.push({ name: tc.name, passed: 0, total: tc.checks.length, details: [`ERROR: ${e.message}`] });
      continue;
    }

    let passed = 0;
    const details: string[] = [];
    for (const check of tc.checks) {
      const result = check(output);
      if (result.passed) passed++;
      details.push(`${result.passed ? '✓' : '✗'} ${result.details}`);
    }
    results.push({ name: tc.name, passed, total: tc.checks.length, details });
  }

  return results;
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  const models = ['google/gemini-3.8-flash', 'anthropic/claude-haiku-5.5'];

  for (const model of models) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`MODEL: ${model}`);
    console.log('='.repeat(60));

    const results = await runEval(model, apiKey);
    let totalPassed = 0;
    let totalChecks = 0;

    for (const r of results) {
      totalPassed += r.passed;
      totalChecks += r.total;
      const status = r.passed === r.total ? '✓' : r.passed === 0 ? '✗' : '~';
      console.log(`\n${status} ${r.name} (${r.passed}/${r.total})`);
      for (const d of r.details) console.log(`   ${d}`);
    }

    console.log(`\nTOTAL: ${totalPassed}/${totalChecks} (${((totalPassed/totalChecks)*100).toFixed(1)}%)`);
  }
}

main().catch(console.error);