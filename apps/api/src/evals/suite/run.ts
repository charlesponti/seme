// Seme extraction eval runner.
//
//   node dist/evals/suite/run.js [--suite core|diary] [--filter <text>] [--repeats <n>] [--concurrency <n>]
//                                [--judge] [--name <n>] [--baseline <n>]
//                                [--fail-on-regression] [--tolerance <0..1>]
//
// Runs and baselines go to the eval database (~/.hominem/seme.evals.db, see store.ts).
// Full runs also write report.html and report.md next to it. Filtered runs are stored as
// scratch and never touch the history or the report.
// --name saves a baseline row; --baseline compares to one.
// Exits 1 when a hard gate fails, or when --fail-on-regression is set and a metric regressed.
// Exits 2 when skills are on but the embedder is unreachable, or a routed chunk was skipped.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { CASES, type Case } from './dataset.js';
import { DIARY_CASES, PEOPLE_CASES } from './diary/cases.js';
import { gradeCase, type CaseGrade, type PredOutput } from './grade.js';
import { runCase } from './harness.js';
import { calibrate, judgeCase, judgeConfig, type JudgeCaseResult } from './judge.js';
import { renderHtml, renderMarkdown } from './report.js';
import { runRouting } from './routing.js';
import { judgeRelations } from './relation-judge.js';
import {
  evalsHome,
  loadBaseline,
  openEvalsDb,
  recentHistory,
  saveBaseline,
  saveRun,
} from './store.js';
import { createEmbeddingProvider, embeddingModelId } from '../../embeddings/embedding-provider.js';
import { skillStats, skillsEnabled } from '../../skills/router.js';

// ── CLI ───────────────────────────────────────────────────────────────────

// The pipeline logs every extraction to stdout; keep the runner's output readable.
const print = console.log.bind(console);
console.log = () => {};

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const API_ROOT = resolve(__dirname, '../../..');

const FILTER = opt('filter', '');
const REPEATS = Math.max(1, parseInt(opt('repeats', '1'), 10));
const CONCURRENCY = Math.max(1, parseInt(opt('concurrency', '4'), 10));
const TOLERANCE = parseFloat(opt('tolerance', '0.05'));
const USE_JUDGE = flag('judge');
const RELATION_JUDGE = flag('relation-judge');
const NAME = opt('name', '');
const BASELINE_NAME = opt('baseline', '');
const FAIL_ON_REGRESSION = flag('fail-on-regression');
// core: the 120-case dataset. diary: the five-year diary sample (see diary/cases.ts).
const SUITE = opt('suite', 'core');
const SUITE_CASES: Case[] =
  SUITE === 'diary' ? DIARY_CASES : SUITE === 'people' ? PEOPLE_CASES : CASES;

// ── Run fingerprint ───────────────────────────────────────────────────────

/** Hash of every file under a directory, path included. Empty dirs hash to a fixed value. */
function hashTree(dir: string): string {
  const h = createHash('sha256');
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        h.update(p.slice(dir.length));
        h.update(readFileSync(p));
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return h.digest('hex').slice(0, 16);
}

/** What produced this run. Baselines are only comparable when the fields that matter match. */
function runConfig() {
  const git = (cmd: string): string | null => {
    try {
      return execSync(cmd, { cwd: API_ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      return null;
    }
  };
  const dirty = git('git status --porcelain -- src skills');
  return {
    git_sha: git('git rev-parse --short HEAD'),
    git_dirty: dirty === null ? null : dirty.length > 0,
    src_hash: hashTree(join(API_ROOT, 'src')),
    skills_hash: hashTree(join(API_ROOT, 'skills')),
    suite: SUITE,
    dataset_hash: createHash('sha256')
      .update(JSON.stringify(SUITE_CASES))
      .digest('hex')
      .slice(0, 16),
    seme_skills: skillsEnabled() ? 'on' : 'off',
    extractor_model: process.env.SEME_EXTRACTOR_MODEL || 'anthropic/claude-haiku-5.5',
    embed_model: embeddingModelId(),
    relation_judge: RELATION_JUDGE ? 'on' : 'off',
  };
}

type RunConfig = ReturnType<typeof runConfig>;

/** Config fields whose change makes a comparison unreliable. src_hash changes on any edit, so it is informational only. */
const COMPARABLE_FIELDS: (keyof RunConfig)[] = [
  'suite',
  'dataset_hash',
  'seme_skills',
  'extractor_model',
  'embed_model',
  'relation_judge',
];

// ── Helpers ───────────────────────────────────────────────────────────────

function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  return Promise.all(workers).then(() => out);
}

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);

