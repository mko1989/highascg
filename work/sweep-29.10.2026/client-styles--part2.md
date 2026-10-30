# client/styles — sweep 29.10.2026 (batch 019)

Files: 31 · lines: 6826 · findings: 0 BUG-HIGH, 2 BUG, 14 DEAD, 0 RISK, 14 QUALITY

Method for every DEAD claim: each class name was searched with a word-boundary regex across `client/`, `src/`, `tools/`,
`scripts/` (`.js .mjs .cjs .html`, excluding `client/styles` and the generated `client/assets/map-data.json`), then
re-checked for string-built forms (`` `x__${v}` ``, `'x__' + v`, `${PREFIX}__x` constants). Classes that are built from a
template (`device-view__destination--mode-${mode}`, `map-edge--${type}`, `hardware-reconcile-modal__diff-item--${severity}`,
`shaderfx-status--${cls}`, `${prefix}__bus-meter-*`, previs `${PANEL_CLASS}__*`) were kept as live. Stylesheets are loaded only
via `client/styles.css` (@import graph) and `client/map.html`; the three `previs-*.css` are served by `src/previs/register.js:60`.
Lines are file-relative. None of the DEAD selectors is pinned by a smoke test (`rg` over `tools/smoke` for each name: no hit);
the smokes that read these files pin `.timer-control-panel__timer-row/-timer-input/-timer-display/-time-row/-screen-chip`,
`#logs-modal.modal-overlay`, `#settings-modal.modal-overlay` and the 09b3 inspector-fit rules, none of which are touched below.

## client/styles/07b2-timer-control-panel.css
- `BUG` client/styles/07b2-timer-control-panel.css:132 and :385 — `color: var(--bg)` references a custom property that is defined nowhere (`rg -n -- "--bg\s*:" client` → no hit; the tokens are `--bg-dark/--bg-panel/--bg-elevated`, 01a1-base-theme-tokens.css:19-21). No fallback, so the declaration is invalid at computed-value time and `color` falls back to the inherited light text. Failing case: hover the Save or Cancel button of the timer settings form (`timer-control-panel__settings-btn`, built in timer-control-panel-settings-form.js:260 and :307) → background becomes `var(--accent)` blue with the inherited light text, instead of the intended dark text; same for `.timer-control-panel__btn:hover`. Fix: `var(--bg-dark)`.
- `DEAD` client/styles/07b2-timer-control-panel.css:72-76 `__selector`, :78-93 `__select`, :95-109 `__display`, :111-115 `__buttons`, :141-149 `__hms-label`, :151-154 `__hms`, :156-161 `__preset-row`, :163-192 `__preset-btn`, :342-346 `__settings-row` — no element carries these classes any more (WO-381 removed the old dock controls, see the comment at :308). grep: `rg -n "timer-control-panel__(selector|select|display|buttons|hms|hms-label|preset-row|preset-btn|settings-row)\b" client src tools` → only this CSS; no `` `timer-control-panel__${…}` `` builder exists (`rg -n "timer-control-panel__['\"\`]?\s*(\+|\$\{)" client` → none). ~95 lines.
- `QUALITY` client/styles/07b2-timer-control-panel.css:34,81,251,351 — `var(--bg-3, …)`, `var(--bg-input, var(--bg-2, …))`: none of `--bg-2/--bg-3/--bg-input` exists, so the hard-coded hex fallback is always what renders and the panel ignores the theme tokens. Use `--bg-elevated/--bg-dark`.

## client/styles/07b3-audio-mixer-modal-shell-controls.css
- `DEAD` client/styles/07b3-audio-mixer-modal-shell-controls.css:5-36 `.audio-mixer__routes-wrap`, `__routes-title`, `__routes` (+ th/td/select) and :38-50 `.audio-mixer__apply` — the routing table in the compact mixer is gone. grep: `rg -n "audio-mixer__(routes|apply)" client src tools` → only this file; the `audio-mixer__` prefix is not template-built for these (the JS that uses the prefix writes full names). Remaining rules in the file (live-route buttons, meter states, automix, send-sel) are used.

## client/styles/07c-audio-mixer-view.css
- `OK` (7-line @import aggregator; all four imports resolve and are used.)

## client/styles/07c1-audio-mixer-view-shell-header.css
- `OK`

## client/styles/07c2-audio-mixer-view-console-layout.css
- `OK`

## client/styles/07c3-audio-mixer-view-channel-strip.css
- `OK` — `.audio-mixer-view__bus-meter-*` / `__meter-vertical--bus` look unused by a literal grep but are built as `` `${prefix}__bus-meter-cell` `` in client/lib/audio-mixer-bus-meters.js:40-47,58-60, so they are live.

