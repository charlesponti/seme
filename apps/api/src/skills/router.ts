// src/skills/router.ts — Picks the domain skill modules relevant to a piece of input.
// Matches the input against each module's description with the same embedding
// provider the rest of the engine uses. Module vectors are cached in SQLite
// (skill_embeddings), so only new or changed modules get embedded. Fails open: if
// embeddings are down, the caller gets no guidance and extraction runs on the base
// prompt alone.

import { createHash } from 'crypto';
import {
  createEmbeddingProvider,
  embeddingModelId,
  EmbeddingProvider,
} from '../embeddings/embedding-provider.js';
import { Storage } from '../storage/storage.js';
import { nowUtc } from '../types/common.js';
import { loadSkillModules, SkillModule } from './catalog.js';
import { join } from 'path';

export interface RouterOptions {
  /** Most modules to load for one input. */
  topK: number;
  /** Cosine similarity floor. Below this a module is not loaded. */
  minScore: number;
}

// qwen3-embedding:0.6b compresses similarities into roughly 0.26-0.63 for these
// short descriptions, so the floor sits low. Calibrate against a labeled routing set.
export const DEFAULT_ROUTER_OPTIONS: RouterOptions = { topK: 2, minScore: 0.32 };

export interface RouteHit {
  module: SkillModule;
  score: number;
}

interface IndexedModule {
  module: SkillModule;
  vector: number[];
}

/** Process-wide counters for routing calls. The eval runner resets them per run. */
export const skillStats = { calls: 0, routed: 0, skipped: 0 };

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Cache key for one module: changes when the description or the embedding model changes. */
function contentHash(modelId: string, description: string): string {
  return createHash('sha256').update(`${modelId}\n${description}`).digest('hex');
}

export class SkillRouter {
  private modules: SkillModule[];
  private embedder: EmbeddingProvider;
  private storage: Storage;
  private modelId: string;
  private options: RouterOptions;
  private indexed: Promise<IndexedModule[]> | null = null;

  constructor(
    modules: SkillModule[],
    embedder: EmbeddingProvider,
    storage: Storage,
    modelId: string,
    options: RouterOptions = DEFAULT_ROUTER_OPTIONS,
  ) {
    this.modules = modules;
    this.embedder = embedder;
    this.storage = storage;
    this.modelId = modelId;
    this.options = options;
  }

  /**
   * Loads module vectors from the SQLite cache, embeds only the misses, and writes
   * them back. Retries on the next call if it fails.
   */
  private index(): Promise<IndexedModule[]> {
    if (!this.indexed) {
      this.indexed = this.buildIndex().catch((e) => {
        this.indexed = null;
        throw e;
      });
    }
    return this.indexed;
  }

  private async buildIndex(): Promise<IndexedModule[]> {
    const hashes = new Map(
      this.modules.map((m) => [m.name, contentHash(this.modelId, m.description)]),
    );

    const cached = this.storage.read(
      (db) =>
        db.prepare('SELECT skill_name, content_hash, vector FROM skill_embeddings').all() as {
          skill_name: string;
          content_hash: string;
          vector: string;
        }[],
    );
    const vectors = new Map<string, number[]>();
    for (const row of cached) {
      if (hashes.get(row.skill_name) === row.content_hash)
        vectors.set(row.skill_name, JSON.parse(row.vector) as number[]);
    }

    const misses = this.modules.filter((m) => !vectors.has(m.name));
    if (misses.length > 0) {
      const fresh = await this.embedder.embedBatch(misses.map((m) => m.description));
      if (fresh.length !== misses.length) {
        throw new Error(`embedder returned ${fresh.length} vectors for ${misses.length} modules`);
      }
      const now = nowUtc();
      await this.storage.write((db) => {
        const upsert = db.prepare(
          'INSERT OR REPLACE INTO skill_embeddings (skill_name, content_hash, embed_model, dim, vector, indexed_at) VALUES (?, ?, ?, ?, ?, ?)',
        );
        misses.forEach((m, i) => {
          vectors.set(m.name, fresh[i]);
          upsert.run(
            m.name,
            hashes.get(m.name),
            this.modelId,
            fresh[i].length,
            JSON.stringify(fresh[i]),
            now,
          );
        });
      });
    }

    // Drop cache rows for modules that no longer exist on disk.
    const names = this.modules.map((m) => m.name);
    await this.storage.write((db) => {
      const placeholders = names.length > 0 ? names.map(() => '?').join(',') : "''";
      db.prepare(`DELETE FROM skill_embeddings WHERE skill_name NOT IN (${placeholders})`).run(
        ...names,
      );
    });

    return this.modules.map((module) => ({ module, vector: vectors.get(module.name)! }));
  }

  /** Top modules for the text, best first, above the similarity floor. */
  async route(text: string): Promise<RouteHit[]> {
    if (this.modules.length === 0 || text.trim() === '') return [];
    const indexed = await this.index();
    const query = await this.embedder.embed(text.slice(0, 2000));
    return indexed
      .map(({ module, vector }) => ({ module, score: cosine(query, vector) }))
      .filter((h) => h.score >= this.options.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.options.topK);
  }

  /** Text to append to a system prompt: the bodies of the routed modules, or '' when none match. */
  async guidanceFor(text: string): Promise<string> {
    skillStats.calls++;
    try {
      const hits = await this.route(text);
      if (hits.length === 0) {
        console.log('[skills] routed: none');
        return '';
      }
      skillStats.routed++;
      console.log(
        `[skills] routed: ${hits.map((h) => `${h.module.name} ${h.score.toFixed(3)}`).join(', ')}`,
      );
      const sections = hits.map((h) => `### ${h.module.name}\n${h.module.body}`);
      return `\n\nDomain guidance for this input (reference, not user statements):\n\n${sections.join('\n\n')}`;
    } catch (e) {
      skillStats.skipped++;
      console.error(`[skills] routing skipped: ${(e as Error).message}`);
      return '';
    }
  }
}

/** Skills run whenever an embedder is configured. */
export function skillsEnabled(): boolean {
  return embeddingModelId() !== 'none';
}

/** Default router over the bundled skills folder. Returns null when skills are disabled. */
export function createSkillRouter(storage: Storage): SkillRouter | null {
  if (!skillsEnabled()) return null;
  const dir = process.env.SEME_SKILLS_DIR || join(__dirname, '..', '..', 'skills');
  const modules = loadSkillModules(dir);
  return new SkillRouter(modules, createEmbeddingProvider(), storage, embeddingModelId());
}
