import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig(async () => {
  // Ship the D1 migration files into the test env so test/apply-migrations.ts
  // can bring the schema up before anything runs.
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'))

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          // Dummy secrets so code paths that read them don't explode; tests
          // never hit the real Discord API.
          bindings: {
            DISCORD_PUBLIC_KEY: 'test',
            DISCORD_BOT_TOKEN: 'test-token',
            DISCORD_APPLICATION_ID: 'test-app',
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      // Only this project's tests. Everything here runs inside the Workers
      // runtime, which has no node builtins — the desktop client's suite is
      // plain Node and runs from client/ with its own config.
      include: ['test/**/*.spec.ts'],
      setupFiles: ['./test/apply-migrations.ts'],
    },
  }
})
