import type { D1Migration } from '@cloudflare/workers-types/experimental'
import type { AppBindings } from '../src/types'

// The bindings `env` from 'cloudflare:test' carries: the Worker's own, plus
// the migrations vitest.config.mts ships in for test/apply-migrations.ts.
declare global {
  namespace Cloudflare {
    interface Env extends AppBindings {
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}
