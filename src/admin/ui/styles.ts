/** CSS for the admin UI, injected into a <style> tag by html.ts. */

export const ADMIN_CSS = `
  :root {
    --pico-form-element-spacing-vertical: 0.45rem;
    --pico-form-element-spacing-horizontal: 0.7rem;
    --pico-border-radius: 0.5rem;
    --ok: #15803d;      --ok-bg: #dcfce7;
    --warn: #a16207;    --warn-bg: #fef3c7;
    --bad: #b91c1c;     --bad-bg: #fee2e2;
    --chip-bg: rgba(0, 0, 0, 0.05);
    --row-hover: rgba(0, 0, 0, 0.03);
    --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }
  [data-theme=dark] {
    --ok: #4ade80;      --ok-bg: rgba(34, 197, 94, 0.16);
    --warn: #fbbf24;    --warn-bg: rgba(245, 158, 11, 0.16);
    --bad: #f87171;     --bad-bg: rgba(239, 68, 68, 0.16);
    --chip-bg: rgba(255, 255, 255, 0.08);
    --row-hover: rgba(255, 255, 255, 0.04);
    --card-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }

  body { padding: 0.9rem 1rem 3.5rem; }
  main.container { max-width: 920px; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.75rem; }
  header h2 { margin: 0; font-size: 1.35rem; letter-spacing: -0.01em; }
  header hgroup p { margin: 0; }
  input, select, textarea, button { margin-bottom: 0; }
  label { display: block; margin: 0; font-size: 0.82em; font-weight: 500; color: var(--pico-muted-color); }
  label > input, label > select, label > textarea { margin-top: 0.25rem; font-weight: 400; }
  h5 { font-size: 0.95rem; }
  .muted { color: var(--pico-muted-color); font-size: 0.85em; }
  .uid { color: var(--pico-muted-color); font-size: 0.78em; font-family: var(--pico-font-family-monospace); }

  /* ── Buttons ── */
  button.tiny { font-size: 0.8em; padding: 0.25rem 0.7rem; margin: 0; line-height: 1.3; border-radius: 0.4rem; width: auto; }
  button.ghost, button.ghost-danger {
    background: transparent; border: 1px solid var(--pico-muted-border-color);
    color: var(--pico-color); box-shadow: none;
  }
  button.ghost:hover { border-color: var(--pico-primary); color: var(--pico-primary); background: transparent; }
  button.ghost-danger { color: var(--bad); }
  button.ghost-danger:hover { border-color: var(--bad); background: var(--bad-bg); color: var(--bad); }
  button.danger { --pico-background-color: #dc2626; --pico-border-color: #dc2626; --pico-color: white; }
  button.danger:hover { --pico-background-color: #b91c1c; --pico-border-color: #b91c1c; }
  button:disabled { opacity: 0.35; }

  /* ── Toolbar ── */
  .toolbar { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin: 0.75rem 0; }
  .toolbar > .grow, .grow { flex: 1; }

  /* ── Tabs (segmented) ── */
  nav.tabs { display: inline-flex; gap: 0.15rem; background: var(--chip-bg); border-radius: 999px; padding: 0.2rem; margin-bottom: 1.1rem; flex-wrap: wrap; }
  nav.tabs a { padding: 0.35rem 0.95rem; border-radius: 999px; text-decoration: none; color: var(--pico-muted-color); font-size: 0.88em; font-weight: 500; transition: color 0.12s ease, background 0.12s ease; }
  nav.tabs a:hover { color: var(--pico-color); }
  nav.tabs a.active { background: var(--pico-card-background-color); color: var(--pico-color); box-shadow: var(--card-shadow); font-weight: 600; }

  /* ── Guild picker ── */
  .guild-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 0.6rem; margin: 1rem 0; }
  .gcard { display: flex; align-items: center; gap: 0.75rem; padding: 0.8rem 0.95rem; border: 1px solid var(--pico-muted-border-color); border-radius: 0.75rem; text-decoration: none; color: inherit; background: var(--pico-card-background-color); box-shadow: var(--card-shadow); transition: border-color 0.12s ease, transform 0.12s ease; }
  .gcard:hover { border-color: var(--pico-primary); transform: translateY(-1px); }
  .gicon { width: 2.6rem; height: 2.6rem; border-radius: 50%; flex-shrink: 0; }
  .ginit { display: flex; align-items: center; justify-content: center; background: var(--pico-primary); color: var(--pico-primary-inverse); font-weight: 700; }
  .gname { font-weight: 600; }

  /* ── Dashboard ── */
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; margin-bottom: 1rem; }
  .stat { padding: 0.85rem 1rem; border: 1px solid var(--pico-muted-border-color); border-radius: 0.75rem; background: var(--pico-card-background-color); box-shadow: var(--card-shadow); }
  .stat .num { font-size: 1.45rem; font-weight: 700; line-height: 1.25; letter-spacing: -0.01em; }
  .stat .lbl { font-size: 0.78em; color: var(--pico-muted-color); margin-top: 0.1rem; }
  .grid-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  @media (max-width: 700px) { .grid-2col { grid-template-columns: 1fr; } }
  .grid-2col article { margin: 0; padding: 0.9rem 1rem; border-radius: 0.75rem; box-shadow: var(--card-shadow); }
  .grid-2col h5 { margin: 0 0 0.5rem; }
  table.compact { font-size: 0.88em; margin: 0; }
  table.compact td, table.compact th { padding: 0.35rem 0.5rem; }

  /* ── Status & chips ── */
  .status { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.78em; font-weight: 600; padding: 0.1rem 0.6rem; border-radius: 999px; }
  .status .dot { width: 0.45rem; height: 0.45rem; border-radius: 50%; background: currentColor; }
  .st-open   { color: var(--ok);   background: var(--ok-bg); }
  .st-full   { color: var(--warn); background: var(--warn-bg); }
  .st-closed { color: var(--bad);  background: var(--bad-bg); }
  .chip { display: inline-block; padding: 0.08rem 0.55rem; border-radius: 999px; font-size: 0.75em; font-weight: 500; background: var(--chip-bg); color: var(--pico-muted-color); white-space: nowrap; }
  .chip-warn { background: var(--warn-bg); color: var(--warn); }
  .warn { color: var(--warn); background: var(--warn-bg); padding: 0.1rem 0.55rem; border-radius: 999px; font-size: 0.8em; font-weight: 600; }

  /* ── Party cards ── */
  details.party { margin: 0.55rem 0; border: 1px solid var(--pico-muted-border-color); border-radius: 0.75rem; overflow: visible; background: var(--pico-card-background-color); box-shadow: var(--card-shadow); transition: border-color 0.12s ease; }
  details.party:hover { border-color: var(--pico-secondary-border); }
  details.party[open] { border-color: var(--pico-primary); }
  details.party > summary {
    cursor: pointer;
    padding: 0.65rem 2.4rem 0.65rem 0.95rem;
    list-style: none;
    position: relative;
    border-radius: 0.75rem;
  }
  details.party[open] > summary { border-radius: 0.75rem 0.75rem 0 0; border-bottom: 1px solid var(--pico-muted-border-color); }
  details.party > summary::-webkit-details-marker,
  details.party > summary::marker { display: none; content: ''; }
  details.party > summary::after {
    content: '';
    position: absolute; top: 50%; right: 1rem;
    width: 0.5rem; height: 0.5rem;
    border-right: 2px solid var(--pico-muted-color);
    border-bottom: 2px solid var(--pico-muted-color);
    transform: translateY(-75%) rotate(45deg);
    transition: transform 0.15s ease;
  }
  details.party[open] > summary::after { transform: translateY(-25%) rotate(-135deg); }
  .summary-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .summary-row .name { font-weight: 600; }
  .summary-row .meta { color: var(--pico-muted-color); font-size: 0.8em; white-space: nowrap; }
  .body { padding: 0.8rem 0.95rem 0.95rem; }

  /* ── In-card section switcher ── */
  .seg { display: inline-flex; gap: 0.15rem; background: var(--chip-bg); border-radius: 0.5rem; padding: 0.18rem; margin-bottom: 0.7rem; }
  .seg-btn { background: transparent; border: none; box-shadow: none; color: var(--pico-muted-color); font-size: 0.82em; font-weight: 500; padding: 0.25rem 0.8rem; border-radius: 0.38rem; margin: 0; width: auto; line-height: 1.4; cursor: pointer; }
  .seg-btn:hover { color: var(--pico-color); background: transparent; }
  .seg-btn.active { background: var(--pico-card-background-color); color: var(--pico-color); box-shadow: var(--card-shadow); font-weight: 600; }

  /* ── People rows ── */
  .row { display: flex; gap: 0.6rem; align-items: center; padding: 0.4rem 0.4rem; border-radius: 0.5rem; flex-wrap: wrap; }
  .row:hover { background: var(--row-hover); }
  .row .who { flex: 1; min-width: 10rem; font-size: 0.92em; line-height: 1.35; }
  .row .who .crown { font-size: 0.9em; }
  .av { display: inline-flex; align-items: center; justify-content: center; width: 1.9rem; height: 1.9rem; border-radius: 50%; color: white; font-size: 0.8em; font-weight: 700; flex-shrink: 0; user-select: none; }
  .qpos { color: var(--pico-muted-color); font-size: 0.78em; font-family: var(--pico-font-family-monospace); width: 1.1rem; text-align: right; flex-shrink: 0; }
  .subhead { font-size: 0.78em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--pico-muted-color); margin: 0.7rem 0 0.2rem; padding-left: 0.4rem; }
  .addbar { margin: 0.6rem 0 0.2rem; }
  .voicebar { margin: 0.4rem 0 0; }

  /* ── Forms ── */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  @media (max-width: 640px) { .grid-2 { grid-template-columns: 1fr; } }
  .grid-2 .span-2 { grid-column: 1 / -1; }
  textarea.bans { min-height: 6rem; font-family: var(--pico-font-family-monospace); font-size: 0.9em; }
  .activity { font-size: 0.8em; margin-bottom: 0.6rem; }
  .activity span[title] { cursor: help; border-bottom: 1px dotted var(--pico-muted-border-color); }

  /* ── User picker ── */
  .upick { position: relative; }
  .upick-list { position: absolute; top: 100%; left: 0; right: 0; z-index: 20; margin-top: 0.2rem; border: 1px solid var(--pico-muted-border-color); border-radius: 0.5rem; background: var(--pico-card-background-color); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12); max-height: 14rem; overflow-y: auto; }
  .upick-item { display: flex; gap: 0.5rem; align-items: baseline; width: 100%; text-align: left; background: none; border: none; border-radius: 0; margin: 0; padding: 0.45rem 0.75rem; color: inherit; font-size: 0.9em; cursor: pointer; box-shadow: none; }
  .upick-item:hover { background: var(--row-hover); }

  /* ── Users tab ── */
  .uhead { display: flex; align-items: center; gap: 0.6rem; }
  .ign-row { display: flex; gap: 0.5rem; align-items: center; padding: 0.25rem 0; }
  .ign-row label { flex: 0 0 9rem; margin: 0; }
  .ign-row input { flex: 1; }

  /* ── Confirm dialog ── */
  dialog.confirm { border: 1px solid var(--pico-muted-border-color); border-radius: 0.75rem; background: var(--pico-card-background-color); color: var(--pico-color); padding: 1.1rem 1.25rem; max-width: 24rem; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25); }
  dialog.confirm::backdrop { background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(2px); }
  dialog.confirm p { margin: 0 0 1rem; font-size: 0.95em; }
  .dlg-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  .dlg-actions button { width: auto; font-size: 0.88em; padding: 0.35rem 0.9rem; }

  /* ── Toast / banners / misc ── */
  #toast { position: fixed; bottom: 1.25rem; right: 1.25rem; padding: 0.6rem 1rem; border-radius: 0.5rem; background: var(--pico-card-background-color); border: 1px solid var(--pico-muted-border-color); border-left: 3px solid var(--ok); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15); z-index: 50; font-size: 0.9em; animation: toast-in 0.18s ease; }
  #toast.err { border-left-color: var(--bad); color: var(--bad); }
  @keyframes toast-in { from { opacity: 0; transform: translateY(0.5rem); } to { opacity: 1; transform: none; } }
  #expired { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; gap: 1rem; align-items: center; justify-content: center; padding: 0.6rem 1rem; background: var(--bad-bg); color: var(--bad); font-size: 0.92em; }
  #expired button { margin: 0; padding: 0.2rem 0.8rem; font-size: 0.9em; width: auto; }
  .empty { padding: 3rem 1rem; text-align: center; color: var(--pico-muted-color); border: 1px dashed var(--pico-muted-border-color); border-radius: 0.75rem; margin: 0.75rem 0; }
  #theme-btn { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 0 0.3rem; color: var(--pico-muted-color); width: auto; box-shadow: none; }
`
