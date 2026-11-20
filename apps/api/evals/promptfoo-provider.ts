import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import type { ApiProvider, ProviderResponse } from 'promptfoo';
import { runCase } from './suite/harness.js';
import type { Case } from './suite/dataset.js';

export interface SemeProviderOutput {
  pred: Awaited<ReturnType<typeof runCase>>['pred'];
  latencyMs: number;
}

const storageRoot = mkdtempSync(join(tmpdir(), 'seme-promptfoo-'));

export const semeProvider: ApiProvider = {
  id: () => 'seme:extraction',
  async callApi(_prompt, context): Promise<ProviderResponse> {
    const c = context?.vars.case as Case | undefined;
    if (!c) throw new Error('Promptfoo test case is missing vars.case');

    const result = await runCase(c, storageRoot);
    const output: SemeProviderOutput = result;
    return {
      output: JSON.stringify(output),
      latencyMs: result.latencyMs,
      metadata: { caseId: c.id },
    };
  },
};
