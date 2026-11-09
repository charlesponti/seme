// One-time import of the old JSON files (evals/results and evals/baselines) into the eval database.
//
//   node dist/evals/suite/import-json.js [--results <dir>] [--baselines <dir>]
//
// Re-running is safe: rows are replaced by id, so nothing doubles up.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { openEvalsDb, saveBaseline, saveRun, evalsDbPath } from './store.js';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const API_ROOT = resolve(__dirname, '../../..');
const RESULTS_DIR = resolve(opt('results', join(API_ROOT, 'evals', 'results')));
const BASELINES_DIR = resolve(opt('baselines', join(API_ROOT, 'evals', 'baselines')));

// Not runs: the rolling copies and the other scripts' outputs.
const SKIP = new Set(['latest.json', 'history.json']);
const SKIP_PREFIX = ['routing-', 'relation-calibration-', 'report'];

const db = openEvalsDb();
let runs = 0;
let baselines = 0;
let skipped = 0;

if (existsSync(RESULTS_DIR)) {
  for (const file of readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    if (SKIP.has(file) || SKIP_PREFIX.some((p) => file.startsWith(p))) continue;
    const id = basename(file, '.json');
    const kind = id.endsWith('-filter') ? 'filter' : 'full';
    const result = JSON.parse(readFileSync(join(RESULTS_DIR, file), 'utf8'));
    if (!result.meta?.ts || !result.metrics || !Array.isArray(result.runs)) {
      console.log(`skip ${file}: not a run result`);
      skipped++;
      continue;
    }
    saveRun(db, id, kind, result);
    runs++;
  }
}

if (existsSync(BASELINES_DIR)) {
  for (const file of readdirSync(BASELINES_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const name = basename(file, '.json');
    const data = JSON.parse(readFileSync(join(BASELINES_DIR, file), 'utf8'));
    if (!data.metrics) {
      console.log(`skip baseline ${file}: no metrics`);
      skipped++;
      continue;
    }
    saveBaseline(db, name, { meta: data.meta ?? {}, metrics: data.metrics });
    baselines++;
  }
}

console.log(
  `imported ${runs} runs and ${baselines} baselines into ${evalsDbPath()} (${skipped} skipped)`,
);
