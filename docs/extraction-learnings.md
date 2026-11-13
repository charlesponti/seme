# Extraction learnings: what moved the needle

Everything we've learned about the extraction pipeline and its eval suite, ranked by how much it actually changed the scores. This is a living doc. Update it when a run changes the picture.

Status as of 2026-11-13, branch `feat/store-snapshot-restore`.

## TL;DR

- **Four things moved the needle, in this order:** fixing the grader (20% → 34% pass on the same Haiku runs, no model change), switching to GLM 5.3 Flash (34% → 54–59% on the full people suite), making the extractor survive bad output and flaky connections (the `invalid_output` fix took entity F1 from 81.0% to 92%), and the place and retraction rules (places went from about 1 per essay to about 15).
- **Quality over speed.** GLM is slower than Haiku, but it passes more cases. A fast extractor that misses the hard ones isn't useful.
- **Thinking tokens aren't the differentiator.** All three models we compared spend about 40% of their output on reasoning, and visible output is about the same.
- **The numbers are noisy.** Two identical GLM runs on the full suite landed at 58.9% and 53.9% pass. Treat anything under about 5 points as a tie.
- **Like-for-like full-suite pass rates (2026-11-13, current grader, 508 runs each):** GLM 53.9% and 58.9% (two runs), GPT 6 Luna 39.6%, Haiku 36.4%. GLM leads by about 15 to 20 points. `SEME_EXTRACTOR_MODEL` is still Haiku.
- **Luna's metrics are missing.** Its run finished all 508 cases, then crashed on a judge HTTP 403 (the OpenRouter spend limit) before saving. Only its pass count (201 of 508) survives, from the log. Rerun it once the budget is topped up.
- **Still broken:** about 36 of 508 runs lose their extraction to dropped connections (`fetch failed`, `terminated`) even with 4 retries and backoff.

## Scoreboard

Full people suite: 254 cases × 2 repeats = 508 runs, judge on (Sonnet), skills on, current grader unless noted.

| Run                                                                                  | Pass rate | Entity F1 | Relation F1 | Memory recall | Notes                                                                                                                                           |
| ------------------------------------------------------------------------------------ | --------- | --------- | ----------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Haiku 5.5 baseline (`2026-11-09T13-00-50-531Z`), old grader as stored                | 19.7%     | 94.4%     | 77.4%       | 69.8%         | Not comparable on pass rate                                                                                                                     |
| Haiku 5.5, same runs, regraded offline with the current grader                       | 34%       | 94.4%     | 77.4%       | 69.8%         | Grader fix alone                                                                                                                                |
| Haiku 5.5 rerun on the current grader (`haiku-5.5-people-2026-11-13`)                | 36.4%     | 94.7%     | 78.3%       | 72.7%         | 0 failed chunks, 0 lost runs. Latency p50 6.8 s, p95 11.9 s. Judge supported 98.7%. The offline regrade of the old runs said 34%, so it held up |
| GPT 6 Luna (`openai/gpt-6-luna`, 2026-11-13)                                         | 39.6%     | n/a       | n/a         | n/a           | 201 of 508 runs pass, counted from the log. Metrics lost to a judge 403 at the end of the run. 2 chunks logged as unavailable                   |
| GLM 5.3 Flash, first full run (`glm-5.3-flash-people-2026-11-12`)                    | 52.8%     | 81.0%     | 61.9%       | 81.5%         | 96 chunks hit `invalid_output`, 66 runs lost extraction                                                                                         |
| GLM, validator fix (`invalid_output` drops one candidate, not the chunk)             | 58.9%     | 92.1%     | 71.8%       | 91.8%         | Only 1 `invalid_output` left; 22 runs lost to network errors                                                                                    |
| GLM, validator fix + 4 retries with backoff (`glm-5.3-flash-people-fix2-2026-11-13`) | 53.9%     | 92.0%     | 71.7%       | 88.1%         | 36 runs lost to network errors                                                                                                                  |

Other numbers from the last run: entity recall 96.4%, relation recall 85.7%, entity precision (exhaustive) 88.2%, relation precision (exhaustive) 85.0%, memory precision 94.6%, judge supported 96.8%, judge contradicted 1, provenance 100%, forbidden violations 0, latency p50 7.9 s and p95 16.4 s.

