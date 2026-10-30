# client — sweep 29.10.2026 (batch 002)

Files: 5 · lines: 727 · findings: 0 BUG-HIGH, 0 BUG, 3 DEAD, 1 RISK, 2 QUALITY

## client/app.js
- `DEAD` client/app.js:99-103 (+ :82) — the `mv-caspar-amcp-connected` CustomEvent is dispatched but nothing listens. grep: `rg -n "mv-caspar-amcp-connected" . --glob '!work/**' --glob '!dist*' --glob '!client/assets/map-data.json'` → only the `dispatchEvent` at app.js:101 (client, src, tools, godot, scripts all searched). So `appLogic.emitCasparConnectedIfNeeded`, `_casparAmcpConnected` and its two call sites (client/lib/app-ws-handlers.js:90,183) only feed an event with no consumer. Remove all three or add the missing listener.
- `DEAD` client/app.js:147 — `window.highascg_osc_client = _oscClient` is never read. grep: `rg -n "highascg_osc_client" . --glob '!work/**'` → the assignment only. (`getOscClient` closures are passed explicitly everywhere.)
- `DEAD` client/app.js:71,77,374 — `export const stateStore`, `export const ws`, `export function getOscClient` have no importer: `rg -n "from ['\"].*/app(\.js)?['\"]|import\(.*app\.js" client tools src` → no hits (only comments in lib/app-runtime.js, assets/modules/previs/entry.js). app.js is the Vite entry; the `export` keywords are leftovers from before `lib/app-runtime.js` (setAppRuntime) existed.
- `QUALITY` client/app.js (global) — RULES.md "Input fields" rule 1 (focus selects the whole value, "every client (Godot and web)") has no global implementation in the web client: `rg "focusin"` finds nothing, and the only per-field implementation is client/components/inspector-clip-trim.js:135 (`f.addEventListener('focus', () => f.select())`). Number fields get maths via `attachMathInput` (rule 2) but text/number fields elsewhere (e.g. destination name/IP, companion page, most inspector fields) do not select on focus. One capture-phase `document.addEventListener('focusin', e => e.target.matches('input[type=text],input[type=number]') && e.target.select())` in app.js would satisfy the rule everywhere. Owner decision whether the web client still needs to comply now that Godot is the primary client.

## client/index.html
- `OK` — every id/class that app.js queries exists (`#connection-eye-container`, `.header__status`, `#panel-sources .panel__body`, `#tab-*`, `#panel-inspector-*-mount`); assets (`assets/favicon.png`, `assets/logo.webp`) and `styles.css` exist; the importmap bootstrap is consistent with vite.config.js:88-91. (`#tab-pixelmap` has no tab button, but `initPixelMapEditor` uses it as the editor's mount root and `highascg-pixel-mapping-open` re-parents the editor, so it is not dead.)

## client/map.html
- `QUALITY` client/map.html:10-11 — loads Inter from fonts.googleapis.com at runtime. The page ships on a production playout box that supports `offline_mode`; offline the `preconnect`/stylesheet request just fails (text falls back), but it is the only external network dependency in the shipped client html/css. Self-host the font (client/assets/fonts) or drop it.

## client/setup.html
- `RISK` client/setup.html:93-97 (used at :55,:70,:78,:84,:85) — `escapeHtml()` is `textContent` → `innerHTML`, which escapes `& < >` but NOT `"`/`'`, yet it is used inside double-quoted `href="…"` attributes (Tailscale `authUrl`, `syncthing.guiUrl`, `adminUrls.*`). A value containing `"` (or a `javascript:` URL) would break out of / inject into the attribute. All values come from the node's own `/api/system/setup` (routes-system-setup.js), so no external attacker input today; tools/ci/check-dom-escape-duplicates.js explicitly allow-lists this local copy. Use `lib/dom-escape.js`'s `escapeAttr` equivalent for attribute positions.

## client/styles.css
- `OK` — all 44 `@import`ed files exist. The 18 files in client/styles/ not imported here are all reached another way (imported from 07c-/09-/09a-/09b-*.css, from optional-module styles listed in src/previs/register.js:60, or `map-explorer.css` from map.html).
