# WO-163 — Remove interactive project map from the main service (GitHub Pages only)

**Status:** Completed (2026-07-13)
**Priority:** Low-Medium (hygiene; map was never meant to ship in the operator service)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner): "gemini added the project map to the main service. that is meant only to be deployed as a github page."
**Related:** WO-83/83a-g (interactive project map).

---

## 1. Investigation findings (2026-07-13)

The map is wired into the main service in three places; the GitHub Pages path is separate and already correct:

- **HTTP route:** `src/server/http-server.js:259-279` serves `/map` from `dist-web/map.html` or `client/map.html`.
- **Header link:** `client/components/header-bar.js:249-254` creates a "🗺️ Map" link; appended at `:297`.
- **Build coupling:** `package.json:12` `build:client` runs `npm run map:generate && vite build`; `:13` `prebuild:client` also runs map:generate — the main client build depends on map generation.
- **Map viewer files bundled with the client:** `client/map.html`, `client/components/map-explorer.js`, `client/styles/map-explorer.css`, generated `client/assets/map-data.json`, `dist-web/map.html`.
- **Keep untouched (GitHub Pages pipeline is correct):** `.github/workflows/pages.yml:18-36` (builds map separately via `vite.map.config.js` → `dist-map/` → `_site/map/`), `tools/map/generate-map-data.js`, `vite.map.config.js`; `.gitignore`/`eslint.config.js` already handle `dist-map/`.
- Runtime cost of the current wiring is trivial (one string compare per request; no watchers/memory), so this is hygiene, not perf.

## 2. Tasks

- [x] T163.1 Remove the `/map` route (`http-server.js:259-279`).
- [x] T163.2 Remove the header map link (`header-bar.js:249-254`, `:297` append).
- [x] T163.3 Decouple builds: `build:client` = `vite build` only; remove `prebuild:client`. Keep `build:map` + `map:generate` scripts (Pages workflow uses them).
- [x] T163.4 Delete map viewer files from the client tree: `client/map.html`, `client/components/map-explorer.js`, `client/styles/map-explorer.css`, `client/assets/map-data.json`, `dist-web/map.html`. Verify nothing else imports map-explorer (grep before deleting). Check vite config for a map.html input that would now break.
- [x] T163.5 Verify: grep for remaining `/map` references in client/src; `node --check`/eslint touched JS; client build (`npx vite build`) succeeds without the map files IF the box can run it (vite may not be installed here — if not, note it and rely on grep + syntax checks).

## 3. Acceptance criteria

- [x] A163.1 `/map` on the main service returns the standard 404; no map link in the header.
- [x] A163.2 GitHub Pages workflow untouched and still references existing scripts/files.
- [x] A163.3 Gates green (`lint`, `test:ci`).

## 4. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`; wiring mapped (route, header link, build coupling, bundled files); Pages pipeline confirmed separate and correct.
- 2026-07-13 — T163.1-T163.5 completed: removed /map route (http-server.js:259-279), removed header map link (header-bar.js:249-254, append), decoupled builds (build:client="vite build", removed prebuild:client), deleted map files (map.html, map-explorer.js/.css, map-data.json, dist-web/map.html), removed map input from vite.config.js. Verified: no /map references remain, node --check OK, eslint OK (4 pre-existing warnings), vite build succeeded.
