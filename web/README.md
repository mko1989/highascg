# HighAsCG web UI (`web/`)

Static **HTML/CSS/ES modules** — no `npm run build` in the root app; the Node server serves files from this folder (see `src/server/http-server.js`).

| Entry / area | Path |
|--------------|------|
| Document shell, import map | `index.html` |
| App bootstrap, workspace | `app.js` |
| Bundled global styles (imports the rest) | `styles.css` |
| Per-feature CSS | `styles/*.css` |
| UI components (native modules) | `components/*.js` |
| Client state, API, WebSocket | `lib/*.js` |
| SVG / assets | `assets/`, `fonts/` |

**Companion / reverse-proxy prefix:** the server maps `/instance/<id>/*` to the same files as `/*` so relative URLs in `index.html` keep working. Smoke tests under `/instance/…/styles.css` are in `tools/http-smoke.js` (WO-23 T23.5).

Caspar **HTML templates** for playout live under repo `templates/` and are not part of the SPA (served as `/templates/…` when configured).
