// src/evals/document-mode-eval.ts — Document-mode extraction evals
//
// Proves the document/RSS extraction mode:
//   (a) an article yields entity-subject memories with valid evidence quotes
//   (b) unsupported facts are abstained
//   (c) user-mode output on the same text is unchanged
// plus a deterministic check that the gate rejects fabricated evidence.
//
// Each LLM scenario runs the real Extractor and then pushes every candidate
// through the real ValidationGate against a temp SQLite store whose turns are
// the article chunks — the same provenance path production uses.

import { Extractor } from '../extraction/extractor.js';
import { ValidationGate } from '../validation/validation-gate.js';
import { Storage } from '../storage/storage.js';
import * as fs from 'node:fs';

const EMBEDDING_DIM = 1024;
const BASE_DIR = '/tmp/scratchpad/seme-doc-eval';

const BUDGET_ARTICLE = `Rachel Reeves has announced an extra £2bn for the NHS in her autumn Budget, the Treasury said on Tuesday.
The Chancellor told MPs the money would fund 40,000 extra appointments over the winter.
The Office for Budget Responsibility said borrowing would fall to 1.9% of GDP by 2029.
Keir Starmer welcomed the announcement, saying it was the right choice for the country.
The Treasury is based in Westminster, London.`;

const MATCH_REPORT = `Manchester City beat Arsenal 2-1 at the Etihad Stadium on Sunday.
Erling Haaland scored twice in the second half.
Arsenal's manager watched from the touchline and declined to speak to reporters.`;

const BOILERPLATE = `Subscribe to continue reading. Already a subscriber? Sign in.
Cookie settings. We use cookies to improve your experience. Manage preferences.
Share this article. Follow us on social media. Advertisement.`;

interface Fixture {
  storage: Storage;
  episodeId: string;
  turns: { id: string; role: string; content: string; ts: string }[];
  cleanup: () => void;
}

