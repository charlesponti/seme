// src/benchmarks/perf.ts — Performance benchmark for Seme memory system

import { MemoryService } from '../api/service.js';
import * as fs from 'node:fs';

const STORAGE_DIR = '/tmp/scratchpad/seme-bench';
const EMBEDDING_DIM = 4;

interface TimingResult {
  operation: string;
  latencies: number[];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function stats(latencies: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0]?.toFixed(2) ?? '0',
    p50: percentile(sorted, 50).toFixed(2),
    p95: percentile(sorted, 95).toFixed(2),
    p99: percentile(sorted, 99).toFixed(2),
    max: sorted[sorted.length - 1]?.toFixed(2) ?? '0',
    mean: (sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2),
  };
}

function timeIt<T>(fn: () => T | Promise<T>): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  if (result instanceof Promise) {
    // handled by caller
    return { result: result as any, ms: 0 }; // placeholder
  }
  return { result, ms: performance.now() - start };
}

async function timeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
}

async function main() {
  // Clean
  if (fs.existsSync(STORAGE_DIR)) fs.rmSync(STORAGE_DIR, { recursive: true });
  fs.mkdirSync(STORAGE_DIR, { recursive: true });

  const service = new MemoryService({ storageDir: STORAGE_DIR, embeddingDim: EMBEDDING_DIM });
  await service.seedIdentityCore({ name: 'Bench User' }, 'Bench user identity.');

  const results: Record<string, number[]> = {
    'record_turn': [],
    'remember_command': [],
    'boundary_command': [],
    'retrieve_context': [],
    'get_profile': [],
    'forget_command': [],
    'end_session': [],
  };

  const N = 100; // iterations

  console.log(`=== Seme Performance Benchmark (N=${N}) ===\n`);

  // Warm up
  for (let i = 0; i < 5; i++) {
    const sid = `warmup-${i}`;
    await service.recordTurn(sid, 'user', `Warmup turn ${i}`);
    await service.endSession(sid);
  }
  // Wait for extraction to settle
  await new Promise(r => setTimeout(r, 5000));

  // Benchmark: record_turn
  console.log('Benchmarking record_turn...');
  for (let i = 0; i < N; i++) {
    const { ms } = await timeAsync(() => service.recordTurn(`bench-session`, 'user', `Turn ${i}: I like item ${i}`));
    results['record_turn'].push(ms);
  }

  // Benchmark: remember_command
  console.log('Benchmarking remember_command...');
  for (let i = 0; i < N; i++) {
    const sid = `remember-bench-${i}`;
    await service.recordTurn(sid, 'user', `I prefer thing ${i}`);
    const ep = service.getStorage().read((db: any) => db.prepare('SELECT id FROM episodes WHERE session_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(sid) as { id: string });
    const turn = service.getStorage().read((db: any) => db.prepare('SELECT id FROM turns WHERE session_id = ? ORDER BY rowid DESC LIMIT 1').get(sid) as { id: string });
    const { ms } = await timeAsync(() => service.rememberCommand(sid, `thing ${i}`, turn.id, 'preference'));
    results['remember_command'].push(ms);
  }

  // Benchmark: boundary_command
  console.log('Benchmarking boundary_command...');
  for (let i = 0; i < 20; i++) {
    const sid = `boundary-bench-${i}`;
    await service.recordTurn(sid, 'user', `Never do thing ${i}`);
    const turn = service.getStorage().read((db: any) => db.prepare('SELECT id FROM turns WHERE session_id = ? ORDER BY rowid DESC LIMIT 1').get(sid) as { id: string });
    const { ms } = await timeAsync(() => service.boundaryCommand(sid, `Never do thing ${i}`, turn.id));
    results['boundary_command'].push(ms);
  }

  // Benchmark: retrieve_context (with growing memory store)
  console.log('Benchmarking retrieve_context...');
  for (let i = 0; i < N; i++) {
    const start = performance.now();
    service.retrieveContext('bench-session', `What about item ${i}?`);
    results['retrieve_context'].push(performance.now() - start);
  }

  // Benchmark: get_profile
  console.log('Benchmarking get_profile...');
  for (let i = 0; i < N; i++) {
    const start = performance.now();
    service.getProfile();
    results['get_profile'].push(performance.now() - start);
  }

  // Benchmark: end_session (includes async extraction trigger, but measures sync part)
  console.log('Benchmarking end_session (sync ack)...');
  for (let i = 0; i < 20; i++) {
    const sid = `endsession-bench-${i}`;
    await service.recordTurn(sid, 'user', `Session ${i} content with some facts.`);
    const { ms } = await timeAsync(() => service.endSession(sid));
    results['end_session'].push(ms);
  }

  // Wait for all async extractions
  console.log('\nWaiting for async extractions to settle...');
  await new Promise(r => setTimeout(r, 30000));

  // Print results
  console.log('\n' + '='.repeat(80));
  console.log('RESULTS (ms)');
  console.log('='.repeat(80));
  console.log('Operation'.padEnd(25) + 'Count'.padStart(7) + 'Min'.padStart(8) + 'Mean'.padStart(8) + 'p50'.padStart(8) + 'p95'.padStart(8) + 'p99'.padStart(8) + 'Max'.padStart(8));
  console.log('-'.repeat(80));

  for (const [op, latencies] of Object.entries(results)) {
    if (latencies.length === 0) continue;
    const s = stats(latencies);
    console.log(
      op.padEnd(25) +
      String(s.count).padStart(7) +
      s.min.padStart(8) +
      s.mean.padStart(8) +
      s.p50.padStart(8) +
      s.p95.padStart(8) +
      s.p99.padStart(8) +
      s.max.padStart(8)
    );
  }

  // Memory store size
  const db = service.getStorage();
  const memCount = db.read((d: any) => d.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number });
  const turnCount = db.read((d: any) => d.prepare('SELECT COUNT(*) as c FROM turns').get() as { c: number });
  const epCount = db.read((d: any) => d.prepare('SELECT COUNT(*) as c FROM episodes').get() as { c: number });
  console.log('\nStore size: memories=' + memCount.c + ' turns=' + turnCount.c + ' episodes=' + epCount.c);

  service.close();
  console.log('\n=== Benchmark complete ===');
}

main().catch(console.error);