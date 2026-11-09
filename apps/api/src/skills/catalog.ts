// src/skills/catalog.ts — Loads domain skill modules (SKILL.md folders) from disk.
// Format follows the Agent Skills spec: frontmatter with name + description, then a markdown body.

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

export interface SkillModule {
  name: string;
  description: string;
  body: string;
  path: string;
}

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Splits a SKILL.md into its frontmatter key/values and markdown body. */
export function parseSkillFile(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error('missing frontmatter');
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: match[2].trim() };
}

/**
 * Reads every `<dir>/<name>/SKILL.md`. A module that fails to parse is logged and
 * skipped, so one bad file can't take extraction down.
 */
export function loadSkillModules(dir: string): SkillModule[] {
  if (!existsSync(dir)) return [];
  const modules: SkillModule[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, 'SKILL.md');
    if (!existsSync(path)) continue;
    try {
      const { meta, body } = parseSkillFile(readFileSync(path, 'utf8'));
      if (!meta.name || !NAME_RE.test(meta.name))
        throw new Error('name must be lowercase kebab-case');
      if (meta.name !== entry.name)
        throw new Error(`name "${meta.name}" must match folder "${entry.name}"`);
      if (!meta.description) throw new Error('missing description');
      modules.push({ name: meta.name, description: meta.description, body, path });
    } catch (e) {
      console.error(`[skills] skipped ${path}: ${(e as Error).message}`);
    }
  }
  return modules.sort((a, b) => a.name.localeCompare(b.name));
}