## client/styles/07c4-audio-mixer-view-matrix-empty-modal.css
- `QUALITY` client/styles/07c4-audio-mixer-view-matrix-empty-modal.css:53-55,98-103 — 9 `!important` (the whole `.live-audio-modal` shell, `.matrix-btn--active`) used to win against `.modal-content` (07b1-modal-shell-base.css:23) and the unlayered settings rules. Works, but a single `.modal-content.live-audio-modal` selector would remove all of them.

## client/styles/08a-modals-logs.css
- `DEAD` client/styles/08a-modals-logs.css:111-122 `.logs-modal__cat-toggle` and `.logs-modal__cat-toggle--open` — the category dropdown button is now `.logs-modal__filter-btn` (:91-110). grep: `rg -n "cat-toggle" client src tools` → only this CSS.
- `QUALITY` client/styles/08a-modals-logs.css:8 — comment cites `07b-audio-mixer-modal-shell.css:441-451` for the opaque panel background; that file has 357 lines and the rule is `.modal-content { background: var(--bg-panel) }` at 07b1-modal-shell-base.css:23. Same stale reference in 08b-modals-settings.css:3.

## client/styles/08b-modals-settings.css
- `QUALITY` client/styles/08b-modals-settings.css:3 — stale pointer `07b-audio-mixer-modal-shell.css:441-451` (file has 357 lines; the rule lives at 07b1-modal-shell-base.css:23).

## client/styles/08c-modals-misc.css
- `BUG` client/styles/08c-modals-misc.css:81-88 — `.led-test-modal__full { display: flex }` defeats the `hidden` attribute. There is no global `[hidden]{display:none}` rule (`grep -n "\[hidden\]" client/styles/*.css` lists only per-class overrides), and `.led-test-modal__full[hidden]` does not exist. The markup is `<div class="led-test-modal__full" id="led-test-char-wrap" hidden>` and `id="led-test-builder-speed-wrap" hidden` (client/components/led-test-modal.js:154,157), toggled by `charWrap.hidden = …; builderSpeedWrap.hidden = !builder` (led-test-modal.js:218-220). Failing case: open the LED test modal with the default pattern `grid-white` → code sets both wrappers `hidden`, yet "Bouncing HighAsCG characters" count and "Builder speed" inputs are both visible. Fix: add `.led-test-modal__full[hidden] { display: none; }` (the pattern already used for `.logs-modal__body[hidden]`, 08a:29).
- `DEAD` client/styles/08c-modals-misc.css:107-112 `.led-test-modal__actions` — `rg -n "led-test-modal__actions" client src tools` → only this CSS (the modal uses `.modal-footer`).
- `DEAD` client/styles/08c-modals-misc.css:269-290 `.scenes-rundown-row`, `.scenes-rundown-row > :first-child`, `.scenes-wall-clock` — nothing creates a rundown row or a `scenes-wall-clock`; the only rundown element is `.scenes-rundown-playback` (scenes-editor-support.js:47-48, live) and the wall clock became `#header-wall-clock` (header-bar.js:286, styled in 01a2-header-bar.css:437). grep: `rg -n "scenes-rundown-row|scenes-wall-clock" client src tools` → only this CSS. The comment block at :276-278 documents a bug in a feature that no longer renders.
- `QUALITY` client/styles/08c-modals-misc.css — `load-project-modal.js:199,206,209` sets `load-project-modal__tag--conflict`, `__tag--error` and `__row--corrupt` but no rule exists for them (only `__tag--active`, :257). A corrupt project row looks exactly like a healthy one apart from the small word "corrupt".

## client/styles/08c2-modals-header-audio-usb-import.css
- `OK`

## client/styles/08c3-modals-hardware-reconcile-banners.css
- `OK` — `.hardware-reconcile-modal__diff-item--hard` has no literal user but is built as `` `…diff-item--${it.severity}` `` (project-hardware-reconcile-modal.js:76) and `'hard'` is a real severity (project-hardware-mismatch.js:202).

