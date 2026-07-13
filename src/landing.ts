// Public landing page served at `/`, replacing discord-hono's default
// "Powered by discord-hono" placeholder. The markup lives in landing.html,
// which wrangler bundles as a text module (its default `.html` Text rule).
import html from './landing.html'

export function landingPage(): Response {
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}
