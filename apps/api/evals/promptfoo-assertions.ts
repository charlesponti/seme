import type { AssertionValueFunction } from 'promptfoo';
import type { Case } from './suite/dataset.js';
import { gradeCase } from './suite/grade.js';
import type { SemeProviderOutput } from './promptfoo-provider.js';

function parseOutput(output: string): SemeProviderOutput {
  const parsed: unknown = JSON.parse(output);
  if (!parsed || typeof parsed !== 'object' || !('pred' in parsed)) {
    throw new Error('Seme provider returned an invalid output');
  }
  return parsed as SemeProviderOutput;
}

export const gradeSemeCase: AssertionValueFunction = (output, context) => {
  const c = context.vars.case as Case | undefined;
  if (!c) throw new Error('Promptfoo test case is missing vars.case');

  const { pred } = parseOutput(output);
  const grade = gradeCase(c, pred);
  const passed = grade.checks.filter((check) => check.pass).length;
  const score = grade.checks.length === 0 ? 1 : passed / grade.checks.length;

  return {
    pass: grade.pass,
    score,
    reason:
      grade.checks
        .filter((check) => !check.pass)
        .map((check) => `${check.name}: ${check.detail}`)
        .join('; ') || 'All Seme checks passed',
    namedScores: {
      entities: ratio(grade.counts.entity_tp, grade.counts.entity_gold),
      relations: ratio(grade.counts.relation_tp, grade.counts.relation_gold),
      memories: ratio(grade.counts.memory_hit, grade.counts.memory_gold),
      provenance: ratio(
        grade.counts.provenance_checked - grade.counts.provenance_bad,
        grade.counts.provenance_checked,
      ),
      forbidden: grade.counts.forbidden_hits === 0 ? 1 : 0,
    },
    metadata: { grade },
  };
};

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}
