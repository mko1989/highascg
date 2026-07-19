# WO-266 — Shader FX: Shadertoy-style shaders on the Caspar output with audio reactivity

**Status:** Implemented (owner acceptance A266.1 pending — GL rendering + audio capture cannot be exercised offline)
**Priority:** MEDIUM-HIGH (owner request 2026-07-18, todos18.07.26)
**Depends on:** WO-258/260 (browser_display real-Firefox source — the audio-capable playback path), WO-23/240 (webpage/template play paths), WO-53 (per-input audio meters / OSC levels)

## Owner intent (todos18.07.26)
"implement additional shader tool that will let users add shaders and display them (web browser source) on the caspar output with audio reactivity. there was a project that could load shaders straight from shadertoy but i cant find it now. audio analyzer js: https://github.com/hvianna/audioMotion-analyzer"

## Research (2026-07-18, web agent)
- **The lost project is almost certainly [ShaderToyLite.js](https://github.com/chipweinberger/ShaderToyLite.js)** — ~400-line vanilla-JS single file, paste Shadertoy code directly (no API key, no network), **multi-pass (BufferA-D) support**, BSD-3-Clause. Best offline fit. Runner-up: [shadertoy-package](https://github.com/reindernijhoff/shadertoy-package) (MIT, JSON renderpass format). shadertoy-react: single-pass only, React dep — rejected. None of the loaders do audio.
- The official Shadertoy API needs a per-user key + rate limits ⇒ **paste-code workflow, not ID-fetch**, matches the offline box.
- **audioMotion-analyzer is AGPL-3.0** (verify at vendor time). For feeding a shader we do not need it: a raw Web Audio `AnalyserNode` produces the FFT + waveform arrays that Shadertoy's audio iChannel expects (512×2 texture: row 0 = frequency, row 1 = waveform) with zero dependencies and no license question. audioMotion-analyzer stays an OPTION for a future standalone visualizer template only, behind owner license sign-off.

## Ground truth (verified 2026-07-18, agent sweep)
- Play paths for a URL on the output: `PLAY <ch>-<layer> [HTML] <url> LOOP` composed by `src/config/host-live-sources.js:143-157,351` (webpage_host / browser_display extraLiveSources, set up via `host-live-sources-setup.js:14-92`); template path via `CG ADD` (`src/engine/scene-template-cg.js:119`, overlay band 700-899 `src/engine/cg-routing.js:23-35`).
- `browser_display` (WO-258, server committed; client UI WO-260) = real Firefox on the box captured into Caspar — the ONLY path where `getUserMedia` genuinely works; Caspar's CEF html producer has no media-stream flag in our config generator today.
- Templates are served same-origin by the playout server: `/templates/*` → `template/` (`src/server/http-server.js:79-97`, port 4200) — a template page can fetch/WS the :4200 API with no CORS.
- **No audio analysis exists anywhere in the repo** (sweep: no AudioContext/analyser/FFT). What exists: OSC per-channel dBFS meter state (WO-53; `src/audio/meter-health.js` watchdog) — coarse level data already flowing server-side.
- No `vendor/shaders` tree yet; `vendor/` exists at repo root; ISO/offline constraint means vendored single files, not npm deps.

## Design

**Two-tier audio reactivity (both ship, auto-selected):**
- **Tier A — real spectrum (browser_display path):** the shader page runs in the WO-258 Firefox, opens `getUserMedia` against the configured ALSA monitor/loopback device, drives an `AnalyserNode`, and uploads the Shadertoy-style 512×2 audio texture every frame. True FFT reactivity, zero new deps.
- **Tier B — coarse levels (CEF template path):** when `getUserMedia` is unavailable (Caspar CEF), the page subscribes over same-origin WS to the server's existing OSC channel levels and synthesizes a flat "spectrum" from dBFS (bass=level heuristic). Degraded but functional; requires a small server WS broadcast of the meter state it already holds.

**T266.0 — vendor the renderer**
`vendor/shadertoy/ShaderToyLite.js` (BSD-3, single file; record upstream commit hash + license file). NO npm. If the box has no network, file lands via the owner's usual USB/vendor drop — task notes the exact upstream URL. Confirm its texture API supports a caller-updated iChannel texture (README claims custom textures; if not, patch locally — it's 400 lines, record the diff).

