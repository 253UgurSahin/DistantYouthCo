import { defineConfig } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// The test passwords come from the git-ignored .env or forge-work/test/e2e.env, never from a command.
for (const file of ['../.env', '../forge-work/test/e2e.env']) try {
  const env = parseEnv(readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(env)) if (k.startsWith('E2E_') && !process.env[k]) process.env[k] = v;
} catch { /* not there: the signed-in tests are skipped */ }

export default defineConfig({
  workers: 1,
  timeout: 45_000,
  use: {
    baseURL: process.env.FORGE_BASE_URL || 'http://localhost:3100',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'chromium', testMatch: /\.spec\.ts$/, testIgnore: /walk\.spec\.ts$/, dependencies: ['setup'] },
    ...(process.env.FORGE_ROUND ? [{ name: 'walk', testMatch: /walk\.spec\.ts$/, dependencies: ['setup'] }] : []),
  ],
});
