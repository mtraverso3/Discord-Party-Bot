import type { D1Migration } from '@cloudflare/workers-types/experimental'
import type { AppBindings } from '../src/types'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends AppBindings {
    TEST_MIGRATIONS: D1Migration[]
  }
}
