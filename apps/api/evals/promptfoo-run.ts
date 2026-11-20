import { evaluate, type EvaluateTestSuite, type TestCase } from 'promptfoo';
import { CASES, type Case } from './suite/dataset.js';
import { DIARY_CASES, PEOPLE_CASES } from './suite/diary/cases.js';
import { gradeSemeCase } from './promptfoo-assertions.js';
import { semeProvider } from './promptfoo-provider.js';

const suite = process.env.SEME_EVAL_SUITE ?? 'core';
const filter = process.env.SEME_EVAL_FILTER ?? '';
const cases = selectCases(suite).filter((c) => !filter || c.id.includes(filter));

if (cases.length === 0) {
  throw new Error(`No Seme eval cases matched suite=${suite} filter=${filter || '(none)'}`);
}

const tests: TestCase[] = cases.map((c) => ({
  description: c.id,
  vars: { case: c, input: inputText(c) },
  assert: [{ type: 'javascript', value: gradeSemeCase }],
}));

const config: EvaluateTestSuite = {
  description: `Seme ${suite} extraction eval`,
  prompts: ['{{input}}'],
  providers: [semeProvider],
  tests,
  writeLatestResults: false,
};

async function main(): Promise<void> {
  const evaluation = await evaluate(config, {
    maxConcurrency: Number(process.env.SEME_EVAL_CONCURRENCY ?? 4),
    repeat: Number(process.env.SEME_EVAL_REPEATS ?? 1),
  });
  const results = evaluation.results;
  const successes = results.filter((result) => result.success).length;
  const errors = results.filter((result) => !result.response).length;
  const failures = results.length - successes - errors;
  console.log(
    `Promptfoo: ${successes} passed, ${failures} failed, ${errors} errors (${results.length} results)`,
  );
  if (results.length === 0) {
    throw new Error('Promptfoo returned no result rows');
  }
  process.exitCode = failures + errors > 0 ? 1 : 0;
}

void main();

function selectCases(name: string): Case[] {
  if (name === 'diary') return DIARY_CASES;
  if (name === 'people') return PEOPLE_CASES;
  if (name !== 'core') throw new Error(`Unknown Seme eval suite: ${name}`);
  return CASES;
}

function inputText(c: Case): string {
  if (typeof c.input === 'string') return c.input;
  return c.input.map((turn) => `${turn.role}: ${turn.content}`).join('\n');
}
