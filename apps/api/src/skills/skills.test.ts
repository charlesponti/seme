// Unit tests for the skill loader and router. Uses node:test and a deterministic
// fake embedder, so no Ollama is needed. Every test gets its own temp store.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '../storage/storage.js';
import { EmbeddingProvider } from '../embeddings/embedding-provider.js';
import { loadSkillModules, parseSkillFile } from './catalog.js';
import { SkillRouter, skillStats, skillsEnabled } from './router.js';

// ── Helpers ───────────────────────────────────────────────────────────────

const DIM = 16;

/** Deterministic text → vector. Similar text shares characters, so it scores higher. */
function vectorFor(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (let i = 0; i < text.length; i++) v[i % DIM] += text.charCodeAt(i);
  return v.map((x) => x / 1000 + 0.01);
}

function fakeEmbedder() {
  const counts = { single: 0, batch: 0, texts: 0 };
  const failures = { remaining: 0 };
  const embedder: EmbeddingProvider = {
    dim: DIM,
    async embed(text: string) {
      counts.single++;
      if (failures.remaining > 0) {
        failures.remaining--;
        throw new Error('embedder down');
      }
      return vectorFor(text);
    },
    async embedBatch(texts: string[]) {
      counts.batch++;
      counts.texts += texts.length;
      if (failures.remaining > 0) {
        failures.remaining--;
        throw new Error('embedder down');
      }
      return texts.map(vectorFor);
    },
  };
  return { embedder, counts, failures };
}

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'skills-test-'));
  const storage = new Storage({ storageDir: dir, embeddingDim: DIM });
  const cleanup = () => {
    storage.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return { dir, storage, cleanup };
}

