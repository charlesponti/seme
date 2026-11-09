// Relation judge: does the source sentence support a predicted relation?
//
// Uses a multilingual natural-language-inference model (transformers.js, run in-process).
// The evidence quote is the premise; the relation, verbalised, is the hypothesis. The score is
// the entailment probability. Language-free in the sense that matters: the model compares
// meanings across languages, so the grader never needs to match words.

import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';

export const NLI_MODEL = 'MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7';

interface Loaded {
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
  entailmentIndex: number;
}

let loading: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  loading ??= (async () => {
    const tokenizer = await AutoTokenizer.from_pretrained(NLI_MODEL);
    const model = await AutoModelForSequenceClassification.from_pretrained(NLI_MODEL, {
      dtype: 'q8',
    });
    const id2label = (model.config as unknown as { id2label: Record<string, string> }).id2label;
    const labels = Object.entries(id2label);
    const hit = labels.find(([, v]) => v.toLowerCase() === 'entailment');
    if (!hit) throw new Error(`NLI model ${NLI_MODEL} has no entailment label`);
    return { tokenizer, model, entailmentIndex: Number(hit[0]) };
  })();
  return loading;
}

const cache = new Map<string, number>();

/** Probability that `premise` entails `hypothesis`, between 0 and 1. Cached per pair. */
export async function entailment(premise: string, hypothesis: string): Promise<number> {
  const key = `${premise}\u0000${hypothesis}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const { tokenizer, model, entailmentIndex } = await load();
  const inputs = await tokenizer([premise], {
    text_pair: [hypothesis],
    padding: true,
    truncation: true,
  });
  const { logits } = await model(inputs);
  const d = Array.from(logits.data as Float32Array);
  const max = Math.max(...d);
  const exp = d.map((x) => Math.exp(x - max));
  const p = exp[entailmentIndex] / exp.reduce((s, x) => s + x, 0);
  cache.set(key, p);
  return p;
}

/**
 * Turn a predicted relation into a sentence: `user reading Piranesi.` The extractor's
 * relation_type is free text (`authored_by`, `reading`), so underscores become spaces.
 */
export function verbalise(source: string, relationType: string, target: string): string {
  const who = source.toLowerCase() === 'user' ? 'The user' : source;
  return `${who} ${relationType.replace(/_/g, ' ')} ${target}.`;
}

/**
 * A predicted relation counts as supported when its entailment probability reaches this.
 * Set from a 100-item stratified audit of skills-off people relations (2026-11-09): at 0.10 the
 * estimated precision was 0.99 and recall 0.98; at 0.25 recall fell to 0.77. The [0.10, 0.25)
 * bin was only 20 items, so re-check it when the sample grows.
 */
export const SUPPORT_THRESHOLD = 0.1;

/**
 * Judge every predicted relation against its own evidence quote. A relation with no quote is
 * unsupported: nothing in the text backs it.
 */
export async function judgeRelations(
  relations: {
    source: string;
    target: string;
    relation_type: string;
    evidence_quote: string | null;
  }[],
): Promise<{ pred: number; supported: number }> {
  let supported = 0;
  for (const r of relations) {
    if (!r.evidence_quote) continue;
    const p = await entailment(r.evidence_quote, verbalise(r.source, r.relation_type, r.target));
    if (p >= SUPPORT_THRESHOLD) supported++;
  }
  return { pred: relations.length, supported };
}
