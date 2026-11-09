import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev the browser talks to its own origin and Vite forwards /api to the API.
// `portless get api` resolves the API's URL for this worktree (branch prefix
// included), so every worktree proxies to its own API without CORS or port config.
// SEME_API_URL overrides it, e.g. for a bare `vite dev` with the API on :3000.
function devApiTarget(): string {
  if (process.env.SEME_API_URL) return process.env.SEME_API_URL;
  const portless = fileURLToPath(new URL('../../node_modules/.bin/portless', import.meta.url));
  try {
    return execFileSync(portless, ['get', 'api.seme'], { encoding: 'utf8' }).trim();
  } catch {
    return 'http://localhost:3000';
  }
}

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [tanstackStart(), viteReact(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: devApiTarget(),
        changeOrigin: true,
        secure: false, // portless serves a local CA; dev only
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});

export default config;
