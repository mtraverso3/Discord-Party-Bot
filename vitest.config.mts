import { cloudflareTest } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
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
        },
      },
    }),
  ],
})
