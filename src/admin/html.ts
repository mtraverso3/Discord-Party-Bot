import { GAMES } from '../lib/games'
import { ADMIN_CSS } from './ui/styles'
import { ADMIN_APP_JS } from './ui/app'

const GAMES_JSON = JSON.stringify(GAMES.map(g => g.value))

export const ADMIN_HTML = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PartyBot Admin</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
<script>
  // Apply the saved theme before first paint to avoid a flash.
  try { document.documentElement.dataset.theme = localStorage.getItem('pb-theme') || 'light' } catch (e) {}
</script>
<style>${ADMIN_CSS}</style>
</head>
<body>
<main class="container">
  <header>
    <hgroup>
      <h2>PartyBot Admin</h2>
      <p id="subtitle" class="muted">Loading…</p>
    </hgroup>
    <div>
      <span id="who" class="muted"></span>
      <a href="?" id="change-guild" style="display:none; margin-left: 1rem">change guild</a>
      <button id="theme-btn" type="button" title="Toggle dark mode">🌙</button>
    </div>
  </header>
  <div id="content"></div>
</main>
<div id="toast" hidden></div>

<script>
const GAMES = ${GAMES_JSON}
${ADMIN_APP_JS}
</script>
</body>
</html>`