How to read the table:

- **Haiku's F1 is still higher than GLM's.** Haiku 94.4 / 77.4 versus GLM 92.0 / 71.7. Haiku's F1 was graded with the older grader, so the gap is a little uncertain. Haiku extracts structure slightly more reliably, and GLM passes more whole cases and recalls more memories. We haven't checked which matters more for the product.
- **The two fix runs are the same code except for retries.** The 5-point pass-rate gap between them is mostly noise, plus 14 more runs lost to network errors in the second run. Retries rescued many chunks (47 first attempts failed, 5 chunks failed all 4), but the dropped connections didn't go away.
- **Latency p50 fell from 41 s to 8 s between the first GLM run and the last.** We haven't established why. It could be provider load that day, and fewer long retry chains. Don't quote the 8 s as a property of the model.

## What moved the needle

### 1. The grader was wrong (20% → 34%, no model change)

The old grader failed runs for extra entities that the text really supported. Paraphrased names like "product manager role" failed the exact-name check. We regraded the stored 508-run Haiku baseline offline:

|            | Passing runs    |
| ---------- | --------------- |
| Old grader | 100 / 508 (20%) |
| New grader | 174 / 508 (34%) |

Current rules in `apps/api/src/evals/suite/grade.ts` (`gradeCase`):

| Check                             | Rule now                                                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `entity_precision` (exhaustive)   | An extra entity fails only if it's not in the text. "In the text" means the name appears, or its `evidence_quote` does. |
| `relation_precision` (exhaustive) | An extra relation fails only if its `evidence_quote` isn't in the text.                                                 |
| `memory_precision` (exhaustive)   | Always passes. Informational. Grounding needs the LLM judge (`--judge`).                                                |
| Forbidden relations / entities    | Unchanged, still hard fails.                                                                                            |
| Recall (entity, relation, memory) | Unchanged. This is where most failures are.                                                                             |

After the regrade, what's left is recall, not hallucination: about 252 missed memories, 157 missed relations, 54 missed entities across the Haiku baseline.

**Lesson:** before blaming the model, check whether the grader is failing correct output. Grader changes make old numbers incomparable, so regrade stored runs offline to compare. The regrade script lives in the session scratchpad (not the repo) and may be gone.

### 2. Picking a model that works on the hard cases

On the 7-case `hard-correction` slice (one repeat, judge off), under the current grader:

|                              | Haiku 5.5              | GLM 5.3 Flash | GPT 6 Luna |
| ---------------------------- | ---------------------- | ------------- | ---------- |
| Cases passing                | 0/7                    | 5/7           | 4/7        |
| Entity recall (tp / gold)    | 26 / 30                | 23 / 30       | 29 / 30    |
| Relation recall (tp / gold)  | 10 / 15                | 10 / 15       | 12 / 15    |
| Memory recall (hit / gold)   | 9 / 17                 | 17 / 17       | 15 / 17    |
| Cost, 7 cases (`usage.cost`) | $0.0116                | $0.0047       | $0.0095    |
| Wall time, sum of cases      | 58 s                   | 230 s         | 89 s       |
| Provider that served it      | Claude Platform on AWS | Wafer         | OpenAI     |

The full suite then backed it up for GLM: 52.8–58.9% pass versus 34% for Haiku (regraded). That slice result was one repeat, so we leaned on the full run for the real answer.

Other models tried on the same slice didn't beat Haiku: DeepSeek V4 Flash, DeepSeek V4.1 Flash 1017 (high recall, but 1.6× to 6× slower), and Muse Spark 1.3 Contributor (same story).

Model IDs: `anthropic/claude-haiku-5.5`, `z-ai/glm-5.3-flash`, `openai/gpt-6-luna`, `deepseek/deepseek-v4-flash`, `deepseek/deepseek-v4.1-flash-1017`, `meta/muse-spark-1.3-contributor`. Set via `SEME_EXTRACTOR_MODEL`.

### 3. Make the extractor survive bad output and flaky connections

