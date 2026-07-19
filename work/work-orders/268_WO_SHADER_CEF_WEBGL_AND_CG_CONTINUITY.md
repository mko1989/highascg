# WO-268 — Shader templates crash in Caspar CEF (no WebGL2) + stray CG UPDATE 403

**Status:** Implemented (owner acceptance A268.1 pending — needs config regen + caspar restart)
**Priority:** HIGH (owner report 2026-07-18, todos18.07.26 — "something wrong with playing the saved shader")

## Symptoms (owner log 12:41)
1. `html[file:///…/template/shaders/sh-test.html] … Uncaught TypeError: Cannot read properties of null (reading 'getExtension')` then `Uncaught ReferenceError: update is not defined`.
2. Before that: `CG 1-700 UPDATE 0 {}` → `403 CG UPDATE FAILED` (while the ADD/PLAY landed on channel 2 and succeeded).

## Root causes (verified)
1. **No WebGL2 in Caspar's CEF.** The generated config ships `<html><enable-gpu>false</enable-gpu></html>` (`src/config/config-generator.js:113-115`, live `config/casparcg.config:184-185`), so `canvas.getContext('webgl2')` returns null; ShaderToyLite's constructor then calls `gl.getExtension(...)` on null and throws. Because `template/shaders/player.js` defined the Caspar contract (`window.update` etc.) at the END of its IIFE, the throw aborted the script before the contract existed → the follow-up `CG UPDATE` hit `update is not defined`.
2. **Continuity UPDATE trusts the client scene map, not Caspar.** `scene-take-lbg-amcp-pipeline.js:425-447` picks the WO-196 "UPDATE-only" path when the *client-side* current-scene map says the same template is on that layer; it never checks WO-207's tracked-hosts record (`getTrackedTemplateHosts`, `scene-template-cg.js:233`), and that record is not cleared on Caspar reconnect anyway. After a restart (or a never-succeeded ADD) the UPDATE goes to an empty layer → 403.