## client/styles/08d-modals-shader-fx.css
- `DEAD` client/styles/08d-modals-shader-fx.css:286-292 `.shader-live__section` — `rg -n "shader-live__section" client src tools` → only this CSS (the `c.section` hits in tools/smoke are a different property).
- `QUALITY` client/styles/08d-modals-shader-fx.css:251-257 vs :310-315 — `.shader-live__params` is declared twice; the second block repeats `display/flex-direction/gap` and overrides `max-width: 720px` with `1100px`, so the first `max-width` is dead. Merge into one rule.
- `QUALITY` client/styles/08d-modals-shader-fx.css:40-41,98,111,138,142 etc. — `--panel-bg-2`, `--border-color`, `--mono-font`, `--ok-color`, `--err-color` are not defined anywhere (`rg -n -- "--(panel-bg-2|border-color|mono-font|ok-color|err-color)\s*:" client` → none); every use renders its hex fallback and ignores the theme (`--bg-elevated`, `--border`, `--success`, `--error`).
- `QUALITY` client/styles/08d-modals-shader-fx.css:137-143 — shader-fx-modal.js:118 emits `shaderfx-status--warn` (set at :207 and :250 for "imported with skipped lines" / "saved with live errors") but only `--ok` and `--err` have rules, so warnings render in the neutral colour.

## client/styles/08d2-shader-live-controls.css
- `OK`

## client/styles/09-device-view.css
- `QUALITY` client/styles/09-device-view.css:1-7 — the "device view style entrypoint" imports 09a, 09b1, 09b2, 09b3, 09c, 09d but not 09e (pulled in separately by client/styles.css:46) and not 09b (dead, see below); a reader of the entrypoint gets an incomplete list. Add 09e here and drop it from styles.css, or comment it.

## client/styles/09a-device-view-layout-destinations.css
- `OK` (6-line aggregator for 09a1-09a3.)

## client/styles/09a1-device-view-layout-toolbar.css
- `OK`

## client/styles/09a2-device-view-destinations-visual.css
- `DEAD` client/styles/09a2-device-view-destinations-visual.css — a retired "visual destination canvas / channel-order chips" feature: :63-67 `.device-view__destination-grid`, :102-121 `-destination-visual`, `-visual-head`, `-destination--visual`, :156-167 `-destination-map-chips`, :168-172 `-destination-port--pair-in`, :178-187 `-destination-resize`, :188-192 `-destination-io-grid`, :193-213 `-destination-row`, `-row-name`, `-row small`, :214-236 `-channel-order`, `-channel-order-list`, `-channel-chip`, `-channel-chip--active`, :335-337 `-destination-port--input` (~110 lines). grep: `rg -n "device-view__(destination-(grid|visual|visual-head|map-chips|resize|io-grid|row|row-name|port--input|port--pair-in)|destination--visual|channel-order|channel-chip)" client src tools` → only this CSS and one JS user of `--active` (below); no `device-view__…${` builder exists besides `destination--mode-${mode}` (device-view-destinations-ui.js:157), whose modes `pgm_only/multiview/stream` keep :258-277 live. Related dead JS (outside this batch): in client/components/device-view-destinations-ui.js `chipByKey` (:59) is never `.set(…)`, so the `device-view__channel-chip--active` add/remove at :70,82,89,93 never touches anything.
- `QUALITY` client/styles/09a2-device-view-destinations-visual.css:2,22,200,228,245 — `var(--color-border, …)` and the siblings `--color-panel/--color-muted/--ok-fg/--warn-fg` (09a3, 09b2, 09b3, 09d) are not defined anywhere, so the whole device view runs on hard-coded hex fallbacks, independent of the token file.

## client/styles/09a3-device-view-segments-mapping.css
- `DEAD` client/styles/09a3-device-view-segments-mapping.css:34-40 `.device-view__bands`, :89-93 `.device-view__panel-row` — `rg -n "device-view__(bands|panel-row)" client src tools` → only this CSS.
- `QUALITY` client/styles/09a3-device-view-segments-mapping.css:96-110 vs client/styles/03d-mapping-editor.css:36 — `.device-view__mapping-node` has a base rule in both files. 03d is imported last (client/styles.css:47) so both apply: 09a3's `min-width/min-height/align-items:center/cursor/box-shadow` leak into the 03d card layout while 03d wins `background/border/padding/gap`. Result depends on import order; keep one definition.
- `QUALITY` client/styles/09a3-device-view-segments-mapping.css:2-19 — `.device-view__inspector-input` carries 12 `!important`; it is used by device-view-inspector-mapping.js:52,73. Use a more specific selector instead.

## client/styles/09b-device-view-connectors-inspector.css
- `DEAD` client/styles/09b-device-view-connectors-inspector.css:1-4 — whole file: a "backward-compatibility forwarder" that @imports 09b1/09b2/09b3. Nothing imports it: `rg -n "09b-device-view-connectors-inspector" --glob '!work/**' --glob '!client/assets/map-data.json' .` → no hit (client/styles.css and 09-device-view.css import the three parts directly; no html/vite/smoke reference). Delete.

