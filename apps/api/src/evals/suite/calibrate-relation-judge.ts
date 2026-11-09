// Calibrate the relation judge against the gold-matched predictions of a finished run.
//
// Label: a predicted relation is "gold" if it matches a gold relation on its case (the existing
// string grader). Score: the judge's entailment probability for (evidence quote, verbalised relation).
// Output: precision/recall at a few thresholds, and the disagreements, for reading by hand.
//
// Usage: node dist/evals/suite/calibrate-relation-judge.js <results.json>

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { EntityIndex, goldRelationMatches } from './grade.js';
import { PEOPLE_CASES } from './diary/cases.js';
import { entailment, verbalise } from './relation-judge.js';
import type { Case } from './dataset.js';

interface Row {
  case: string;
  source: string;
  target: string;
  relation_type: string;
  quote: string;
  gold: boolean;
  p: number;
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: calibrate-relation-judge.js <results.json>');
    process.exit(2);
  }

  const byId = new Map<string, Case>(PEOPLE_CASES.map((c) => [c.id, c]));
  const run = JSON.parse(readFileSync(resolve(path), 'utf8')) as {
    runs: {
      id: string;
      repeat: number;
      pred?: {
        relations: {
          source: string;
          target: string;
          relation_type: string;
          evidence_quote: string | null;
        }[];
      };
    }[];
  };

  // One repeat is enough for calibration; the relations repeat across repeats anyway.
  const seen = new Set<string>();
  const candidates: {
    c: Case;
    r: { source: string; target: string; relation_type: string; evidence_quote: string };
  }[] = [];
  for (const run1 of run.runs) {
    if (run1.repeat !== 1 || !run1.pred) continue;
    const c = byId.get(run1.id);
    if (!c) continue;
    for (const r of run1.pred.relations) {
      if (!r.evidence_quote) continue;
      const key = `${c.id}|${r.source}|${r.target}|${r.relation_type}|${r.evidence_quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ c, r: { ...r, evidence_quote: r.evidence_quote } });
    }
  }

  const rows: Row[] = [];
  for (const { c, r } of candidates) {
    const index = new EntityIndex(c.expect.entities ?? []);
    const ps = index.resolve(r.source);
    const pt = index.resolve(r.target);
    const gold = (c.expect.relations ?? []).some((g) => goldRelationMatches(ps, pt, g, index));
    const p = await entailment(r.evidence_quote, verbalise(r.source, r.relation_type, r.target));
    rows.push({
      case: c.id,
      source: r.source,
      target: r.target,
      relation_type: r.relation_type,
      quote: r.evidence_quote,
      gold,
      p,
    });
  }

  const pos = rows.filter((x) => x.gold).length;
  console.log(`relations: ${rows.length} (gold ${pos}, not gold ${rows.length - pos})`);
  console.log('threshold  precision  recall   f1');
  for (const t of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const tp = rows.filter((x) => x.gold && x.p >= t).length;
    const fp = rows.filter((x) => !x.gold && x.p >= t).length;
    const fn = rows.filter((x) => x.gold && x.p < t).length;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    console.log(
      `${t.toFixed(2).padEnd(10)} ${precision.toFixed(3).padEnd(10)} ${recall.toFixed(3).padEnd(8)} ${f1.toFixed(3)}`,
    );
  }

  // Disagreements at 0.5: gold but judged unsupported (misses), and not-gold but judged supported (possible gold gaps).
  const missed = rows.filter((x) => x.gold && x.p < 0.5).sort((a, b) => a.p - b.p);
  const extra = rows.filter((x) => !x.gold && x.p >= 0.5).sort((a, b) => b.p - a.p);
  console.log(`\ngold but judged unsupported at 0.5: ${missed.length}`);
  for (const x of missed.slice(0, 15))
    console.log(
      `  ${x.p.toFixed(2)}  ${x.source} → ${x.target} [${x.relation_type}]  "${x.quote.slice(0, 80)}"`,
    );
  console.log(`\nnot gold but judged supported at 0.5: ${extra.length}`);
  for (const x of extra.slice(0, 15))
    console.log(
      `  ${x.p.toFixed(2)}  ${x.source} → ${x.target} [${x.relation_type}]  "${x.quote.slice(0, 80)}"`,
    );

  const out = resolve(
    path,
    '..',
    `relation-calibration-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(out, JSON.stringify({ source_run: path, rows }, null, 2));
  console.log(`\nSaved ${join(out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
