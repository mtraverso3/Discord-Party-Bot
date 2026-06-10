import type { AppBindings } from '../src/types'

declare module 'cloudflare:test' {
  interface ProvidedEnv extends AppBindings {}
}