## client/styles/09b1-device-view-connectors-overlay.css
- `DEAD` client/styles/09b1-device-view-connectors-overlay.css:306-312 — the `.device-view__panel-marker--dli` member of the shared selector list; client/components/device-view-caspar-render-markers.js:122 adds only `--dlo` (`decklink_out|decklink_io`), and no code adds `--dli`. `rg -n "panel-marker--dli" client src` → CSS only. Remove the selector from the list (the `--dlo` and `--decklink-ref` members stay).

## client/styles/09b2-device-view-backpanel-hardware.css
- `DEAD` client/styles/09b2-device-view-backpanel-hardware.css — :34-44 `.device-view__backpanel-label`, :53-55 `-backpanel-metal`, :116-144 `-backpanel-slot-apply` (+ hover/active/svg), :145-151 `-backpanel-controls`, :233-245 `-backpanel-connector-row`, :246-251 `-backpanel-connector-icon` (~75 lines). grep: `rg -o "device-view__backpanel[a-z-]*" client --glob '!client/styles/**'` lists the 12 backpanel classes in use (`-overlay, -slots, --caspar, -slot, -slot-title, -slot-plus, -slot-edit, -slot-hint, -slot-connectors, -column`); these six are not among them.

## client/styles/09b3-device-view-inspector-sidebar.css
- `DEAD` client/styles/09b3-device-view-inspector-sidebar.css — :52-57 `.device-view__edge-rm`, :87-99 `-inherited-box`, :126-128 `-links`, :139-149 `-stream-badge`, :200-206 `-decklink-input-row`, :212-214 `-cable-btn`, :229-235 `-input--inherited`. grep: `rg -n "device-view__(edge-rm|inherited-box|links|stream-badge|decklink-input-row|cable-btn|input--inherited)\b" client src tools` → only this CSS. (smoke-wo440-441 reads this file but pins none of them.)
- `QUALITY` client/styles/09b3-device-view-inspector-sidebar.css:7,74,300-309 — `var(--ok-fg, …)`, `var(--warn-fg, …)`, `var(--color-border, …)`: undefined tokens, fallback always used (see 09a2).

## client/styles/09c-device-view-config-modal.css
- `OK`

## client/styles/09d-device-view-simple-wiring.css
- `OK`

## client/styles/09e-device-view-matrix.css
- `OK` — `device-view-matrix__cell--active` and `__toolbar` are set by device-view-matrix.js:13,150 without a rule; harmless (the dot carries the visual).

## client/styles/companion-button-picker.css
- `DEAD` client/styles/companion-button-picker.css:107-119 `.companion-flag-keyframe` and `.companion-flag-keyframe--selected` (+ `img`) — `rg -n "companion-flag-keyframe" client src tools` → only this CSS; the timeline flag inspector (inspector-panel-timeline-flag.js) only uses `companion-inspector-preview*`.

## client/styles/map-explorer.css
- `DEAD` client/styles/map-explorer.css:189-193,423 `.map-card__child-count`; :388 `.map-card__icon` (inside a media query); :646-670 `.map-toolbar__btn` (+ hover/.active); :703-707 `.map-edge--external` — no element uses them. map-explorer.js:873-880 renders `map-card__badge` instead of `__child-count`, map.html has no `.map-toolbar__btn`, and external imports are skipped before any edge is drawn (map-explorer.js:363-365, `continue`), so `--external` never exists. `map-edge--internal/--cross-module` are live via `` `map-edge map-edge--${type}` `` (map-explorer.js:418).
- `QUALITY` client/styles/map-explorer.css:9 / client/map.html:9-11 — `--map-font` is `'Rewir', system-ui…`, but map.html loads only this stylesheet (no Rewir `@font-face`, that lives in 01a1-base-theme-tokens.css:8), so the page renders in system-ui, while map.html downloads the Google "Inter" family that no rule references. Either drop the Inter `<link>` or use it in `--map-font`. (800 lines is the CI-exempt size, tools/ci/check-max-file-lines.js:28.)

## client/styles/previs-hud.css
- `OK` — PARKED module (eslint.config.js:76); served by src/previs/register.js:60-62.

## client/styles/previs-inspector.css
- `OK` — a literal grep reports ~28 "unused" classes, all built from constants (`` `${PANEL_CLASS}__section` `` in client/components/previs-mesh-inspector.js:8 etc.); not dead.

## client/styles/previs-settings.css
- `OK` — `.previs-skeleton` (:515) has no user but its comment says it is kept deliberately for the stub import.
