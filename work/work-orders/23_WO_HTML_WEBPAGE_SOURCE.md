# Work Order 23: HTML Webpage Source — `client/` static UI

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Document and maintain clarity on **where the HighAsCG browser UI lives**, how it is **served** (no separate build step today), and how paths behave when the app is opened **standalone** vs under a **Companion-style prefix** (`/instance/<id>/`). This work order is the canonical reference for "HTML / SPA source" questions.

## Scope

| Area | Location | Notes |
|------|----------|--------|
| Entry HTML | `client/index.html` | Loads `styles.css`, bootstraps `#app` |
| SPA bootstrap | `client/app.js` | Imports components / workspace |
| Styles | `client/styles.css` (+ `client/styles/*.css` imported from it) | Modular CSS files |
| UI components | `client/components/*.js` | Native ES modules |
| Shared libs | `client/lib/*.js` | API client, WebSocket, state stores |
| Static assets | `client/assets/*`, `client/fonts/` | SVG, fonts |
| Alternate entry | `client/setup.html` | If present — same static root |
| Caspar templates | Repo `templates/` (not under `client/`) | Served as `/templates/...` via `templatesDir` |

**Server implementation:** `src/server/http-server.js` — `serveWebApp()`, `mapInstanceStaticPath()`, MIME map, binary extensions, SPA fallback to `index.html` on unknown routes under `client/`.

## Architecture (static serving)

```
Browser request
       │
       ├─ /api/*  or  /instance/<id>/api/*  ──► API router (not static)
       │
       └─ else ──► mapInstanceStaticPath()
                    /instance/xyz/app.js  →  web/app.js
                    /styles.css           →  web/styles.css
```

- **Companion prefix:** `mapInstanceStaticPath()` strips `/instance/<id>` so asset paths resolve under `client/` regardless of instance id.
- **Unknown path:** Falls back to `client/index.html` (SPA-style) when the file is missing — see `serveWebApp()` catch branch.

## Related

- **WO-24** (`24_WO_COMPANION_BUTTON_PRESS.md`) — timeline → Companion HTTP; orthogonal to static files.
- `README.md` — high-level "open the printed URL", `/instance/` behavior.

---

## Tasks

### Documentation & inventory

- [x] **T23.1** Document `client/` layout and server mapping (this file)
- [x] **T23.2** Record: no `npm run build` for the SPA — sources are served as-is (`package.json` scripts)
- [x] **T23.3** Optional: add a one-page `client/README.md` listing entrypoints and module graph (only if team wants a second index)

### Verification

- [x] **T23.4** Smoke tests already exercise HTTP + `/instance/...` static and WebSocket — `tools/smoke/http-smoke.js`
- [x] **T23.5** Optional: extend smoke to request one static asset under `/instance/<id>/` (e.g. `styles.css`) if not already implied by existing checks

### Future (out of scope unless requested)

- [ ] **T23.F1** Bundler / minification pipeline — not present; would be a product decision
- [ ] **T23.F2** Aggressive cache headers for hashed assets — current server does not set long-lived `Cache-Control` for dev ergonomics

---

## Work Log

*(Agents: add entries below in reverse chronological order)*

### 2026-04-22 — Agent (T23.3, T23.5)

**Work Done:** Added `client/README.md` (entry table, `styles.css` note, no-build reminder). Extended `tools/smoke/http-smoke.js` to `GET /instance/wo03-smoke/styles.css` and assert body looks like CSS (WO-23 T23.5).

**Instructions for Next Agent:** T23.F* remain out of scope (bundler / cache) unless product asks.

### 2026-04-13 — Agent (WO-23: initial work order)

**Work Done:**

- Created this work order with inventory of `client/`, explanation of `http-server.js` static resolution and `/instance/<id>/` stripping, SPA fallback behavior, and separation of `templates/` vs `client/`.
- Confirmed `package.json` has no frontend build step; UI is edited as plain HTML/CSS/JS modules.

**Status:** Core documentation tasks **T23.1**, **T23.2**, **T23.4** marked done (smoke script exists and covers instance paths per README). **T23.3**, **T23.5**, **T23.F*** remain optional.

**Instructions for Next Agent:** If you add a bundler or change static roots, update the Architecture section and **T23.2**. Optionally run `npm run smoke -- <port>` and list which static paths are asserted in `http-smoke.js` in a log entry when extending **T23.5**.

---
*Work Order created: 2026-04-13 | Series: HighAsCG operations*