## Fix
**T268.1 player hardening** (`template/shaders/player.js`): define `window.update/play/stop/next` FIRST (inert-safe: they no-op until the toy exists); probe `getContext('webgl2')` BEFORE constructing ShaderToyLite — on null, log one clear console error (`Shader FX: WebGL2 unavailable (Caspar <html><enable-gpu> is false…)`) and bail gracefully; wrap the whole init in try/catch so no template error can take out the contract functions.
**T268.2 opt-in CEF GPU** (`src/config/config-generator.js`): `<enable-gpu>` sourced from `config.operatorTools.cefEnableGpu` (default **false** — unchanged behavior; flipping historically risks GL-consumer conflicts, so it's an owner decision applied on config regen + caspar restart). Surface the checkbox next to the existing CEF fields in the caspar-config UI if one exists for operatorTools; otherwise config-file only, documented here. NOTE for A268.1: with GPU off there is no WebGL at all in this CEF build — shader templates on the CG path REQUIRE flipping this on (or playing via browser_display, which always works).
**T268.3 honest continuity** (`src/engine/scene-take-lbg-amcp-pipeline.js` + `scene-template-cg.js`): `isContinuous` additionally requires `getTrackedTemplateHosts(channel).has(resolveTemplateCgHostLayer(...))` — only layers THIS session actually ADDed count; export `clearAllTrackedTemplateHosts()` and call it on Caspar (re)connect (`routing-setup.js`, near the existing reconnect work) so records can't outlive a restart.
**T268.4 smokes** (`tools/smoke/smoke-wo268-shader-cef-continuity.test.js`, curated gate): player source asserts (contract-before-GL, null-probe branch, try/catch); generator XML with/without `cefEnableGpu`; tracked-hosts gate (untracked → full ADD lines chosen; tracked → update-only) with the pipeline's decision extracted or exercised via the exported helpers; clear-on-reconnect wiring assert.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, curated gate ONLY, `node --check` + repo eslint, <500 lines/file, tabs + JSDoc, honest checkboxes. Generator change is behavior-neutral until the owner opts in.

- [x] T268.1 player: contract-first + WebGL2 probe + graceful bail
- [x] T268.2 generator: operatorTools.cefEnableGpu (default false) + operatorTools passthrough fix
- [x] T268.3 continuity gated on tracked hosts + clear on reconnect + record-on-ADD (missing WO-207 wiring)
- [x] T268.4 smokes in curated gate
- [ ] A268.1 (owner) live: set `operatorTools.cefEnableGpu: true` in general.json, regen config, restart caspar → sh-test renders on the CG path; with it false, the template no longer throws (black layer + one console error, CG UPDATE succeeds); take after caspar restart re-ADDs templates instead of 403ing

## Work log

**2026-07-18 — implemented. Two significant finds beyond the plan:**
- **`operatorTools` never reached the generator.** `buildCasparGeneratorFlatConfig` didn't copy it, so the EXISTING `cefInteractiveBridge`/`cefRemoteDebuggingPort` reads in `config-generator.js` always saw `{}` and used fallbacks (harmless on this box — fallback and config agree on bridge-on/9222 — but config was silently ignored). Passthrough added; behavior-neutral for the live config (verified `config/general.json`).
- **WO-207's `recordTemplateHostAdded` was documented but never called anywhere.** The tracked-hosts map was permanently empty, which also means the teardown read at `scene-take-lbg-teardown.js:145` has been iterating an empty set since WO-207. Now recorded after every full ADD emit in the pipeline. (Teardown behavior therefore changes too — it can now actually see tracked hosts; watch A268.1 for surprises there.)

Details:
- T268.1 `template/shaders/player.js`: contract (`window.update/play/stop/next`) installed first against a `toyRef` that stays null until init succeeds; single `getContext('webgl2', ...)` call doubles as alpha-claim and probe (`if (!gl)` → one console error naming the enable-gpu fix + browser_display alternative, graceful bail); `start()` failure caught. The already-exported `sh-test.html` needs no regen — it loads `player.js` fresh.
- T268.2 `<enable-gpu>` from `operatorTools.cefEnableGpu` (strict `true`/'true' only), default false. No UI field added — config-file opt-in for now (the caspar-config regen+restart flow is owner-driven anyway).
- T268.3 `isContinuous` now ALSO requires `getTrackedTemplateHosts(channel).has(resolveTemplateCgHostLayer(...))`; `clearAllTrackedTemplateHosts()` (new export) called at the top of `setupAllRouting` (runs on boot + every Caspar reconnect via onAfterInfoConfigReady). Net effect: first take after any (re)connect always full-ADDs; continuity UPDATEs only ever target layers this connection actually ADDed.
- T268.4 `tools/smoke/smoke-wo268-shader-cef-continuity.test.js` (7 tests: contract-before-toy + probe/bail asserts, flat-config passthrough, enable-gpu default/opt-in/garbage-input XML, tracked-host lifecycle, pipeline gate + record wiring, routing-setup clear) in the curated gate.
- Gate after WO-267/268/269: 603 tests / 94 suites, 601 pass, 0 fail, 2 pre-existing skips; eslint + node --check + py_compile clean on touched files.

**2026-07-18 (later) — live follow-up + UI affordance (owner: "still the shader doesnt appear" / "add the tick box … in the device view"):**
- Caspar log 13:10-13:11 confirms the T268.1 guard fires correctly (single clear "WebGL2 unavailable" line per ADD, no more contract ReferenceErrors) — the flag simply hadn't been applied. `"cefEnableGpu": true` is now SET in `config/general.json`; the highascg service restart + `POST /api/caspar-config/apply` (Caspar restart) remain for the owner — this session's agent is permission-blocked from service ops. Verified the generator emits `<enable-gpu>true</enable-gpu>` for the live config (smoke made live-value-independent).
- "Enable GPU in CEF templates (WebGL / Shader FX)" checkbox added to the Device View **server inspector** (`device-view-inspector-caspar.js`, new "Templates (CEF)" section) — saves `operatorTools.cefEnableGpu` via settings patch, marks Caspar restart dirty, hints the apply+restart requirement.
- `settings-post.js` operatorTools handling further tightened: only keys PRESENT in the patch are applied (a partial `{cefEnableGpu}` patch can no longer reset `pointerConfineMultiview`). Related client-side hardcode removed under WO-270.