**T266.1 — shader library (server)**
- Storage: `data/shaders/<id>.json` — `{ id, name, common, image, bufferA..D, audio: { enabled, channel: 'A'|'B'|'C'|'D'|null }, opts: { alpha: boolean } }` (paste-code fields mirror Shadertoy tabs).
- API `/api/shaders`: GET list, GET one, POST create/update (id slugified name), DELETE. House route style (`src/api/routes-*.js`, registered in `router.js`); atomic writes per WO-161 conventions.

**T266.2 — player page**
`template/shaders/player.html` (+ `player.js`, `<500` lines) served at `/templates/shaders/player.html?id=<id>`:
- Loads vendored ShaderToyLite, fetches `/api/shaders/<id>`, wires Common/Image/BufferA-D, fullscreen canvas sized to `window.inner*`, `requestAnimationFrame` loop.
- Audio: try Tier A (`getUserMedia({audio: {deviceId}})`, device from `?audioDev=` param or default monitor); on failure fall back to Tier B WS levels; on failure run non-reactive. Builds the 512×2 `Uint8Array` texture (row0 FFT, row1 time-domain) into the shader's designated audio iChannel.
- Caspar template contract: `window.update(json)` accepts `{ id }` to hot-swap shaders; transparent body when `opts.alpha`.

**T266.3 — server WS level feed (Tier B)**
Broadcast the OSC meter snapshot (throttled ~15 Hz, only while ≥1 shader-player WS client is subscribed) on a `shaderfx:levels` WS namespace. Read the existing meter state source (WO-53 machinery) — reuse, don't re-listen to OSC.

