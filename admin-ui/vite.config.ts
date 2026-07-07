import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The SPA is served by the Worker under /admin (see src/admin/index.ts, which
// strips the prefix before hitting the assets binding), so all asset URLs must
// be rooted there.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    fs: { allow: ['..'] },  // the app imports GAMES from ../src/lib/games.ts
    proxy: {
      // `npm run dev` here + `wrangler dev` in the repo root gives hot reload
      // against the real Worker API.
      '/admin/api': 'http://localhost:8787',
    },
  },
})
