// LLM-as-judge for the semantic checks the deterministic graders can't do:
// is each stored memory actually supported by the source, and does the engine
// cover each gold claim in its own words? The judge is itself evaluated: see
// calibrate(), which scores it on hand-labelled pairs before its numbers count.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { JUDGE_CALIBRATION } from './dataset.js';
import type { PredMemory, SourceTurn } from './grade.js';

export type Verdict = 'supported' | 'unsupported' | 'contradicted';

export interface JudgeCaseResult {
  groundedness: { index: number; verdict: Verdict; why: string }[];
  coverage: { claim: string; covered: boolean; why: string }[];
}

export interface JudgeConfig {
  model: string;
  apiKey: string;
}

export function judgeConfig(): JudgeConfig | null {
  let apiKey = process.env.OPENROUTER_API_KEY || '';
  if (!apiKey) {
    const rc = join(homedir(), '.localrc');
    if (existsSync(rc)) {
      const m = readFileSync(rc, 'utf8').match(/OPENROUTER_API_KEY=(.+)/);
      if (m) apiKey = m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  if (!apiKey) return null;
  return { model: process.env.SEME_EVAL_JUDGE_MODEL || 'anthropic/claude-sonnet-5-5', apiKey };
}

const SYSTEM = `You are a strict evaluator for a personal-memory system. You judge only from the source text you are given. Use no outside knowledge and do not reward plausible-sounding claims that the source does not make.

Verdicts for a stored memory:
- supported: the source states it, or it follows directly from what is stated. A correct negation counts as supported.
- unsupported: the source does not state it, or it adds details that are not there.
- contradicted: the source says otherwise, or attributes it to the wrong person or thing.

For a gold claim, "covered" means some stored memory expresses the same meaning, even in different words.

Return only JSON.`;

async function chat(cfg: JudgeConfig, user: string): Promise<any> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`judge HTTP ${res.status}`);
  const data: any = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(content.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''));
}

export async function judgeCase(
  cfg: JudgeConfig,
  turns: SourceTurn[],
  memories: PredMemory[],
  claims: string[],
): Promise<JudgeCaseResult> {
  if (memories.length === 0 && claims.length === 0) return { groundedness: [], coverage: [] };
  const source = turns.map((t) => `[${t.role}] ${t.content}`).join('\n');
  const mem =
    memories
      .map((m, i) => `${i}. ${m.value_text}  (kind=${m.kind}, modality=${m.modality})`)
      .join('\n') || '(none)';
  const gold = claims.map((c, i) => `${i}. ${c}`).join('\n') || '(none)';
  const user = `SOURCE TURNS:\n${source}\n\nSTORED MEMORIES:\n${mem}\n\nGOLD CLAIMS:\n${gold}\n\nReturn JSON: {"groundedness":[{"index":number,"verdict":"supported|unsupported|contradicted","why":string}],"coverage":[{"index":number,"covered":boolean,"why":string}]}, one entry per stored memory and per gold claim.`;
  const parsed = await chat(cfg, user);
  const groundedness = (parsed.groundedness ?? []).map((g: any) => ({
    index: Number(g.index),
    verdict: g.verdict as Verdict,
    why: String(g.why ?? ''),
  }));
  const coverage = (parsed.coverage ?? []).map((c: any) => ({
    claim: claims[Number(c.index)] ?? '',
    covered: c.covered === true,
    why: String(c.why ?? ''),
  }));
  return { groundedness, coverage };
}

/**
 * Score the judge on hand-labelled pairs. The suite only trusts groundedness
 * numbers when this agreement is high, which is how we catch a judge that drifts.
 */
export async function calibrate(
  cfg: JudgeConfig,
): Promise<{ accuracy: number; n: number; misses: string[] }> {
  const items = JUDGE_CALIBRATION.map(
    (p, i) => `${i}. SOURCE: ${p.source}\n   MEMORY: ${p.memory}`,
  ).join('\n');
  const user = `For each item, give the verdict for the MEMORY against the SOURCE.\n\n${items}\n\nReturn JSON: {"verdicts":[{"index":number,"verdict":"supported|unsupported|contradicted"}]}`;
  const parsed = await chat(cfg, user);
  const byIndex = new Map<number, string>(
    (parsed.verdicts ?? []).map((v: any) => [Number(v.index), String(v.verdict)]),
  );
  let correct = 0;
  const misses: string[] = [];
  JUDGE_CALIBRATION.forEach((p, i) => {
    const got = byIndex.get(i);
    if (got === p.verdict) correct++;
    else misses.push(`"${p.memory}" → judge ${got ?? 'none'}, label ${p.verdict}`);
  });
  return { accuracy: correct / JUDGE_CALIBRATION.length, n: JUDGE_CALIBRATION.length, misses };
}