**T266.4 — client UI: Shaders panel**
Minimal v1 in the Sources side (mirror an existing panel, e.g. templates list):
- List library shaders; Add/Edit modal with paste boxes (Common/Image/BufferA-D), name, audio on/off + channel, alpha.
- Live preview iframe of the player page inside the modal (operator GUI: preview rect NOT reported — it's a DOM iframe, not a video hole; nothing to shape).
- "Play on output": creates/plays via the EXISTING paths — button choices "As browser source (audio-reactive)" → create/point a `browser_display` extraLiveSource at the player URL (WO-260 UI/API, READ handler for exact body), and "As CG layer (no mic)" → `PLAY [HTML]`/CG on the chosen channel-layer per `host-live-sources.js` semantics. No new play plumbing.

**T266.5 — offline smokes** (`tools/smoke/smoke-wo266-shader-fx.test.js`, curated gate)
- Shader JSON round-trip: POST→GET→DELETE against the route handlers with fs in a temp dir (no HTTP).
- Audio-texture builder as a pure function (`client/lib/` or template-side module extracted): FFT/waveform arrays in → 512×2 layout out, silence and clipping cases.
- Player page: static asserts (file exists, references vendored lib relatively, declares `window.update`).
- Tier-B payload shape from the meter snapshot (stubbed state, no OSC).

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, no npm install, no vite build, curated gate ONLY, exact counts. `node --check` + repo eslint on touched files; <500 lines/file; tabs + JSDoc. Vendored files carry upstream URL + commit + license header. AGPL audioMotion-analyzer NOT vendored in this WO (owner sign-off first; AnalyserNode covers the need).

- [x] T266.0 vendor ShaderToyLite.js (+ license/provenance, custom-texture check → local patch)
- [x] T266.1 shader library storage + /api/shaders routes
- [x] T266.2 player runtime with two-tier audio + update() contract (as per-shader exports, see log)
- [x] T266.3 audio levels to the player — satisfied by the EXISTING `type:'osc'` WS broadcast, no new feed (see log)
- [x] T266.4 Shader FX manager: CRUD modal + Templates-tab integration + play via existing paths
- [x] T266.5 smokes in curated gate
- [ ] A266.1 (owner) live: paste a Shadertoy shader in Templates → Shader FX… → save; preview animates in the modal; template appears in Templates after Caspar TLS refresh and drags into a look; play the exported URL as a browser_display source with music on PGM → visuals react to real spectrum; CG/CEF path shows the shader with coarse level reactivity; alpha shader overlays video correctly

## Work log

**2026-07-18 — implemented (all offline tasks). Three deliberate deviations from the plan above, each simpler than designed:**
- **Per-shader export instead of a `?id=` player page.** Discovering that CG Studio's export-to-`template/` pattern makes files appear in Caspar TLS automatically, each save now exports a self-contained `template/shaders/sh-<id>.html` (config JSON inlined, `</script` broken; relative refs to the shared runtime). Result: shaders are ordinary TLS templates — draggable into looks, playable via CG ADD or `PLAY [HTML]` — with ZERO new play plumbing. The parameterized player URL became unnecessary.
- **T266.3 needed no server work.** `src/server/ws-server.js` already broadcasts full OSC snapshots (`type:'osc'`, per-channel `audio.levels[].dBFS` from `src/osc/osc-state.js`) to every WS client; the player just connects and listens (`?ch=` picks the Caspar channel, default 1). No `shaderfx:levels` namespace, no throttle work.
- **UI lives in the Templates tab, not a separate panel.** "Shader FX…" toolbar button in the templates browser opens the manager modal; exported `shaders/sh-*` TLS rows get an FX pill + Edit button (mirrors the CG Studio lower-thirds Edit affordance).

Details:
- T266.0 `vendor/shadertoy/ShaderToyLite.js` (pristine upstream snapshot, commit `11bbc09ac0e78791895e9a022e27cc749d7e27c5`, 2025-05-23) + `vendor/shadertoy/LICENSE` (BSD-3). Working copy `template/shaders/ShaderToyLite.js` carries a provenance header + ONE local patch: upstream `setShader` only binds channels 'A'-'D', so `addTexture()`'d custom keys were unwirable — the patch also accepts any key already registered in `atexture` (ordering contract: `addTexture` before `setImage`/`setBufferX`; the player respects it, smoke asserts it).
- T266.1 `src/shaderfx/shader-store.js` (normalize/validate: `sh-<slug>` ids, per-pass `{source, channels[4]}` with `'A'-'D'|'audio'|null`, image pass required, 256k source cap; atomic writes WO-161 style; save exports, delete removes both files) + `src/shaderfx/shader-template-export.js` (HTML builder) + thin `src/api/routes-shaders.js`, registered in `router.js` with `requireCaspar:false`. Storage `data/shaders/<id>.json`.
- T266.2 `template/shaders/player.js` (plain browser script, no modules — works from file:// CEF and `/templates/shaders/…`): full-window canvas; **alpha via context pre-claim** (ShaderToyLite hardcodes `alpha:false`, but the FIRST `getContext('webgl2')` caller fixes the attributes, so the player claims it with `alpha:true` before constructing the lib — no second patch needed); Shadertoy-style 512×2 R8 audio texture (row0 FFT / row1 waveform) uploaded in `setOnDraw`; tier A `getUserMedia` + AnalyserNode (prefers a `monitor|loopback` device, `?audioDev=` overrides) → tier B WS OSC levels (synthesized rolloff spectrum + level-scaled sine) → tier C silence; Caspar contract `window.play/stop/next/update` (`update({paused})`), autoplay for the no-CG `PLAY [HTML]` path; `?api=` overrides the API base (default same-origin, `http://127.0.0.1:4200` from file://).
- T266.4 `client/components/shader-fx-modal.js` (list + paste-code editor: Common/Image/BufferA-D `<details>` sections, per-pass iChannel0-3 selects, audio/alpha flags, save/delete, live preview iframe of the exported page) + `client/styles/08d-modals-shader-fx.css` + Templates-tab wiring in `sources-panel-templates.js`.
- T266.5 `tools/smoke/smoke-wo266-shader-fx.test.js` (10 tests: normalize matrix, fs round-trip incl. export+cleanup, `</script` escaping, route status codes, provenance/patch/pristine-vendor asserts, player contract + tier tokens + addTexture ordering, client wiring) — in the curated gate after wo265.
- Gate after WO-265+266: **574 tests / 85 suites, 572 pass, 0 fail, 2 skipped** (pre-existing skips). `node --check` + repo eslint clean on all touched files.
- Known limits for A266.1: WO-96 API auth, when enforced, would block the player's fetch/WS (no token plumbing in v1 — flag if you enable auth); tier-B synthesis is deliberately coarse (real FFT = browser_display path); multi-pass buffer self-feedback follows ShaderToyLite's A/B flip semantics — complex Shadertoy imports may still need channel wiring tweaks in the modal.