In `entity-extractor.ts`, GLM's output used to blow up the whole chunk. One malformed candidate threw `invalid_output`, and every entity in that chunk was dropped. In the first full GLM run, 96 chunks failed this way and 66 of 508 runs lost extraction outright.

Fixes, in order:

1. **Drop the bad candidate, not the chunk.** `entityProblem` and `relationProblem` check each candidate (null aliases, bad modality, bad confidence, bad relation type, non-object) and skip it with a `[extractor] dropped entity candidate: <reason>` warning. Top-level structure problems still throw. Result: `invalid_output` went from 96 chunks to 1. The second run logged zero dropped candidates, so GLM's candidates are mostly well-formed once the chunk survives.
2. **Retry up to 4 times with backoff (1 s, 2 s, 4 s).** Malformed JSON and dropped connections both happen on OpenRouter routes. Non-ok HTTP responses and empty content still return empty immediately.

What the fixes did: entity F1 81.0% → 92%, relation F1 61.9% → 71.7%, memory recall 81.5% → 88–92%.

What they didn't fix: connection drops. The second run had 87 failed attempts (49 `terminated`, 38 `fetch failed`), plus 3 JSON-parse failures and 1 `invalid_output`. 36 runs still logged `Extractor unavailable for episode`. We don't know the cause. Candidates to test: concurrency (4 runs × several chunks each hits the provider hard), the Wafer provider, or the local network. Try `--concurrency 2` and pinning a provider before guessing.

### 4. Extract places, and normalize their types

- **Prompt rule.** Rule 2 of the system prompt says to extract every city, state, country, neighborhood, school and landmark, including places mentioned in passing (born, lived, worked, studied, visited).
- **`canonicalEntityType()` / `PLACE_TYPES`.** Maps place-ish types (`city`, `neighborhood`, `river`, `restaurant`, `house`, and so on) to `place` before storage.

Result on a long-form fictional biography with no gold (`ines-whitfield.txt`, about 1,230 words): clean runs went from about 1 place entity to about 15. Our first place count matched only type `place` and said extraction was broken when it wasn't. Always count across all place-type names.

### 5. Retracted names are real entities

"Mark, no, it's Greg" puts both names in the graph. The relation goes to the correct name, and the retracted name gets a forbidden relation from the user. In `diary/timeline.ts`, the `correction` case now treats the wrong name as a gold entity plus a forbidden relation (not a forbidden entity). `WRONG_NAMES` is `['Mark', 'Greg', 'Tess', 'Julia', 'Ben', 'Kenji']`.

### 6. Small wins and non-wins

- **Removed `importance` from candidates.** One fewer field for the model to get right, and we weren't using it. We haven't measured the downstream impact separately.
- **Parallel entity and memory extraction** (commit `4cb1299`) was a perf change. We haven't measured how much it saved.

## What didn't help (or isn't proven)

### Thinking tokens

Seven cases, one repeat, 14 extraction calls per model, judge off, numbers from OpenRouter's `usage`:

|                                      | Haiku 5.5   | GLM 5.3 Flash | GPT 6 Luna  |
| ------------------------------------ | ----------- | ------------- | ----------- |
| Prompt tokens                        | 23,674      | 15,736        | 15,503      |
| Completion tokens                    | 18,508      | 19,284        | 15,971      |
| Reasoning tokens (inside completion) | 7,731 (42%) | 9,092 (47%)   | 5,861 (37%) |
| Visible output                       | ~10,800     | ~10,200       | ~10,100     |
| Cached prompt tokens                 | 0           | 4,608         | 3,081       |

- Reasoning is a share of the completion, not extra output. Thinking doesn't mean more tokens to pay for.
- Haiku's prompt totals are higher for the same chunks (1,683 versus 1,118 on the first chunk). Probably a tokenizer difference, not verified.
- OpenRouter routes each call to a provider and the per-token rate depends on which one, so only `usage.cost` on the response is the real bill. List prices (GLM: $0.15 / $0.50 per M on Z.ai, $0.04 / $0.08 on Wafer) are a starting point.

### Recall is still the main failure

Most failing runs miss things instead of inventing them. What we know from the traces:

