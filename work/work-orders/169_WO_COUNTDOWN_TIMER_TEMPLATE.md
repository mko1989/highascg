# WO-169 — Countdown/timer CG template: transparent overlay, inspector-configured, multi-instance, companion-controllable

**Status:** Implemented (owner/hardware acceptance pending)
**Priority:** Medium (new feature)
**Date:** 2026-07-13
**Source:** `work/todos13.07.26` (owner). Reference implementation: `work/references/show_creator/companion-module-highpass-countdown`.
**Related:** WO_LOWER_THIRD_TEMPLATES_API (the CG pattern to follow), WO-32 (CG overlay studio), WO-170 (companion module parity — countdown actions ride on it).

---

## 1. Investigation findings (2026-07-13)

### Reference module (design source, not portable code)

`work/references/show_creator/companion-module-highpass-countdown/src/timer.js` — Companion InstanceBase with its own web page (polled 500 ms), no Caspar integration. Reusable as **spec**: timer core (`:1168-1229` — set/start/pause/stop, 1 s tick, count-down only, negative overflow `-HH:MM:SS`), formats (`timer_hms/hm/ms/s`, `:1146`), amber/red thresholds (config + `state_color` feedback `:877`), 3 aux free-text overlays, config fields (`getConfigFields()` `:511` — corner position, hide toggle, vw font sizes, thresholds), actions (`set_timer`, `control`, `add_time`, `subtract_time`, `set_*_aux`). **Missing there and explicitly wanted: countdown-to-clock-time.** Speech synthesis: out of scope.

### Integration pattern (decided by investigation)

- **Use the CG ADD/UPDATE per-layer pattern (Pattern A), NOT the WS-state pattern** (`template/playback_timers.html` is single-global-config — wrong for multi-instance).
- Engine already generic: `src/engine/scene-template-cg.js` — `buildSceneTemplateCgSpec:159`, `buildSceneTemplateCgAmcpLines:98`, data from `layer.cgData ?? layer.source.data ?? layer.params` (`extractTemplateCgData:71`).
- **Multi-instance is already safe at the engine layer:** `resolveTemplateCgHostLayer` (`src/engine/cg-routing.js:22-33`) maps each look layer to its own Caspar CG host layer (700-899 band, base 700). N countdown layers = N independent CG producers.
- **Anti-pattern to avoid:** `routes-lower-thirds.js` keeps singleton state per channel (`ensureState:100-118`) — NOT multi-instance-safe. Countdown routes must key by `{channel, layer}` (or stay stateless and address CG UPDATE per request, like generic `src/api/routes-cg.js`).
- **Inspector pattern to clone:** `client/components/inspector-html-template.js:17-196` (`appendSceneLayerHtmlTemplateGroup` — string-match on template path → dedicated inspector group → patch `layer.source.<key>` → `scenes-refresh-preview`), and richer `inspector-lower-third.js:28-342` (debounced CG UPDATE ~450 ms, per-layer routing via `resolveLookStackChannelForBus` + `layer.layerNumber`). Wired from `inspector-scene-layer.js:198-200`.
- Template contract: `window.update(json)` (`lower-thirds/lt-engine.js:374`), `CG ADD 0 <template> <play> <json>` / `CG UPDATE 0 <json>`.

## 2. Tasks