function makeSkill(root: string, name: string, description: string, body = 'Body text.') {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(
    join(root, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

function cachedRows(storage: Storage): number {
  return storage.read(
    (db) => (db.prepare('SELECT COUNT(*) AS n FROM skill_embeddings').get() as { n: number }).n,
  );
}

const OPTIONS = { topK: 2, minScore: -1 };

// ── Catalog ───────────────────────────────────────────────────────────────

test('parseSkillFile reads frontmatter and body', () => {
  const { meta, body } = parseSkillFile(
    '---\nname: a-b\ndescription: Use when x.\n---\n\nHello.\n',
  );
  assert.equal(meta.name, 'a-b');
  assert.equal(meta.description, 'Use when x.');
  assert.equal(body, 'Hello.');
});

test('parseSkillFile rejects a file with no frontmatter', () => {
  assert.throws(() => parseSkillFile('just text'), /missing frontmatter/);
});

test('loadSkillModules skips bad modules and keeps good ones', (t) => {
  const errors: string[] = [];
  t.mock.method(console, 'error', (msg: string) => errors.push(msg));
  const root = mkdtempSync(join(tmpdir(), 'skills-catalog-'));
  try {
    makeSkill(root, 'good-one', 'Use when good.');
    makeSkill(root, 'folder-mismatch', 'Use when x.');
    writeFileSync(
      join(root, 'folder-mismatch', 'SKILL.md'),
      '---\nname: other-name\ndescription: x\n---\nbody\n',
    );
    makeSkill(root, 'Bad_Name', 'Use when y.');
    mkdirSync(join(root, 'no-description'));
    writeFileSync(
      join(root, 'no-description', 'SKILL.md'),
      '---\nname: no-description\n---\nbody\n',
    );

    const modules = loadSkillModules(root);
    assert.deepEqual(
      modules.map((m) => m.name),
      ['good-one'],
    );
    assert.equal(errors.length, 3, 'each bad module is logged once');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('loadSkillModules returns [] for a missing folder', () => {
  assert.deepEqual(loadSkillModules('/definitely/not/here'), []);
});

// ── Router cache ──────────────────────────────────────────────────────────

test('a warm cache does not re-embed module descriptions', async () => {
  const { storage, cleanup } = tempStore();
  const skills = mkdtempSync(join(tmpdir(), 'skills-src-'));
  try {
    makeSkill(skills, 'alpha', 'Use when food comes up.');
    makeSkill(skills, 'beta', 'Use when people come up.');
    const { embedder, counts } = fakeEmbedder();
    const modules = loadSkillModules(skills);

    await new SkillRouter(modules, embedder, storage, 'model-a', OPTIONS).route('food');
    assert.equal(counts.texts, 2, 'first run embeds both modules');
    assert.equal(cachedRows(storage), 2);

    counts.batch = 0;
    counts.texts = 0;
    await new SkillRouter(modules, embedder, storage, 'model-a', OPTIONS).route('food');
    assert.equal(counts.texts, 0, 'second run reuses the cache');
  } finally {
    cleanup();
    rmSync(skills, { recursive: true, force: true });
  }
});

test('changing one description re-embeds only that module', async () => {
  const { storage, cleanup } = tempStore();
  const skills = mkdtempSync(join(tmpdir(), 'skills-src-'));
  try {
    makeSkill(skills, 'alpha', 'Use when food comes up.');
    makeSkill(skills, 'beta', 'Use when people come up.');
    const { embedder, counts } = fakeEmbedder();
    await new SkillRouter(loadSkillModules(skills), embedder, storage, 'model-a', OPTIONS).route(
      'x',
    );

    makeSkill(skills, 'beta', 'Use when people and careers come up.');
    counts.texts = 0;
    await new SkillRouter(loadSkillModules(skills), embedder, storage, 'model-a', OPTIONS).route(
      'x',
    );
    assert.equal(counts.texts, 1);
  } finally {
    cleanup();
    rmSync(skills, { recursive: true, force: true });
  }
});

test('a new embedding model re-embeds every module', async () => {
  const { storage, cleanup } = tempStore();
  const skills = mkdtempSync(join(tmpdir(), 'skills-src-'));
  try {
    makeSkill(skills, 'alpha', 'Use when food comes up.');
    makeSkill(skills, 'beta', 'Use when people come up.');
    const { embedder, counts } = fakeEmbedder();
    const modules = loadSkillModules(skills);
    await new SkillRouter(modules, embedder, storage, 'model-a', OPTIONS).route('x');

    counts.texts = 0;
    await new SkillRouter(modules, embedder, storage, 'model-b', OPTIONS).route('x');
    assert.equal(counts.texts, 2);
  } finally {
    cleanup();
    rmSync(skills, { recursive: true, force: true });
  }
});

test('removing a module drops its cache row', async () => {
  const { storage, cleanup } = tempStore();
  const skills = mkdtempSync(join(tmpdir(), 'skills-src-'));
  try {
    makeSkill(skills, 'alpha', 'Use when food comes up.');
    makeSkill(skills, 'beta', 'Use when people come up.');
    const { embedder } = fakeEmbedder();
    await new SkillRouter(loadSkillModules(skills), embedder, storage, 'model-a', OPTIONS).route(
      'x',
    );
    assert.equal(cachedRows(storage), 2);

    rmSync(join(skills, 'beta'), { recursive: true, force: true });
    await new SkillRouter(loadSkillModules(skills), embedder, storage, 'model-a', OPTIONS).route(
      'x',
    );
    assert.equal(cachedRows(storage), 1);
  } finally {
    cleanup();
    rmSync(skills, { recursive: true, force: true });
  }
});

// ── Router behavior ───────────────────────────────────────────────────────

test('concurrent routing on a cold cache builds the index once', async () => {
  const { storage, cleanup } = tempStore();
  const skills = mkdtempSync(join(tmpdir(), 'skills-src-'));
  try {
    makeSkill(skills, 'alpha', 'Use when food comes up.');
    makeSkill(skills, 'beta', 'Use when people come up.');
    const { embedder, counts } = fakeEmbedder();
    const router = new SkillRouter(loadSkillModules(skills), embedder, storage, 'model-a', OPTIONS);
    await Promise.all(Array.from({ length: 8 }, (_, i) => router.guidanceFor(`message ${i}`)));
    assert.equal(counts.batch, 1, 'one embedBatch call for the whole burst');
  } finally {
    cleanup();
    rmSync(skills, { recursive: true, force: true });
  }
});

test('an unreachable embedder fails open: empty guidance, counted as skipped, and retried later', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { storage, cleanup } = tempStore();
  const skills = mkdtempSync(join(tmpdir(), 'skills-src-'));
  try {
    makeSkill(skills, 'alpha', 'Use when food comes up.');
    const { embedder, failures } = fakeEmbedder();
    const router = new SkillRouter(loadSkillModules(skills), embedder, storage, 'model-a', OPTIONS);
    skillStats.calls = 0;
    skillStats.skipped = 0;

    failures.remaining = 1;
    assert.equal(await router.guidanceFor('food'), '');
    assert.equal(skillStats.skipped, 1);

    const second = await router.guidanceFor('food');
    assert.match(second, /Domain guidance/, 'the next call retries and succeeds');
    assert.equal(skillStats.calls, 2);
  } finally {
    cleanup();
    rmSync(skills, { recursive: true, force: true });
  }
});

test('an embedder that returns the wrong number of vectors is treated as a skipped chunk', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { storage, cleanup } = tempStore();
  const skills = mkdtempSync(join(tmpdir(), 'skills-src-'));
  try {
    makeSkill(skills, 'alpha', 'Use when food comes up.');
    makeSkill(skills, 'beta', 'Use when people come up.');
    const embedder: EmbeddingProvider = {
      dim: DIM,
      embed: async (t: string) => vectorFor(t),
      embedBatch: async () => [vectorFor('only one')],
    };
    const router = new SkillRouter(loadSkillModules(skills), embedder, storage, 'model-a', OPTIONS);
    skillStats.skipped = 0;
    assert.equal(await router.guidanceFor('food'), '');
    assert.equal(skillStats.skipped, 1);
  } finally {
    cleanup();
    rmSync(skills, { recursive: true, force: true });
  }
});

test('an empty text routes nothing and makes no embedder calls', async () => {
  const { storage, cleanup } = tempStore();
  const skills = mkdtempSync(join(tmpdir(), 'skills-src-'));
  try {
    makeSkill(skills, 'alpha', 'Use when food comes up.');
    const { embedder, counts } = fakeEmbedder();
    const router = new SkillRouter(loadSkillModules(skills), embedder, storage, 'model-a', OPTIONS);
    assert.deepEqual(await router.route('   '), []);
    assert.equal(counts.single + counts.batch, 0);
  } finally {
    cleanup();
    rmSync(skills, { recursive: true, force: true });
  }
});

test('skillsEnabled is false when embeddings are disabled', () => {
  const before = process.env.SEME_EMBED_PROVIDER;
  try {
    process.env.SEME_EMBED_PROVIDER = 'none';
    assert.equal(skillsEnabled(), false);
  } finally {
    if (before === undefined) delete process.env.SEME_EMBED_PROVIDER;
    else process.env.SEME_EMBED_PROVIDER = before;
  }
});
