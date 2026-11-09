// Routing eval: does the skill router load the right modules for a message?
//
// Embeds the module descriptions and every routing-set utterance once, then sweeps
// the similarity floor and topK locally. No LLM calls. Dev picks the configuration
// (best macro-F1 subject to ≤10% false activations on no-module messages); test is
// scored once at that configuration.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  createEmbeddingProvider,
  embeddingModelId,
  EmbeddingProvider,
} from '../../embeddings/embedding-provider.js';
import { loadSkillModules } from '../../skills/catalog.js';
import { cosine, skillsEnabled } from '../../skills/router.js';
import { ROUTING_CASES, type RoutingCase } from './routing-set.js';

const API_ROOT = resolve(__dirname, '../../..');
const RESULTS_DIR = join(API_ROOT, 'evals', 'results');
const MAX_NEGATIVE_FALSE_ACTIVATION = 0.1;

interface Scored {
  case: RoutingCase;
  scores: Record<string, number>;
}

interface Config {
  minScore: number;
  topK: number;
}

interface Metrics {
  macroF1: number;
  exact: number;
  negativeFalseActivation: number;
  perModule: Record<string, { precision: number; recall: number; f1: number }>;
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Modules predicted for one utterance under a config. */
function predict(scores: Record<string, number>, cfg: Config): string[] {
  return Object.entries(scores)
    .filter(([, s]) => s >= cfg.minScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, cfg.topK)
    .map(([name]) => name);
}

function evaluate(rows: Scored[], cfg: Config, moduleNames: string[]): Metrics {
  const perModule: Metrics['perModule'] = {};
  const f1s: number[] = [];
  for (const m of moduleNames) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const r of rows) {
      const predicted = predict(r.scores, cfg).includes(m);
      const expected = r.case.expect.includes(m);
      if (predicted && expected) tp++;
      else if (predicted) fp++;
      else if (expected) fn++;
    }
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    perModule[m] = { precision: round(precision), recall: round(recall), f1: round(f1) };
    f1s.push(f1);
  }

  const negatives = rows.filter((r) => r.case.expect.length === 0);
  const falseActive = negatives.filter((r) => predict(r.scores, cfg).length > 0).length;
  const exactHits = rows.filter((r) => {
    const p = predict(r.scores, cfg).sort().join(',');
    return p === [...r.case.expect].sort().join(',');
  }).length;

  return {
    macroF1: round(f1s.reduce((a, b) => a + b, 0) / f1s.length),
    exact: round(exactHits / rows.length),
    negativeFalseActivation: round(negatives.length === 0 ? 0 : falseActive / negatives.length),
    perModule,
  };
}

async function embedAll(embedder: EmbeddingProvider, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 32) {
    out.push(...(await embedder.embedBatch(texts.slice(i, i + 32))));
  }
  return out;
}

export async function runRouting(out: (line: string) => void = console.log): Promise<void> {
  if (!skillsEnabled()) {
    console.error(
      'Routing eval needs embeddings. Set an embed provider (SEME_EMBED_PROVIDER is set to none).',
    );
    process.exit(2);
  }
  const modules = loadSkillModules(join(API_ROOT, 'skills'));
  const moduleNames = modules.map((m) => m.name);
  const embedder = createEmbeddingProvider();

  const moduleVectors = await embedAll(
    embedder,
    modules.map((m) => m.description),
  );
  const queryVectors = await embedAll(
    embedder,
    ROUTING_CASES.map((c) => c.text),
  );
  const rows: Scored[] = ROUTING_CASES.map((c, i) => ({
    case: c,
    scores: Object.fromEntries(
      modules.map((m, j) => [m.name, round(cosine(queryVectors[i], moduleVectors[j]))]),
    ),
  }));

  const dev = rows.filter((r) => r.case.split === 'dev');
  const test = rows.filter((r) => r.case.split === 'test');

  // Sweep the floor and topK on dev only.
  const grid: { cfg: Config; dev: Metrics }[] = [];
  for (let s = 20; s <= 45; s++) {
    for (let k = 1; k <= 3; k++) {
      const cfg = { minScore: s / 100, topK: k };
      grid.push({ cfg, dev: evaluate(dev, cfg, moduleNames) });
    }
  }
  const allowed = grid.filter(
    (g) => g.dev.negativeFalseActivation <= MAX_NEGATIVE_FALSE_ACTIVATION,
  );
  const pool = allowed.length > 0 ? allowed : grid;
  const best = [...pool].sort(
    (a, b) => b.dev.macroF1 - a.dev.macroF1 || b.dev.exact - a.dev.exact,
  )[0];

  const testMetrics = evaluate(test, best.cfg, moduleNames);

  out(
    `Routing eval: ${ROUTING_CASES.length} utterances (${dev.length} dev, ${test.length} test), modules: ${moduleNames.join(', ')}`,
  );
  out(
    `\nTop dev configurations (negative false-activation ≤ ${MAX_NEGATIVE_FALSE_ACTIVATION}${allowed.length === 0 ? ' — NONE MET, showing unconstrained' : ''}):`,
  );
  for (const g of [...pool]
    .sort((a, b) => b.dev.macroF1 - a.dev.macroF1 || b.dev.exact - a.dev.exact)
    .slice(0, 5)) {
    out(
      `  minScore ${g.cfg.minScore.toFixed(2)}  topK ${g.cfg.topK}  macroF1 ${g.dev.macroF1}  exact ${g.dev.exact}  negFA ${g.dev.negativeFalseActivation}`,
    );
  }
  out(`\nChosen on dev: minScore ${best.cfg.minScore.toFixed(2)}, topK ${best.cfg.topK}`);
  out(
    `Test (scored once): macroF1 ${testMetrics.macroF1}  exact ${testMetrics.exact}  negFA ${testMetrics.negativeFalseActivation}`,
  );
  for (const [m, pm] of Object.entries(testMetrics.perModule)) {
    out(`  ${m.padEnd(26)} precision ${pm.precision}  recall ${pm.recall}  f1 ${pm.f1}`);
  }
  const misses = test.filter(
    (r) => predict(r.scores, best.cfg).sort().join(',') !== [...r.case.expect].sort().join(','),
  );
  if (misses.length) {
    out('\nTest misses:');
    for (const r of misses) {
      out(
        `  expected [${r.case.expect.join(', ')}] got [${predict(r.scores, best.cfg).join(', ')}]  "${r.case.text}"`,
      );
    }
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(RESULTS_DIR, `routing-${ts}.json`);
  writeFileSync(
    path,
    JSON.stringify(
      {
        ts,
        embed_model: embeddingModelId(),
        modules: moduleNames,
        constraint: MAX_NEGATIVE_FALSE_ACTIVATION,
        chosen: best.cfg,
        dev: best.dev,
        test: testMetrics,
        grid: grid.map((g) => ({
          ...g.cfg,
          dev: {
            macroF1: g.dev.macroF1,
            exact: g.dev.exact,
            negativeFalseActivation: g.dev.negativeFalseActivation,
          },
        })),
      },
      null,
      2,
    ),
  );
  out(`\nSaved ${path}`);
}
