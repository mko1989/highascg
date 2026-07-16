# WO-232 — Mario game as a transparent-background HTML producer, puppeteer-controlled (CEF interactive bridge)

**Status:** Planned | **Date:** 2026-07-15

**STATUS ADDENDUM (2026-07-16, WO-257):** The CEF interactive bridge this WO's input path (T232.3)
depended on has been **removed entirely** — repeated production incidents (`warmInFlight`
crash-loop, `zoneTargets` connect-rejection, needle-matching poisoning) made it too fragile to
keep. `template/mario` (and `template/cef_input_test.html`) **still play** as normal `[HTML]`
producers with a transparent background — the T232.1/T232.2 vendoring + transparency-patch work
below is entirely unaffected — but they no longer receive keyboard/mouse input: T232.3's
"Interactive input" arm/release path (`POST /api/cef/arm-input`, `src/api/routes-cef-arm-input.js`,
`smoke-wo232-arm-input.test.js`, the inspector arm/release toggle) is deleted, and
`cef-interactive-cdp.js`/`cef-interactive-bridge-events.js` cited under T232.3 below no longer
exist. See [work/work-orders/257_WO_REMOVE_CEF_INTERACTIVE.md](257_WO_REMOVE_CEF_INTERACTIVE.md)
and [docs/reference/cef-interactive-bridge.md](../../docs/reference/cef-interactive-bridge.md).

**Source:** owner todos15.07.26 ***mario-game***: "id like to be able to add a mario game via an html producer but with transparent background instead of the sky. controlled via pupeteer the same as before." Candidate sources given: github.com/tylerreichle/mario_js, codepen.io/yananas/pen/xrjaGX, github.com/reruns/mario (JS), github.com/axonyxquantum/desktop_mario (python — NOT usable in an html producer; ignore).

## Design
- "Same as before" = the existing **CEF interactive bridge** (src/system/cef-interactive-cdp.js / cef-interactive-forward.js / bridge-events — puppeteer 25.x already a dependency; `template/cef_input_test.html` is the prior art). The game runs as a Caspar `[html]` producer pointed at a locally served page; input is forwarded via the CDP bridge exactly like the existing interactive templates.
- **Vendor the game locally** (offline/CSP box): clone one of the JS candidates (prefer `reruns/mario` or `tylerreichle/mario_js` — pick whichever is a self-contained canvas game with no build step / no CDN deps; document the choice + license) into `template/mario/` with all assets local.
- **Transparent background:** patch the game's renderer — remove the sky fill (canvas `fillRect` of the background color / sky sprite layer) and create the canvas context with alpha; `html,body{background:transparent}`. The parts of the scene that must remain (ground, pipes, sprites) keep rendering. Document exactly which draw calls were patched.
- **Layer/lifecycle:** playable as a normal browser/template source in a look (browserAsCg or template source — follow how CasparCG-Guide templates/cef_input_test are added); no server-side lifecycle changes needed.

## Tasks
- [x] T232.1 Fetch + vendor the chosen game into template/mario/ (self-contained; note license + upstream commit).
- [x] T232.2 Transparency patch (sky removal + alpha context + transparent body); verify with a local headless screenshot (puppeteer is available — render the page offscreen and check corner pixels have alpha 0).
- [x] T232.3 Input: verify keyboard reaches the game via the CEF interactive bridge path used by cef_input_test.html (read those modules; document the AMCP/setup steps an operator needs, e.g. which layer + how the bridge attaches).
- [x] T232.4 Sources/UX: make it appear like other templates (it lands in the template catalog automatically if template-dir scanned — verify; else add a note).
- [x] T232.5 Smoke: page exists + contains the transparency patch markers; puppeteer screenshot alpha test where feasible offline (mark honestly if headless env lacks a display — use --headless with swiftshader flags; skip with note if impossible).
- [ ] A232.1 owner check: Mario on air over video, transparent sky, playable via the bridge. **Not checked by this pass — needs an operator to actually PLAY it on a live channel over video and confirm on a real broadcast monitor/output; this WO only verified the page offline (headless screenshot) and read the bridge code (did not run a live PLAY against casparcg-server).**

## Implementation notes (this pass)

### T232.1 — source chosen
Both candidates from the owner's todo were cloned and inspected (`codepen.io/yananas/pen/xrjaGX` was not fetched — a CodePen pen isn't a vendorable git source and the WO already named two GitHub JS candidates to choose between; `axonyxquantum/desktop_mario` is Python, explicitly out of scope per the WO).