async function makeFixture(label: string, mode: 'user' | 'document', texts: string[]): Promise<Fixture> {
  const dir = `${BASE_DIR}-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });

  const storage = new Storage({ storageDir: dir, embeddingDim: EMBEDDING_DIM });
  const episodeId = `ep-${label}`;
  const ts = '2026-10-29T08:00:00Z';

  const turns = texts.map((content, i) => ({ id: `turn-${i + 1}`, role: 'user', content, ts }));

  await storage.write((db) => {
    db.prepare('INSERT INTO episodes (id, session_id, started_at, extraction_mode) VALUES (?, ?, ?, ?)')
      .run(episodeId, `sess-${label}`, ts, mode);
    for (const t of turns) {
      db.prepare('INSERT INTO turns (id, episode_id, session_id, role, content, ts) VALUES (?, ?, ?, ?, ?, ?)')
        .run(t.id, episodeId, `sess-${label}`, t.role, t.content, t.ts);
    }
  });

  return {
    storage,
    episodeId,
    turns,
    cleanup: () => {
      try { storage.close(); } catch { /* already closed */ }
      try { fs.rmSync(dir, { recursive: true }); } catch { /* best effort */ }
    },
  };
}

function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

async function extract(mode: 'user' | 'document', fixture: Fixture) {
  const extractor = new Extractor(fixture.storage);
  return extractor.extract({
    episode_id: fixture.episodeId,
    turns: fixture.turns,
    rolling_summary: null,
    recent_messages: fixture.turns.slice(-3),
    mode,
  });
}

interface Scenario {
  name: string;
  run: () => Promise<{ passed: number; total: number; details: string[] }>;
}

const scenarios: Scenario[] = [
  {
    name: 'A. Article yields entity-subject memories with verbatim evidence',
    run: async () => {
      const fixture = await makeFixture('article', 'document', [BUDGET_ARTICLE]);
      const details: string[] = [];
      let passed = 0;
      let total = 0;

      const check = (ok: boolean, text: string) => {
        total++;
        if (ok) passed++;
        details.push(`${ok ? '✓' : '✗'} ${text}`);
      };

      try {
        const output = await extract('document', fixture);
        const candidates = output.memory_candidates;

        check(candidates.length >= 3, `Expected ≥3 entity memories from article, got ${candidates.length}`);

        const subjects = candidates.map((c: any) => String(c.subject).toLowerCase());
        check(
          candidates.some((c: any) => ['treasury', 'rachel reeves', 'keir starmer', 'office for budget responsibility'].includes(String(c.subject).toLowerCase())),
          `Subjects name article entities: ${rawSubjects(candidates)}`
        );
        check(
          !subjects.some((s: string) => ['user', 'the user', 'i', 'me'].includes(s)),
          'No candidate has the user as subject'
        );
        check(
          candidates.every((c: any) => c.source_type === 'document_stated'),
          'All candidates are source_type=document_stated'
        );
        check(
          candidates.every((c: any) => c.slot === null),
          'No candidate occupies a user slot'
        );
        check(
          candidates.every((c: any) => normalize(c.evidence_quote).length > 0 &&
            normalize(BUDGET_ARTICLE).includes(normalize(c.evidence_quote))),
          'Every evidence_quote is a verbatim span of the article'
        );
        check(
          output.feedback_event_candidates.length === 0,
          'Document mode emits no feedback events'
        );

        // The real gate, against the real stored turns.
        const gate = new ValidationGate(fixture.storage);
        const results = candidates.map((c: any) => gate.validate(c));
        const blocked = results.filter((r) => !r.passed);
        check(
          results.length > 0 && blocked.length === 0,
          blocked.length === 0
            ? `All ${results.length} candidates passed the validation gate`
            : `${blocked.length}/${results.length} blocked: ${blocked.map((b) => b.errors.join('; ')).join(' | ')}`
        );
      } finally {
        fixture.cleanup();
      }

      return { passed, total, details };
    },
  },
  {
    name: 'B. Unsupported facts are abstained',
    run: async () => {
      const details: string[] = [];
      let passed = 0;
      let total = 0;
      const check = (ok: boolean, text: string) => {
        total++;
        if (ok) passed++;
        details.push(`${ok ? '✓' : '✗'} ${text}`);
      };

      // B1 — nothing but page chrome: no claim to extract.
      const chrome = await makeFixture('chrome', 'document', [BOILERPLATE]);
      try {
        const output = await extract('document', chrome);
        check(
          output.memory_candidates.length === 0,
          `Boilerplate/navigation text yields 0 memories (got ${output.memory_candidates.length})`
        );
      } finally {
        chrome.cleanup();
      }

      // B2 — a report with a named player and no transfer/injury facts.
      const match = await makeFixture('match', 'document', [MATCH_REPORT]);
      try {
        const output = await extract('document', match);
        const candidates = output.memory_candidates;
        const text = normalize(MATCH_REPORT).toLowerCase();
        const bait = ['transfer fee', 'transfer', 'injur', 'contract', 'wages', 'salary'];

        check(
          candidates.every((c: any) => !bait.some((b) => `${c.value_text} ${c.predicate}`.toLowerCase().includes(b))),
          `No invented transfer/injury/contract claims (${candidates.length} candidates)`
        );
        check(
          candidates.every((c: any) => text.includes(normalize(c.evidence_quote).toLowerCase())),
          'Any emitted claim is backed by a verbatim span of the report'
        );

        const gate = new ValidationGate(match.storage);
        const blocked = candidates.map((c: any) => gate.validate(c)).filter((r) => !r.passed);
        check(
          blocked.length === 0,
          blocked.length === 0
            ? 'Every emitted claim passed the provenance gate (none fabricated)'
            : `${blocked.length} claims failed the gate: ${blocked.map((b) => b.errors.join('; ')).join(' | ')}`
        );
      } finally {
        match.cleanup();
      }

      return { passed, total, details };
    },
  },
  {
    name: 'C. User-mode output on the same text is unchanged',
    run: async () => {
      const fixture = await makeFixture('usermode', 'user', [BUDGET_ARTICLE]);
      const details: string[] = [];
      let passed = 0;
      let total = 0;
      const check = (ok: boolean, text: string) => {
        total++;
        if (ok) passed++;
        details.push(`${ok ? '✓' : '✗'} ${text}`);
      };

      try {
        const newsOutput = await extract('user', fixture);
        check(
          newsOutput.memory_candidates.length === 0,
          `User mode still abstains on third-person news (got ${newsOutput.memory_candidates.length})`
        );
        check(
          !newsOutput.memory_candidates.some((c: any) => c.source_type === 'document_stated'),
          'User mode never emits document_stated'
        );
        check(
          !newsOutput.memory_candidates.some((c: any) =>
            ['rachel reeves', 'treasury', 'keir starmer'].includes(String(c.subject).toLowerCase())),
          `User mode emits no entity-subject news facts: ${rawSubjects(newsOutput.memory_candidates)}`
        );

        // And user mode still does its own job on a conversation.
        const convo = await makeFixture('convo', 'user', [
          'My name is Charles and I live in London.',
          'I love TypeScript and I am interested in memory systems.',
        ]);
        try {
          const convoOutput = await extract('user', convo);
          check(
            convoOutput.memory_candidates.length >= 2,
            `User mode still extracts user facts (got ${convoOutput.memory_candidates.length})`
          );
          check(
            convoOutput.memory_candidates.every((c: any) => c.source_type !== 'document_stated'),
            'Conversation memories are never document_stated'
          );
        } finally {
          convo.cleanup();
        }
      } finally {
        fixture.cleanup();
      }

      return { passed, total, details };
    },
  },
  {
    name: 'D. Gate rejects fabricated evidence (no model)',
    run: async () => {
      const fixture = await makeFixture('gate', 'document', [BUDGET_ARTICLE]);
      const details: string[] = [];
      let passed = 0;
      let total = 0;
      const check = (ok: boolean, text: string) => {
        total++;
        if (ok) passed++;
        details.push(`${ok ? '✓' : '✗'} ${text}`);
      };

      try {
        const gate = new ValidationGate(fixture.storage);
        const base: any = {
          kind: 'fact',
          slot: null,
          subject: 'Rachel Reeves',
          predicate: 'announced',
          value_text: 'Rachel Reeves announced an extra £2bn for the NHS.',
          value_json: null,
          evidence_quote: 'Rachel Reeves has announced an extra £2bn for the NHS',
          source_turn_id: 'turn-1',
          source_episode_id: fixture.episodeId,
          source_type: 'document_stated',
          modality: 'stated',
          importance: 0.6,
          decay_class: 'medium',
        };

        check(gate.validate(base).passed, 'Verbatim document claim passes');

        const fabricated = { ...base, evidence_quote: 'Rachel Reeves announced £9bn for schools' };
        const r1 = gate.validate(fabricated);
        check(
          !r1.passed && r1.errors.some((e) => e.includes('Evidence quote not found')),
          `Fabricated quote rejected: ${r1.errors.join('; ')}`
        );

        const userSubject = { ...base, subject: 'user' };
        const r2 = gate.validate(userSubject);
        check(
          !r2.passed && r2.errors.some((e) => e.includes('not the user')),
          `Document claim about the user rejected: ${r2.errors.join('; ')}`
        );

        const slotted = { ...base, slot: 'home_city', kind: 'fact' };
        const r3 = gate.validate(slotted);
        check(
          !r3.passed && r3.errors.some((e) => e.includes('must not use a user slot')),
          `Document claim in a user slot rejected: ${r3.errors.join('; ')}`
        );

        // Same candidate claiming document provenance from a user-mode episode.
        const userEpisode = await makeFixture('gate-user-ep', 'user', ['I live in London.']);
        try {
          const wrongEpisode = { ...base, source_episode_id: userEpisode.episodeId, source_turn_id: 'turn-1' };
          const r4 = gate.validate(wrongEpisode);
          check(
            !r4.passed && r4.errors.some((e) => e.includes('requires a document episode')),
            `Document claim outside a document episode rejected: ${r4.errors.join('; ')}`
          );
        } finally {
          userEpisode.cleanup();
        }
      } finally {
        fixture.cleanup();
      }

      return { passed, total, details };
    },
  },
];

function rawSubjects(candidates: any[]): string {
  const names = [...new Set(candidates.map((c) => String(c.subject)))];
  return names.length ? names.join(', ') : '(none)';
}

async function main() {
  console.log('Document-mode extraction evals');
  console.log('='.repeat(64));

  let totalPassed = 0;
  let totalChecks = 0;
  let scenarioFailures = 0;

  for (const scenario of scenarios) {
    let result;
    try {
      result = await scenario.run();
    } catch (e: any) {
      result = { passed: 0, total: 1, details: [`✗ ERROR: ${e.message}`] };
    }
    totalPassed += result.passed;
    totalChecks += result.total;
    const status = result.passed === result.total ? '✓' : result.passed === 0 ? '✗' : '~';
    if (result.passed !== result.total) scenarioFailures++;
    console.log(`\n${status} ${scenario.name} (${result.passed}/${result.total})`);
    for (const d of result.details) console.log(`   ${d}`);
  }

  console.log('\n' + '='.repeat(64));
  console.log(`TOTAL: ${totalPassed}/${totalChecks} checks, ${scenarios.length - scenarioFailures}/${scenarios.length} scenarios`);
  if (totalPassed !== totalChecks) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
