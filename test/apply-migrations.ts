import { applyD1Migrations, env } from 'cloudflare:test'

// Bring the D1 schema up before each test file runs.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
