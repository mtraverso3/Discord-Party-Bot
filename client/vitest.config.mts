import { defineConfig } from 'vitest/config'

// Without a local config, vitest walks up and loads the repo root's
// vitest.config.mts, which needs @cloudflare/vitest-pool-workers — not
// installed (or wanted) here.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
  },
})
