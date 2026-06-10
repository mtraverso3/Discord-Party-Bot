/** CSS for the admin UI, injected into a <style> tag by html.ts. */

export const ADMIN_CSS = `
  :root { --pico-form-element-spacing-vertical: 0.5rem; --pico-form-element-spacing-horizontal: 0.7rem; }
  body { padding: 0.75rem 1rem 3rem; }
  main.container { max-width: 920px; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
  header h2 { margin: 0; font-size: 1.4rem; }
  header hgroup p { margin: 0; }
  .toolbar { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin: 0.75rem 0; }
  .toolbar > .grow { flex: 1; }
  input, select, textarea, button { margin-bottom: 0; }
  label { display: block; margin: 0; font-size: 0.85em; color: var(--pico-muted-color); }
  label > input, label > select, label > textarea { margin-top: 0.2rem; }
  h5 { font-size: 0.95rem; }

  /* Tabs */
  nav.tabs { display: flex; gap: 0.25rem; flex-wrap: wrap; border-bottom: 1px solid var(--pico-muted-border-color); margin-bottom: 1rem; }
  nav.tabs a { padding: 0.45rem 0.9rem; text-decoration: none; color: var(--pico-muted-color); border-bottom: 2px solid transparent; margin-bottom: -1px; font-size: 0.92em; }
  nav.tabs a.active { color: var(--pico-primary); border-bottom-color: var(--pico-primary); font-weight: 600; }
  nav.tabs a:hover { color: var(--pico-primary-hover); }

  /* Guild picker */
  .guild-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 0.6rem; margin: 1rem 0; }
  .gcard { display: flex; align-items: center; gap: 0.7rem; padding: 0.7rem 0.85rem; border: 1px solid var(--pico-muted-border-color); border-radius: var(--pico-border-radius); text-decoration: none; color: inherit; background: var(--pico-card-background-color); }
  .gcard:hover { border-color: var(--pico-primary); }
  .gicon { width: 2.4rem; height: 2.4rem; border-radius: 50%; flex-shrink: 0; }
  .ginit { display: flex; align-items: center; justify-content: center; background: var(--pico-primary); color: var(--pico-primary-inverse); font-weight: 700; }
  .gname { font-weight: 600; }

  /* Dashboard */
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; margin-bottom: 1rem; }
  .stat { padding: 0.75rem 0.9rem; border: 1px solid var(--pico-muted-border-color); border-radius: var(--pico-border-radius); background: var(--pico-card-background-color); }
  .stat .num { font-size: 1.5rem; font-weight: 700; line-height: 1.2; }
  .stat .lbl { font-size: 0.8em; color: var(--pico-muted-color); }
  .grid-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  @media (max-width: 700px) { .grid-2col { grid-template-columns: 1fr; } }
  .grid-2col article { margin: 0; padding: 0.85rem; }
  .grid-2col h5 { margin: 0 0 0.5rem; }
  table.compact { font-size: 0.88em; margin: 0; }
  table.compact td, table.compact th { padding: 0.3rem 0.5rem; }

  /* Party cards */
  details.party { margin: 0.5rem 0; border: 1px solid var(--pico-muted-border-color); border-radius: var(--pico-border-radius); overflow: hidden; background: var(--pico-card-background-color); }
  details.party > summary {
    cursor: pointer;
    padding: 0.55rem 2.25rem 0.55rem 0.85rem;
    background: var(--pico-card-sectioning-background-color);
    list-style: none;
    position: relative;
    background-image: none;
  }
  details.party > summary::-webkit-details-marker,
  details.party > summary::marker { display: none; content: ''; }
  details.party > summary::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 0.85rem;
    width: 0.55rem;
    height: 0.55rem;
    border-right: 2px solid var(--pico-muted-color);
    border-bottom: 2px solid var(--pico-muted-color);
    transform: translateY(-75%) rotate(45deg);
    transition: transform 0.15s ease;
  }
  details.party[open] > summary::after { transform: translateY(-25%) rotate(-135deg); }
  details.party[open] > summary { border-bottom: 1px solid var(--pico-muted-border-color); }
  .summary-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .summary-row .name { font-weight: 600; }
  .summary-row .meta { color: var(--pico-muted-color); font-size: 0.85em; }
  .pill { display: inline-block; padding: 0.05rem 0.55rem; border-radius: 999px; font-size: 0.75em; font-weight: 600; line-height: 1.5; }
  .pill-open   { background: #d1fae5; color: #065f46; }
  .pill-full   { background: #fef3c7; color: #92400e; }
  .pill-closed { background: #fee2e2; color: #991b1b; }
  .body { padding: 0.85rem; }
  .body h5 { margin-top: 1rem; margin-bottom: 0.45rem; }
  .body h5:first-of-type { margin-top: 0; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
  .grid-2 .span-2 { grid-column: 1 / -1; }
  .row { display: flex; gap: 0.5rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid var(--pico-muted-border-color); flex-wrap: wrap; }
  .row:last-child { border-bottom: none; }
  .row .who { flex: 1; min-width: 11rem; font-size: 0.92em; }
  .row .who .crown { color: #d4a017; margin-right: 0.25rem; }
  .row .who .uid { color: var(--pico-muted-color); font-size: 0.8em; font-family: var(--pico-font-family-monospace); }
  .uid { color: var(--pico-muted-color); font-size: 0.8em; font-family: var(--pico-font-family-monospace); }
  button.tiny { font-size: 0.8em; padding: 0.2rem 0.6rem; margin: 0; line-height: 1.2; }
  button.danger { --pico-background-color: #dc2626; --pico-border-color: #dc2626; --pico-color: white; }
  button.danger:hover { --pico-background-color: #b91c1c; --pico-border-color: #b91c1c; }
  textarea.bans { min-height: 6rem; font-family: var(--pico-font-family-monospace); font-size: 0.9em; }
  .muted { color: var(--pico-muted-color); font-size: 0.85em; }
  #toast { position: fixed; bottom: 1.25rem; right: 1.25rem; padding: 0.6rem 1rem; border-radius: 0.4rem; background: var(--pico-card-background-color); box-shadow: var(--pico-card-box-shadow); z-index: 10; }
  #toast.err { background: #fee2e2; color: #991b1b; }
  .empty { padding: 2.5rem 1rem; text-align: center; color: var(--pico-muted-color); }
  .activity { margin: -0.25rem 0 0.85rem; font-size: 0.82em; }
  .activity span[title] { cursor: help; border-bottom: 1px dotted var(--pico-muted-border-color); }
  .warn { color: #92400e; background: #fef3c7; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.8em; font-weight: 600; }

  /* Users tab */
  .ign-row { display: flex; gap: 0.5rem; align-items: center; padding: 0.25rem 0; }
  .ign-row label { flex: 0 0 9rem; margin: 0; }
  .ign-row input { flex: 1; }

  #theme-btn { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 0 0.3rem; color: var(--pico-muted-color); }
`