function f1(p: number | null, r: number | null): number | null {
  if (p === null || r === null || p + r === 0) return null;
  return (2 * p * r) / (p + r);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// ── Per-run record ────────────────────────────────────────────────────────

interface CaseRun {
  id: string;
  category: string;
  tags: string[];
  repeat: number;
  pass: boolean;
  grade: CaseGrade | null;
  pred: PredOutput | null;
  judge: JudgeCaseResult | null;
  /** NLI relation judge: predicted relations, and how many the text supports. Null when the judge is off. */
  relation_judge: { pred: number; supported: number } | null;
  latency_ms: number;
  error?: string;
}

async function executeOne(
  c: Case,
  repeat: number,
  storageRoot: string,
  judgeCfg: ReturnType<typeof judgeConfig>,
): Promise<CaseRun> {
  try {
    const { pred, latencyMs } = await runCase(c, storageRoot);
    const grade = gradeCase(c, pred);
    let judge: JudgeCaseResult | null = null;
    if (USE_JUDGE && judgeCfg) {
      const claims = (c.expect.memories ?? []).map(
        (g) => g.claim ?? g.must.map((a) => (Array.isArray(a) ? a.join('/') : a)).join(' + '),
      );
      judge = await judgeCase(
        judgeCfg,
        pred.turns.filter((t) => t.role === 'user'),
        pred.memories,
        claims,
      );
    }
    const relation_judge = RELATION_JUDGE ? await judgeRelations(pred.relations) : null;
    return {
      id: c.id,
      category: c.category,
      tags: c.tags,
      repeat,
      pass: grade.pass,
      grade,
      pred,
      judge,
      relation_judge,
      latency_ms: latencyMs,
    };
  } catch (e: any) {
    return {
      id: c.id,
      category: c.category,
      tags: c.tags,
      repeat,
      pass: false,
      grade: null,
      pred: null,
      judge: null,
      relation_judge: null,
      latency_ms: 0,
      error: e?.message ?? String(e),
    };
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────

function aggregate(runs: CaseRun[], cases: Case[]) {
  const graded = runs.filter((r) => r.grade).map((r) => r.grade!);
  const sum = (f: (g: CaseGrade) => number) => graded.reduce((acc, g) => acc + f(g), 0);

  const entityTp = sum((g) => g.counts.entity_tp);
  const entityPred = sum((g) =>
    g.counts.entity_gold > 0 || g.checks.some((c) => c.name === 'entities')
      ? g.counts.entity_pred
      : 0,
  );
  const entityGold = sum((g) => g.counts.entity_gold);
  const entityP = ratio(entityTp, entityPred);
  const entityR = ratio(entityTp, entityGold);

  const relTp = sum((g) => g.counts.relation_tp);
  const relPred = sum((g) =>
    g.checks.some((c) => c.name === 'relations') ? g.counts.relation_pred : 0,
  );
  const relGold = sum((g) => g.counts.relation_gold);
  const relP = ratio(relTp, relPred);
  const relR = ratio(relTp, relGold);

  // Precision on exhaustive cases only: there the gold list is complete, so a wrong extra counts.
  const entityPrecisePred = sum((g) => (g.counts.precision_scored ? g.counts.entity_pred : 0));
  const entityPreciseOk = sum((g) =>
    g.counts.precision_scored ? g.counts.entity_pred - g.counts.entity_unexpected : 0,
  );
  const relPrecisePred = sum((g) => (g.counts.precision_scored ? g.counts.relation_pred : 0));
  const relPreciseOk = sum((g) =>
    g.counts.precision_scored ? g.counts.relation_pred - g.counts.relation_unexpected : 0,
  );
  const judgedPred = runs.reduce((acc, r) => acc + (r.relation_judge?.pred ?? 0), 0);
  const judgedSupported = runs.reduce((acc, r) => acc + (r.relation_judge?.supported ?? 0), 0);
  const precisionScoredCases = new Set(
    graded.filter((g) => g.counts.precision_scored).map((g) => g.id),
  ).size;

  const memHit = sum((g) => g.counts.memory_hit);
  const memGold = sum((g) => g.counts.memory_gold);
  const precise = sum((g) => (g.counts.memory_precision_scored ? g.counts.memory_precise : 0));
  const precisePred = sum((g) => (g.counts.memory_precision_scored ? g.counts.memory_pred : 0));

  const provChecked = sum((g) => g.counts.provenance_checked);
  const provBad = sum((g) => g.counts.provenance_bad);

  const typeOk = sum((g) => g.counts.entity_type_ok);
  const typeChecked = sum((g) => g.counts.entity_type_checked);

  const passRate = ratio(runs.filter((r) => r.pass).length, runs.length) ?? 0;

  // Consistency across repeats: pass@k (any repeat passes) and pass^k (every repeat passes).
  const byCase = new Map<string, CaseRun[]>();
  for (const r of runs) byCase.set(r.id, [...(byCase.get(r.id) ?? []), r]);
  const perCase = [...byCase.values()];
  const passAtK = perCase.length
    ? perCase.filter((rs) => rs.some((r) => r.pass)).length / perCase.length
    : 0;
  const passPowK = perCase.length
    ? perCase.filter((rs) => rs.every((r) => r.pass)).length / perCase.length
    : 0;

  const subset = (pred: (r: CaseRun) => boolean) => {
    const rs = runs.filter(pred);
    return ratio(rs.filter((r) => r.pass).length, rs.length);
  };
  const abstentionPass = subset((r) => r.category === 'abstention');
  const safetyPass = subset((r) => r.tags.some((t) => t.startsWith('safety')));
  const feedbackRuns = runs.filter((r) => r.grade?.checks.some((c) => c.name === 'feedback'));
  const feedbackPass = ratio(feedbackRuns.filter((r) => r.pass).length, feedbackRuns.length);

  // Judge (informational; not part of pass/fail).
  const judged = runs.filter((r) => r.judge);
  const groundedness = judged.flatMap((r) => r.judge!.groundedness);
  const coverage = judged.flatMap((r) => r.judge!.coverage);

  const latencies = runs.map((r) => r.latency_ms).filter((ms) => ms > 0);

  const categories: Record<string, { cases: number; runs: number; pass_rate: number }> = {};
  for (const cat of new Set(cases.map((c) => c.category))) {
    const rs = runs.filter((r) => r.category === cat);
    categories[cat] = {
      cases: new Set(rs.map((r) => r.id)).size,
      runs: rs.length,
      pass_rate: ratio(rs.filter((r) => r.pass).length, rs.length) ?? 0,
    };
  }

  const metrics = {
    pass_rate: passRate,
    pass_at_k: passAtK,
    pass_pow_k: passPowK,
    entity_precision: entityP,
    entity_recall: entityR,
    entity_f1: f1(entityP, entityR),
    entity_type_accuracy: ratio(typeOk, typeChecked),
    relation_precision: relP,
    relation_recall: relR,
    relation_f1: f1(relP, relR),
    memory_recall: ratio(memHit, memGold),
    memory_precision: ratio(precise, precisePred),
    entity_precision_exhaustive: ratio(entityPreciseOk, entityPrecisePred),
    relation_precision_exhaustive: ratio(relPreciseOk, relPrecisePred),
    // Judge-based precision: share of predicted relations the source sentence supports. Null when the judge is off.
    relation_precision_judge: judgedPred === 0 ? null : ratio(judgedSupported, judgedPred),
    precision_scored_cases: precisionScoredCases,
    forbidden_violations: sum((g) => g.counts.forbidden_hits),
    provenance_rate: ratio(provChecked - provBad, provChecked),
    abstention_pass_rate: abstentionPass,
    safety_pass_rate: safetyPass,
    feedback_pass_rate: feedbackPass,
    judge_supported_rate: ratio(
      groundedness.filter((g) => g.verdict === 'supported').length,
      groundedness.length,
    ),
    judge_contradicted: groundedness.filter((g) => g.verdict === 'contradicted').length,
    judge_coverage_rate: ratio(coverage.filter((c) => c.covered).length, coverage.length),
    latency_p50_ms: percentile(latencies, 50),
    latency_p95_ms: percentile(latencies, 95),
  };

  return { metrics, categories, cases: perCase.length, runs: runs.length };
}

interface Gate {
  name: string;
  value: number | null;
  threshold: number;
  kind: 'hard' | 'soft';
  pass: boolean;
}

function gates(
  m: ReturnType<typeof aggregate>['metrics'],
  judged: boolean,
  calibration: number | null,
): Gate[] {
  const g = (
    name: string,
    value: number | null,
    threshold: number,
    kind: 'hard' | 'soft',
    op: 'gte' | 'eq' = 'gte',
  ): Gate => ({
    name,
    value,
    threshold,
    kind,
    pass: value === null ? true : op === 'eq' ? value === threshold : value >= threshold,
  });
  const list = [
    g('provenance_rate', m.provenance_rate, 1, 'hard', 'eq'),
    g('forbidden_violations', m.forbidden_violations, 0, 'hard', 'eq'),
    g('safety_pass_rate', m.safety_pass_rate, 1, 'hard', 'eq'),
    g('abstention_pass_rate', m.abstention_pass_rate, 1, 'hard', 'eq'),
    g('pass_rate', m.pass_rate, 0.8, 'soft'),
    g('entity_recall', m.entity_recall, 0.85, 'soft'),
    g('relation_recall', m.relation_recall, 0.75, 'soft'),
    g('memory_recall', m.memory_recall, 0.85, 'soft'),
    g('entity_precision_exhaustive', m.entity_precision_exhaustive, 0.9, 'soft'),
    g('relation_precision_exhaustive', m.relation_precision_exhaustive, 0.9, 'soft'),
  ];
  if (judged) {
    list.push(g('judge_supported_rate', m.judge_supported_rate, 0.9, 'soft'));
    if (calibration !== null) list.push(g('judge_calibration', calibration, 0.85, 'soft'));
  }
  // Hard gates are scored by their own threshold; a null value (nothing to test) passes.
  return list;
}

function regressions(
  current: Record<string, number | null>,
  baseline: Record<string, number | null> | null,
) {
  if (!baseline) return [];
  const out: { metric: string; baseline: number; current: number; drop: number }[] = [];
  for (const [name, cur] of Object.entries(current)) {
    const base = baseline[name];
    if (cur === null || base === null || base === undefined) continue;
    if (
      name.startsWith('latency_') ||
      name === 'forbidden_violations' ||
      name === 'judge_contradicted'
    )
      continue;
    const drop = base - cur;
    if (drop > TOLERANCE) out.push({ metric: name, baseline: base, current: cur, drop });
  }
  return out;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (flag('routing')) {
    await runRouting(print);
    return;
  }
  const selected = SUITE_CASES.filter(
    (c) =>
      !FILTER ||
      c.id.includes(FILTER) ||
      c.category.includes(FILTER) ||
      c.tags.some((t) => t.includes(FILTER)),
  );
  print(`Suite: ${SUITE} (${selected.length} cases)`);
  if (selected.length === 0) {
    console.error(`No cases match "${FILTER}".`);
    process.exit(2);
  }
  // A partial run can't be a baseline: it would compare against a different case set.
  if (NAME && FILTER) {
    console.error('--name needs a full run. Drop --filter to save a baseline.');
    process.exit(2);
  }

  const config = runConfig();
  if (config.seme_skills === 'on') {
    // Fail loudly rather than run a "skills on" eval that is really skills off.
    try {
      await createEmbeddingProvider().embed('probe');
    } catch (e) {
      console.error(
        `Skills are on but the embedder is unreachable (${(e as Error).message}). Start Ollama.`,
      );
      process.exit(2);
    }
  }
  skillStats.calls = 0;
  skillStats.routed = 0;
  skillStats.skipped = 0;

  const evalsDb = openEvalsDb();
  let baselineFile: { meta?: Partial<RunConfig>; metrics: Record<string, number | null> } | null =
    null;
  if (BASELINE_NAME) {
    const found = loadBaseline(evalsDb, BASELINE_NAME);
    if (!found) {
      console.error(`No baseline named "${BASELINE_NAME}" in the eval database.`);
      process.exit(2);
    }
    baselineFile = found as unknown as {
      meta?: Partial<RunConfig>;
      metrics: Record<string, number | null>;
    };
  }

  const judgeCfg = USE_JUDGE ? judgeConfig() : null;
  if (USE_JUDGE && !judgeCfg) {
    console.error('--judge needs OPENROUTER_API_KEY (or ~/.localrc). Running without the judge.');
  }
  const judged = judgeCfg !== null;

  const storageRoot = mkdtempSync(join(tmpdir(), 'seme-eval-'));
  const started = Date.now();

  print(
    `Seme eval: ${selected.length} cases × ${REPEATS} repeat(s), concurrency ${CONCURRENCY}${judged ? `, judge ${judgeCfg!.model}` : ''}`,
  );

  const tasks = selected.flatMap((c) =>
    Array.from({ length: REPEATS }, (_, r) => ({ c, r: r + 1 })),
  );
  let done = 0;
  const runs = await pool(tasks, CONCURRENCY, async ({ c, r }) => {
    const run = await executeOne(c, r, storageRoot, judgeCfg);
    done++;
    const mark = run.pass ? 'PASS' : 'FAIL';
    process.stdout.write(
      `\r  [${done}/${tasks.length}] ${mark} ${run.id}${REPEATS > 1 ? ` #${r}` : ''}        `,
    );
    return run;
  });
  process.stdout.write('\n');
  rmSync(storageRoot, { recursive: true, force: true });

  let calibration: { accuracy: number; n: number; misses: string[] } | null = null;
  if (judged) calibration = await calibrate(judgeCfg!);

  const agg = aggregate(runs, selected);
  const gateList = gates(agg.metrics, judged, calibration?.accuracy ?? null);
  const mismatches = baselineFile?.meta
    ? COMPARABLE_FIELDS.filter(
        (k) => baselineFile!.meta![k] !== undefined && baselineFile!.meta![k] !== config[k],
      )
    : [];
  const regs = regressions(
    agg.metrics as Record<string, number | null>,
    baselineFile?.metrics ?? null,
  );
  const skills = {
    chunks: skillStats.calls,
    routed: skillStats.routed,
    skipped: skillStats.skipped,
  };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const result = {
    meta: {
      ts,
      cases: agg.cases,
      runs: agg.runs,
      repeats: REPEATS,
      concurrency: CONCURRENCY,
      filter: FILTER || null,
      judge_model: judged ? judgeCfg!.model : null,
      duration_s: Math.round((Date.now() - started) / 1000),
      baseline: BASELINE_NAME ? true : false,
      baseline_name: BASELINE_NAME || null,
      name: NAME || null,
      config,
      skills,
    },
    metrics: agg.metrics,
    categories: agg.categories,
    gates: gateList,
    regressions: regs,
    calibration,
    runs,
  };

  if (FILTER) {
    // Filtered runs are scratch: they never touch the history or the report.
    const id = `${ts}-filter`;
    saveRun(evalsDb, id, 'filter', result);
    print(`Filtered run saved to ${evalsDb.name} as ${id} (history and report untouched)`);
  } else {
    saveRun(evalsDb, ts, 'full', result);
    const home = evalsHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, 'report.html'),
      renderHtml(result, recentHistory(evalsDb) as Parameters<typeof renderHtml>[1]),
    );
    writeFileSync(join(home, 'report.md'), renderMarkdown(result));
  }

  if (NAME) {
    saveBaseline(evalsDb, NAME, {
      meta: {
        ...config,
        ts,
        repeats: REPEATS,
        judge_model: result.meta.judge_model,
        cases: agg.cases,
        runs: agg.runs,
      },
      metrics: agg.metrics,
    });
    print(`Baseline "${NAME}" saved to ${evalsDb.name}`);
  }

  // Console summary.
  const pct = (v: number | null) => (v === null ? '  n/a' : `${(v * 100).toFixed(1).padStart(5)}%`);
  print('\nMetrics');
  for (const [k, v] of Object.entries(agg.metrics)) {
    const val =
      k.startsWith('latency_') ||
      k === 'forbidden_violations' ||
      k === 'judge_contradicted' ||
      k === 'precision_scored_cases'
        ? String(v ?? 'n/a')
        : pct(v as number | null);
    print(`  ${k.padEnd(24)} ${val}`);
  }
  print('\nGates');
  for (const g of gateList) {
    print(
      `  ${g.pass ? 'ok  ' : g.kind === 'hard' ? 'FAIL' : 'warn'} ${g.name.padEnd(24)} ${g.value === null ? 'n/a' : g.value} (${g.kind} ${g.name === 'forbidden_violations' ? '= ' : '≥ '}${g.threshold})`,
    );
  }
  if (calibration)
    print(
      `\nJudge calibration: ${(calibration.accuracy * 100).toFixed(0)}% on ${calibration.n} labelled pairs`,
    );
  if (baselineFile) {
    print(`\nCompared against baseline "${BASELINE_NAME}"`);
    for (const k of mismatches)
      print(
        `  warning: ${k} differs (baseline ${baselineFile.meta![k]}, this run ${config[k]}); the comparison is not like-for-like`,
      );
  }
  if (regs.length) {
    print('\nRegressions vs baseline');
    for (const r of regs)
      print(
        `  ${r.metric}: ${r.baseline.toFixed(3)} → ${r.current.toFixed(3)} (−${r.drop.toFixed(3)})`,
      );
  }
  print(`\nSkills: ${skills.routed}/${skills.chunks} chunks routed, ${skills.skipped} skipped`);
  if (!FILTER) print(`\nReport: ${join(evalsHome(), 'report.html')}`);

  // A skills-on chunk that couldn't be routed means the run isn't a clean skills-on run.
  if (config.seme_skills === 'on' && skills.skipped > 0) {
    console.error(`${skills.skipped} chunk(s) skipped routing with skills on. The run is invalid.`);
    process.exit(2);
  }
  const hardFail = gateList.some((g) => g.kind === 'hard' && !g.pass);
  if (hardFail || (FAIL_ON_REGRESSION && regs.length > 0)) process.exit(1);
}

import { rmSync } from 'node:fs';

main().catch((e) => {
  console.error('Eval runner crashed:', e);
  process.exit(2);
});