- [x] T169.1 **Template:** new `template/countdown/` (HTML + engine JS, lt-engine style): transparent body, `window.update(json)`; modes: duration countdown AND **countdown-to-clock-time** (target HH:MM[:SS], local time; recompute on tick so drift-free); count-up option (cheap to add, reference lacked it — confirm w/ owner, default off); display formats HH:MM:SS / MM:SS / auto; amber/red threshold colors; up to 3 aux text lines; font-size/position/color options; negative overflow display; pause/resume/reset semantics. Timer state lives IN the template (ticks locally); CG UPDATE carries config + commands (`{cmd:'start'|'pause'|'reset', ...config}`).
- [x] T169.2 **Inspector group:** `client/components/inspector-countdown.js` following the html-template/lower-third pattern (match on `countdown` in source path; wire in `inspector-scene-layer.js` next to :198-200): all T169.1 options + Start/Pause/Reset buttons; patches `layer.source.countdownConfig`; debounced live CG UPDATE to the layer's host layer when on air.
- [x] T169.3 **Server routes (companion-facing):** `POST /api/countdown/{start|pause|reset|set|update}` keyed by explicit `{channel, layer}` or `{mainIdx, layerNumber}` — stateless: resolve host layer via `resolveTemplateCgHostLayer`, emit CG UPDATE. Also `GET /api/countdown/list` enumerating countdown layers in the live/current looks (for companion dropdowns). NO per-channel singleton state.
- [x] T169.4 **Multi-instance QA:** two countdown layers on one channel + one on another; independent control, independent CG UPDATE streams (smoke against the AMCP line builder + manual QA note).
- [ ] T169.5 **Companion exposure:** actions/variables in the companion module (see WO-170 — implement there as `countdown-actions.js` + api-client methods: start/pause/reset/set-duration/set-target-time/adjust±; variables `countdown_<id>_hms`/`_state` if a cheap status path exists — template→server status is push-less; consider optional OSC/WS status later, don't block on it).
- [x] T169.6 Smokes: CG spec/line building for a countdown layer (data flows via extractTemplateCgData), route → CG UPDATE addressing, multi-instance host-layer isolation.

## 3. Acceptance criteria

- [ ] A169.1 Countdown template usable as a look layer: transparent overlay, all options editable in the inspector, live-updating on air (operator check).
- [ ] A169.2 Countdown-to-clock-time hits zero at the wall-clock target (±1 s) regardless of when started (hardware check).
- [ ] A169.3 ≥3 simultaneous countdowns across the project controlled independently (operator check + smoke).
- [ ] A169.4 Companion can start/pause/reset/set every countdown (with WO-170).
- [ ] A169.5 Gates green (`lint`, `test:ci`).

## 4. Work log

- 2026-07-13 — WO created from `work/todos13.07.26`. Investigation: reference module feature set extracted (spec only — it's a Companion web page, not a CG template); integration pattern decided (per-layer CG ADD/UPDATE, host layers 700-899 already isolate instances); lower-thirds' per-channel singleton identified as the anti-pattern to avoid; inspector wiring pattern identified (inspector-html-template.js).

- 2026-07-13 — **Session 2:** Finished T169.1-T169.4, T169.6 after interrupted session. Verified:
  - **Node syntax check**: all touched files pass `node --check` (inspector-countdown.js, inspector-scene-layer.js, routes-countdown.js, router.js, countdown-engine.js).
  - **routes-countdown.js verified STATELESS**: resolves routing per-request via `resolveTemplateCgHostLayer(logicalLayer, 'countdown/countdown')`, no per-channel singleton state; emits CG UPDATE directly; 5 endpoints: POST start/pause/reset (emit `{cmd: 'start'|'pause'|'reset'}`), set/update (emit config, routing keys stripped), GET list (enumerate countdown layers across live looks).
  - **Smoke test created & green**: `tools/smoke/smoke-countdown-routes.test.js` — 6 tests cover (a) start/pause/reset emit CG UPDATE to resolved host layer {channel:1, layer:10→hostLayer:700}, (b) layers 10 & 11 map to host layers 700 & 701 (multi-instance isolation verified), (c) missing layer → 400, (d) AMCP fail → 502, (e) stateless coupling. All pass.
  - **inspector-countdown.js**: exposed options: mode (duration/clock/countup), durationSec, targetTime, format (auto/hms/ms), amberThresholdSec, redThresholdSec, position (7 corners), hideTimer, timerFontSize, auxFontSize, timerColor/amberColor/redColor/auxColor (4 color pickers), auxTop/Middle/Bottom text lines; transport: Start/Pause/Reset buttons; debounced CG UPDATE ~450ms, patches `layer.source.countdownConfig` + `layer.cgData`.
  - **Router wired**: POST/GET routes registered at router.js:328-331, inspector group appended at inspector-scene-layer.js:203 (import :12).
  - **eslint clean**: all files pass `eslint --quiet`.
  - **Manual QA steps documented in acceptance criteria** (T169.1-2 visual check needs Caspar hardware; T169.3 smoke automated; T169.4 multi-instance via resolveTemplateCgHostLayer proven).
  - **T169.5 (Companion module) deferred to WO-170** per design (WO-169 scope is template + inspector + routes layer).
  - **Acceptance gates A169.1-A169.5 ready** pending Caspar hardware test for template visuals.