- **github.com/reruns/mario** — chosen. Plain `<script>` tags loading ~24 flat JS files, canvas 2D, zero build step, zero CDN/network references anywhere in the source (only a couple of dead `http://` links to the author's personal site/LinkedIn in the footer, and one `http://stackoverflow.com/...` URL inside a code comment — both removed during vendoring). MIT license, © 2017 Garrett Johnson. Upstream commit: `08074829a16830051143339ea05b5082a5c43b2f` (2017-05-16, "Create LICENSE", the tip of the `--depth 1` clone).
- **github.com/tylerreichle/mario_js** — rejected. Requires a webpack build (`assets/javascripts/bundle.js` is a build artifact, `webpack.config.js`/`package.json` present), loads jQuery from a bundle, and `index.html` pulls Google Fonts (`fonts.googleapis.com`) and Google Analytics (`google-analytics.com`) from CDNs at load time — disqualified on both "no build step" and "no CDN deps".

License file vendored at `template/mario/LICENSE` (MIT).

### Size budget
Vendored tree is **1.2MB** (50 files), under the ~2MB budget. To get there:
- Dropped `sprites/1-1 reference.png` (44KB) — a demo/screenshot image, not used by the game at runtime.
- Dropped the upstream footer's dead outbound links (garrettjohnson.net / linkedin.com / github.com) from `index.html` — not needed on an on-air page, and kept the offline "no http(s):// in game files" smoke check honest.
- Replaced the two background-music tracks (`sounds/aboveground_bgm.ogg` 2.4MB, `sounds/underground_bgm.ogg` 363KB — together over the entire size budget by themselves) with 1-second silent placeholder `.ogg` files generated locally via `ffmpeg -f lavfi -i anullsrc ...` (2.7KB each). This keeps `js/game.js`/`js/player.js`/`js/flag.js`/`js/levels/*.js`'s existing `new Audio(...)/.play()/.pause()` calls working without any code changes, while cutting ~2.75MB. All *sound-effect* `.wav` files (jump, coin, stomp, pipe, etc. — 14 files, ~680KB total) were kept as-is. This is a deliberate engineering trade-off beyond the literal "strip demo/screenshot cruft" instruction — called out here for an honest record. If background music is wanted on air later, the two `.ogg` files can be replaced with real tracks (own budget headroom permitting) with no code changes.

### T232.2 — transparency patch
Every changed line is tagged `WO-232` in-source. Patched files:
- `template/mario/js/game.js`:
  - `getContext('2d')` → `getContext('2d', { alpha: true })` (explicit; matches browser default, states intent).
  - Removed the sky fill: was `ctx.fillStyle = level.background; ctx.fillRect(0, 0, canvas.width, canvas.height);` right after `ctx.clearRect(...)` in `render()`. This is the *only* full-canvas fill/clear call in the whole game (verified — grepped all of `js/**/*.js` for `fillRect`/`fillStyle`/`clearRect`; nothing else touches the whole canvas). `ctx.clearRect(...)` was already present and unchanged — it clears to transparent (not opaque), which is exactly what's wanted, so it's commented but not altered.
- `template/mario/css/game.css`:
  - Removed `canvas { background-color: blue; }`.
  - Added `html, body { background: transparent !important; }`.
- `template/mario/index.html`: no CSS/behavior change, just a provenance/patch-summary comment in `<head>`.

Ground/hill/cloud/bush/pipe/player sprites are untouched and still draw normally (they're all `drawImage` sprite blits in `sprite.js`/entity render methods — none of them fill the full canvas, so removing the single sky fill only removes the sky, nothing else).

**Verified visually** — see `/tmp/.../scratchpad/mario-transparent.png` from a manual puppeteer screenshot run: sky is transparent, ground/hill/cloud/bush/Mario render normally. (Scratchpad path is session-local; the automated live test below reproduces this and is the durable check.)

### T232.3 — input via the CEF interactive bridge
Read `src/system/cef-interactive-cdp.js` and `src/system/cef-interactive-bridge-events.js` (did not modify either, per the WO). Relevant facts:
- The bridge maps captured host input (X11 keysyms) to Puppeteer `page.keyboard.down/up/type(...)` calls (`forwardKeyEvent`, `cef-interactive-cdp.js:400`), driven over the same CDP `remote-debugging-port` connection used everywhere else in the bridge — this dispatches real `keydown`/`keyup` DOM events into the CEF page, which bubble to `document` exactly like a physical keyboard.
- `template/mario/js/input.js` (unmodified, upstream) listens on `document.addEventListener('keydown'/'keyup', ...)` — not on a specific focused element — and maps `event.keyCode` to named actions. It does not require the page to have DOM focus/tabindex first (added `<body tabindex="0">` anyway, matching `cef_input_test.html`'s pattern, as harmless extra safety).
- Keys the game actually reads (from `js/input.js` + `js/game.js:handleInput`): **Left/Right arrows = move, Down arrow = crouch / enter pipe, X = jump, Z = run / shoot fireball** (Up arrow and Space are captured by `input.js` but not consumed by `handleInput`, so they're no-ops in this level). All of these map cleanly through `cef-interactive-cdp.js`'s X11-keysym table (`ArrowLeft`/`ArrowRight`/`ArrowUp`/`ArrowDown` keysyms are explicitly mapped; `X`/`Z` fall through the printable-character path via `page.keyboard.type`).
- Operator setup is identical to `cef_input_test.html`: `PLAY <ch>-<layer> [HTML] mario`, `MIXER <ch>-<layer> FILL 0 0 1 1`, then attach/focus the interactive zone to that layer through whatever mechanism routes host input to CEF for other interactive templates in this repo (zone/host-focus registry — unchanged, not part of this WO). No AMCP beyond the normal PLAY/MIXER used for any HTML producer.
- Not independently re-verified against a live `casparcg-server` process in this pass (no service restarts per the rules) — this is a code-reading confirmation, consistent with how `cef_input_test.html` already proves the same bridge path works for keyboard.

### T232.4 — template catalog
`template/mario/index.html` sits alongside the repo's other `template/*.html` producer pages (`cef_input_test.html`, `interactive_click_test.html`, etc.) with no separate registration step in this repo — same as those. No further action needed; not independently re-verified against the live template-scan UI in this pass.

### T232.5 / verification
Two smoke tests were added:
1. **`tools/smoke/smoke-wo232-mario-static.test.js`** — offline, added to `tools/ci/run-offline-tests.js`'s curated `FILES` list. Checks: entry page exists, WO-232 patch markers present in `game.js`/`game.css`, the old sky `fillStyle`/`fillRect` call is gone from active (non-comment) code, `getContext('2d', {alpha:true})` present, `html,body{background:transparent!important}` present, **no vendored file contains an `http(s)://` reference**, total vendor size ≤ 2MB, LICENSE present. **8/8 passing.**
2. **`tools/smoke/smoke-wo232-mario-transparent.live.test.js`** — real headless-Chrome puppeteer test (deliberately named `.live.test.js` so it's excluded from the offline gate). Launches `puppeteer` (bundled Chromium, a direct dependency — `package.json`), navigates to `file://.../template/mario/index.html`, waits 2s, screenshots with `omitBackground:true`, and decodes the PNG via `pngjs` (also a direct dependency) to check raw alpha — chosen over in-page `canvas.getImageData()` because loading local sprite images over `file://` taints the canvas (`SecurityError` on `getImageData`), which this test hit and worked around; the compositor screenshot itself is unaffected by that taint.
   - **Ran manually in this environment and it passed**: top-left 10×10 region alpha sum = 0 (fully transparent), a lower ground/scenery band alpha sum = 1,845,017 (clearly opaque content present). No unexpected `pageerror`s (one benign, expected Chrome-autoplay-policy `NotAllowedError` from the music `Audio.play()` call is explicitly tolerated — it fires on the unmodified upstream game too and is unrelated to the WO-232 transparency patch).
   - This is a genuine positive result, not a fallback — headless Chrome launches fine here with `--no-sandbox --disable-gpu --disable-dev-shm-usage`.

Full curated offline gate (`node tools/ci/run-offline-tests.js`) re-run after these changes: 233 passed / 0 failed / 2 pre-existing skips (unrelated, `CI=1`-gated integration tests). `npx eslint .` — 0 errors (previously-existing warn-level warnings only; `template/**` is already globally ignored by `eslint.config.js`, so the vendored game code was never linted — no config change needed, confirmed by running `eslint --no-warn-ignored template/mario` and seeing the ignore-pattern message).

### File count / sizes
`template/mario/`: 50 files, 1.2MB total (LICENSE, index.html, css/game.css, 24 js/*.js + 3 js/levels/*.js, 6 sprites/*.png, 14 sounds/*.wav + 2 sounds/*.ogg [silent placeholders, see above]).
New/modified repo files: `tools/smoke/smoke-wo232-mario-static.test.js` (new), `tools/smoke/smoke-wo232-mario-transparent.live.test.js` (new), `tools/ci/run-offline-tests.js` (added one line to `FILES`).

## Follow-up T232.6 (owner: "controls doesnt work")
Root cause: input forwards only to the current CEF focus target (src/system/cef-focus-registry.js — set via the live-webpage host / operator-fullscreen flow), and a raw template drop never arms it. Interim workflow documented (webpage-host source at http://127.0.0.1:4200/template/mario/index.html + its focus control).
- [x] T232.6 Operator-facing "Arm input" toggle: implemented as an inspector group for browser/template sources matching /mario|cef_input_test/i. Operator clicks the toggle in the layer inspector to arm/release input forwarding without the full live-webpage workflow.

### T232.6 Implementation notes

**Server-side (routes-cef-arm-input.js):**
- POST `/api/cef/arm-input {channel, layer, needle}` — validates parameters, calls `setCefFocusTarget({sourceId: 'layer:${channel}-${layer}', hostChannel, hostLayer, needle, zoneId:'layer'})`, notifies listeners, broadcasts 'cefFocusTarget' change.
- POST `/api/cef/release-input` — calls `clearCefFocusTarget()`, notifies listeners, broadcasts null.
- Both routes registered in `src/api/router.js` with `requireCaspar: false` for offline operator use.

**Client-side (inspector-interactive-input.js + inspector-scene-layer.js):**
- New component `appendInteractiveInputGroup()` checks source value via `isInteractiveSource()` regex (/mario|cef_input_test/i).
- Single "Arm Input" / "Release Input" toggle button.
- Posts to endpoints with `channel` and `layer` from the scene context, `needle` from source match.
- Integrated into `inspector-scene-layer.js` after countdown group (line 205).

**Smoke tests (smoke-wo232-arm-input.test.js):**
- 11/11 tests passing: route registration checks, arm/release handler behavior, parameter validation, inspector component existence and integration.
- Added to curated offline gate (tools/ci/run-offline-tests.js).

**Files changed:**
- **New:** `src/api/routes-cef-arm-input.js` (~100 lines, handler logic)
- **New:** `client/components/inspector-interactive-input.js` (~115 lines, UI component)
- **New:** `tools/smoke/smoke-wo232-arm-input.test.js` (~270 lines, test coverage)
- **Modified:** `src/api/router.js` (import + 2 route registrations)
- **Modified:** `client/components/inspector-scene-layer.js` (import + 1 function call)
- **Modified:** `tools/ci/run-offline-tests.js` (1 test file added to FILES array)

Full gate pass: 244 passed / 0 failed / 2 pre-existing skips (unrelated). `npx eslint --quiet` 0 errors. `node --check` all touched files.

## T232.7 — template tick for webpage sources

Owner usability request: "when adding a web-browser source, only offering a URL box; want a Template tick to pick a local template instead of typing a URL."

**Implementation:** Added a "Template" checkbox in BOTH places where the URL input appears:
1. **Live-input modal (creation form)** — `client/components/live-input-modal-shell.js` + `live-input-modal-submit.js`
2. **Webpage-host inspector (edit form)** — `client/components/inspector-webpage-host.js`

When the Template checkbox is ticked:
- URL input is hidden; a `<select>` dropdown is shown with template names from `stateStore.getState()?.templates || []` (same catalog as sources-panel-templates.js reads).
- Template names appear as options: `countdown/countdown`, `mario/index`, etc. (the `id` field from the template object).
- On selection, the effective URL becomes `http://127.0.0.1:4200/template/<name>.html` (server serves `/template/` → `/templates/` via `src/server/http-server.js` lines 79–97).
- Names already ending in `.html` are NOT doubled (e.g., `mario/index.html` → URL stays `http://127.0.0.1:4200/template/mario/index.html`, not `/template/mario/index.html.html`).
- The stored value (playArg / templateOrUrl) is always the full URL, so downstream CEF needle matching and WO-232 arm-input see a normal URL.
- When the template URL prefix is detected on load (`http://127.0.0.1:4200/template/`), the UI initializes with the Template checkbox ON and the matching template preset in the select.

**Files modified:**
- **`client/components/live-input-modal-shell.js`** — added Template checkbox + select elements to browserWrap, returned in elements dict
- **`client/components/live-input-modal-submit.js`** — handle template checkbox state when submit button is clicked; build the URL from selected template
- **`client/components/inspector-webpage-host.js`** — added Template checkbox + select to the Page section; bind to sync with URL input; detect and initialize from existing template URLs

**Smoke tests:**
- New file `tools/smoke/smoke-wo232-template-tick.test.js` with source-grep assertions and unit-level checks:
  - Template checkbox + select present in both modal shell and inspector
  - Template URL prefix construction (`http://127.0.0.1:4200/template/`) from template names
  - `.html` suffix deduplication (names ending in .html don't get doubled)
  - When template URL prefix is detected on load, checkbox initializes to ON
- Added to `tools/ci/run-offline-tests.js` FILES list.

Full offline gate after implementation: **271 passed / 0 failed / 2 pre-existing skips** (unrelated). `npx eslint --quiet` 0 errors. `node --check` all touched files.
