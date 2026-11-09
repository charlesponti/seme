// scripts/dev.mjs — start the API for dev.
//
// The main checkout keeps the shared store at ~/.hominem, same as always.
// A git worktree gets its own store under ~/.hominem/worktrees/<branch>, so
// two branches don't read or write each other's memories. SEME_STORAGE_DIR
// still wins if you set it yourself.

import { execFileSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function devStorageDir() {
  if (process.env.SEME_STORAGE_DIR) return process.env.SEME_STORAGE_DIR;
  const base = join(homedir(), '.hominem');
  try {
    const gitDir = resolve(git('rev-parse', '--git-dir'));
    const commonDir = resolve(git('rev-parse', '--git-common-dir'));
    if (gitDir === commonDir) return base; // main checkout

    const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
    const name = branch === 'HEAD' ? `detached-${git('rev-parse', '--short', 'HEAD')}` : branch;
    return join(base, 'worktrees', name.replace(/[^A-Za-z0-9._-]+/g, '-'));
  } catch {
    return base; // not a git checkout (e.g. a tarball) — use the shared store
  }
}

const storageDir = devStorageDir();
console.log(`[dev] store: ${storageDir}`);

const child = spawn(process.execPath, ['dist/server.js'], {
  stdio: 'inherit',
  env: { ...process.env, SEME_STORAGE_DIR: storageDir },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