- **Chunking.** Extraction runs in chunks of 6 turns, so a fact spread across turns can get split.
- **Quote replacement.** `verifiedQuote` swaps a non-verbatim quote for a real sentence. That keeps provenance at 100% but can attach the wrong evidence.
- **Pairing.** Relations need both endpoints resolved. A missed or fragmented entity silently kills the relations that depend on it.

### Why a model can answer questions about a book but extraction isn't at 100%

Our best explanation, not proven. Answering is forgiving: it tolerates paraphrase and partial recall, and sees the whole text. Extraction is strict: right entity, type, subject, predicate, object and a verbatim quote, in 6-turn chunks. And some gold asks for facts the text never states.

## Open bugs and decisions

- **Gold the text doesn't state.** The `friendNews` maker in `timeline.ts` (around lines 500–515) adds a `user → Priya` friendship as gold, but the text never says they're friends. The correction cases miss the same relation. Fix: state the friendship in the case text, then rerun. Agreed, not applied.
- **Memory grounding.** Memory precision always passes. A fabricated memory fails nothing unless the judge runs. Decision pending: wire the judge into memory precision, or keep it informational and document it.
- **Relation grounding is weak.** Extra relations only need a verbatim quote, which provenance already guarantees. The NLI relation judge (`--relation-judge`) is the real check and is off by default.
- **Old stored place types.** Rows saved before `canonicalEntityType()` aren't migrated, so the stored graph still has fragmented place types.
- **Token capture.** The eval harness doesn't record usage and cost per call. The comparison above came from a scratchpad wrapper that is gone.

## How we measure

- **Harness.** `apps/api/src/evals/suite/harness.ts` ingests each case into a temp store and reads back turns, entities, relations and memories. `run.ts` drives it. Flags: `--suite core|diary|people`, `--filter`, `--repeats`, `--concurrency` (default 4), `--judge`, `--relation-judge`, `--name`, `--baseline`, `--fail-on-regression`, `--tolerance`.
- **Cases.** `diary/timeline.ts` generates the people suite and its gold. `diary/cases.ts` exports `PEOPLE_CASES` (254). Gold entity types are canonical: person, place, organization, food, animal, medication, tool, project, product, event, diet, condition, language, instrument, goal, book, beverage.
- **Judge.** Sonnet via OpenRouter. Produces `judge_supported_rate`, `judge_contradicted`, `judge_coverage_rate`. Calibration was 100% on 8 labelled pairs.
- **Results store.** `~/.hominem/seme.evals.db`, tables `runs` and `baselines`. The runner has no resume, and a full run takes about an hour at concurrency 4.

Run GLM on the full suite from `apps/api` (build first with `pnpm exec tsc`):

```bash
SEME_EXTRACTOR_MODEL=z-ai/glm-5.3-flash node dist/evals/suite/run.js --suite people --repeats 2 --judge --concurrency 4 --name <run-name>
```

## Ops notes and mistakes to avoid

- **Name baseline runs by their real timestamp.** The Haiku baseline is `2026-11-09T13-00-50-531Z`.
- **`document` mode is only for document content.** Text submissions go in `user` mode. Don't rerun user statements through `document` mode, it returns nothing.
- **Check the log, not the task notice.** A background task once said "completed" for a run I'd killed (exit 143).
- **OpenRouter spend limits return 403.** The key hit its $50 limit once. Check the budget before a big run.
- **Don't touch the real store.** Evals use temp stores only. Back up `~/.hominem/memory.db` before any write and get a yes first.
- **Count by canonical type, not raw type** (see places above).

## Next steps, in order

1. Top up the OpenRouter budget and rerun GPT 6 Luna on the full suite so we have its F1 and recall, not only its pass count. Then decide on `SEME_EXTRACTOR_MODEL`. Haiku is done.
2. Find the cause of the connection drops. Try `--concurrency 2` and pinning a provider.
3. Decide memory grounding: judge or informational.
4. State the Priya friendship in the `friendNews` text, and fix the missing `user → Priya` relation in the correction cases.
5. Make the NLI relation judge part of the standard run.
6. Work on recall one slice at a time, `hard-correction` first.
7. Add per-call token and cost capture to the harness.
8. Decide whether to migrate old place-type rows.
