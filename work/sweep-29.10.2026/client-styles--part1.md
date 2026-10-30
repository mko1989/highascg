# client/styles (part 1: 01a base … 07b1 modal shell) — sweep 29.10.2026 (batch 018)

Files: 31 · lines: 6999 · findings: 0 BUG-HIGH, 4 BUG, 31 DEAD, 1 RISK, 26 QUALITY

Method: every selector class/id in the 31 files was checked with a word-boundary grep over `client/` (js, html), `src/`, `tools/`, `scripts/`, `godot/`, `index.js`, excluding `node_modules` and `dist*`. Classes built by template strings (`header-replication-indicator--${mode}`, `ingest-status--${t}`, `${prefix}__bus-meter-*`) were traced to their producers and are NOT reported. Every `var(--x)` was checked for a definition anywhere under `client/` or `src/`. `client/tools/electron-launcher` has its own stylesheet (it does not load `styles.css`), so its classes do not keep a rule alive. `client/styles.css` imports all 31 files (03d last at line 47, 07b3 before 07b1 at lines 33-34). Smokes that read these files as text were checked: none of the DEAD ranges below is pinned (wo369 pins `.header-wall-clock`, wo287 pins `.sources-drag-overlay {`, `.scenes-compose {`, `.modal-overlay`, wo226 pins `.scenes-btn--timer*` and `.inspector-screen-timer*`).

## client/styles/01a-base-theme-header-connection.css
- `QUALITY` client/styles/01a-base-theme-header-connection.css:1-10 — comment-only file (no rules), still `@import`ed from client/styles.css:4. Harmless but a wasted request on the un-bundled path and a misleading name; drop the import and the file.

## client/styles/01a1-base-theme-tokens.css
- `QUALITY` client/styles/01a1-base-theme-tokens.css:17-36 — the token set is missing names the rest of the stylesheet already uses. Never defined anywhere under client/ or src/: `--bg-2` (05d:293, 06c:135), `--bg-3` (06a1:11, 06a3:59, 06a3:74, 06c:141, 07b:33), `--bg-hover` (05b:145, 05d:146), `--warning` (03a:48, 03a:92, 03a:234), `--panel-bg` (02c3:401, 03d:301, 06c3:283), `--border-color` (03d:300), `--ui-font-family` (03d:3), `--text-primary` (01a2:210). Most carry a literal fallback so they silently render the fallback; three have no fallback and are real bugs (see 03a, 05b, 06a3). Fix: define `--bg-2/--bg-3/--bg-hover/--warning` here (or replace the references with `--bg-elevated`/`--warn`).
- `QUALITY` client/styles/01a1-base-theme-tokens.css:4 — `@see main_plan.md Prompt 11` points at a file that is not in the repo root.

## client/styles/01a2-header-bar.css
- `DEAD` client/styles/01a2-header-bar.css:195-211 `.header-bar__map-link` (+`:hover`) — no producer. grep: `rg -n "header-bar__map-link|map-link" client src tools scripts godot` → only this rule. Its hover also uses `var(--text-primary)`, which is not defined in the web client (only in electron-launcher), so it was never right.
- `DEAD` client/styles/01a2-header-bar.css:213-219 `.header-led-test__label` — header-bar-led-test.js:23,32 builds only `header-btn--led-setup` and `header-btn--ftb`. grep: `rg -n "header-led-test__label" client src` → only the rule.
- `DEAD` client/styles/01a2-header-bar.css:242-254 `.header-led-test .header-btn--pgm-rec` and `…--pgm-rec--on` — no producer. grep: `rg -n "pgm-rec" client src tools scripts godot` → only these rules.

## client/styles/01a3-connection-chrome.css
- `DEAD` client/styles/01a3-connection-chrome.css:58-74 `.status-dot` (+`.connected`, `.disconnected`) and :126-128 `@keyframes pulse` — only `client/tools/electron-launcher/index.html:35` uses `status-dot`, and the launcher styles itself (launcher-01-header.css:103-113). grep: `rg -n "status-dot\b" client src --glob '!node_modules' --glob '!client/tools/**'` → only this CSS; `rg -n "animation:.*\bpulse\b" client/styles` → only line 63.
- `QUALITY` client/styles/01a3-connection-chrome.css:97-100 `.connection-eye.offline .connection-eye__img { filter: none }` — no other rule sets a filter on the img, so this is a no-op (the class is set at connection-eye.js:345). Remove rule and comment.

## client/styles/01b-layout-panels-workspace.css
- `QUALITY` client/styles/01b-layout-panels-workspace.css:133-151 `.panel-inspector-mode` — declares `border-bottom: 2px solid transparent` (line 135) and again `border-bottom: none` (line 150); the first is dead. Same pattern in 02c3:15-34 `.sources-tab` (`border: none` + `border-bottom: none`).

## client/styles/02a-workspace-tabs-scenes-preview-host.css
- `OK`

## client/styles/02b-preview-panel-output-compose.css
- `OK`

## client/styles/02c-timeline-multiview-sources-sidebar.css
- `QUALITY` client/styles/02c-timeline-multiview-sources-sidebar.css:1-5 — comment-only shell (same as 01a), still imported at client/styles.css:11.

## client/styles/02c1-timeline-sidebar.css
- `QUALITY` client/styles/02c1-timeline-sidebar.css:1-3 — header comment is copy-pasted from 02c ("Timeline editor root, multiview tab, sources panel tabs/search/footer"); the file holds only the timeline root/preview-host/split handle. The file name says "sidebar" but nothing here is a sidebar.
- `QUALITY` client/styles/02c1-timeline-sidebar.css:55-61 `.tl-editor` — selector is declared again at 05b:7-13 (`height:100%`, background, `overflow:hidden` duplicated). Merge into one place.

## client/styles/02c2-multiview-sidebar.css
- `DEAD` client/styles/02c2-multiview-sidebar.css:9-14 `.placeholder` — no element carries the bare class `placeholder`. grep: `rg -nE "class(Name)?=[\"'\`][^\"'\`]*\bplaceholder\b" client src tools template` → only electron-launcher `*-placeholder` names; `rg -n "classList.*'placeholder'" client` → none. (`#tab-multiview.active` above it is live.)

## client/styles/02c3-sources-sidebar.css
- `DEAD` client/styles/02c3-sources-sidebar.css:361-366 `.sources-usb-hint` — grep: `rg -n "sources-usb-hint|usb-hint" client src` → only this rule.
- `DEAD` client/styles/02c3-sources-sidebar.css:368-454 `.streaming-panel*` ("Streaming workspace tab (WO-27)", ~87 lines) — no producer; the Streaming tab does not exist in the client. grep: `rg -n "streaming-panel" . --glob '!node_modules'` → only this file and work/work-orders/27_WO_STREAMING_CHANNEL.md, PROJECT_BREAKDOWN.md. Uses undefined `--muted`/`--panel-bg` (fallbacks) too.
- `QUALITY` client/styles/02c3-sources-sidebar.css:15-34 — `.sources-tab` sets `border: none` then `border-bottom: none` (redundant).

## client/styles/03a-offline-sync-publish-ingest-menu.css
- `BUG` client/styles/03a-offline-sync-publish-ingest-menu.css:233-236 `.ingest-menu-item--placeholder:hover { background: var(--warning); color: #000 }` — `--warning` is not defined anywhere (tokens define `--warn`), no fallback → the declaration is invalid at computed-value time and the background falls to transparent, so with `color:#000` the "Add Placeholder…" item (shown in offline mode, sources-panel-ingest-ui.js:263) turns black-on-dark on hover. Fix: `var(--warn)`.
- `BUG` client/styles/03a-offline-sync-publish-ingest-menu.css:251-253 `.ingest-menu-item--usb.ingest-menu-item--usb-pending` — never matches: sources-panel-ingest-ui.js:137,140 toggles the class `pending`, not `ingest-menu-item--usb-pending`. Effect is only the 0.9 opacity, but the selector and the JS disagree. Fix: align one side.
- `DEAD` client/styles/03a-offline-sync-publish-ingest-menu.css:94-113 `.header-btn--sync`, `.header-btn--publish` — no producer. grep: `rg -n "btn--sync|btn--publish" client src` → only the CSS (`rg -n "header-btn--" client --glob '*.js'` lists load/save/settings/server/ftb/led-setup/open-*).
- `DEAD` client/styles/03a-offline-sync-publish-ingest-menu.css:28-30,36-92 `.sync-modal`, `.sync-report*`, `.sync-reconcile-lists`, `.sync-list*`, `.status-badge*` — only client/components/sync-modal.js uses them, and that file is dead (`showSyncModal` has no importer; flagged in client-components--part8.md, listed in tools/ci/unwired-exports-baseline.json:57). Delete together. (`.sync-loading`, lines 31-35, is LIVE: load-project-modal.js:52,71.) Lines 48, 92 also use the undefined `--warning`.
- `DEAD` client/styles/03a-offline-sync-publish-ingest-menu.css:115-144 `.publish-step*` — only client/components/publish-modal.js uses them; that file is dead (`showPublishModal` has no importer, flagged in client-components--part6.md, baseline line 48). Delete together with 03b:157-174. (`.spinner`/`@keyframes spin` at 146-160 is LIVE: load-project-modal.js:53,72.)
- `QUALITY` client/styles/03a-offline-sync-publish-ingest-menu.css:162-174 — `.header__logo` (live, index.html:59) and a second `.header__title { display:flex; align-items:center }` that 01a2:20-28 already sets. Both belong in 01a2.
- `QUALITY` client/styles/03a-offline-sync-publish-ingest-menu.css:1-3,269 — header says "Offline watermark" (no such rule) and the file ends with an orphan `/* ─── Universal Drag Overlay ─── */` heading whose rules live in 03b.

## client/styles/03b-ingest-drag-upload-progress.css
- `DEAD` client/styles/03b-ingest-drag-upload-progress.css:36-39 `.sources-drag-overlay__icon` — the overlay markup (sources-panel-shell.js:3) is `__content > <span>Drop to ingest</span>`; no icon element. grep: `rg -n "drag-overlay__icon" client src` → only the rule.
- `DEAD` client/styles/03b-ingest-drag-upload-progress.css:157-174 `.publish-modal .progress-bar-wrap`, `.publish-modal .progress-bar`, `.publish-upload-percent` — only publish-modal.js (dead file, see 03a). The `.sources-drag-overlay {` rule is pinned by smoke-wo287-wo289-styles.test.js:34 and stays.

## client/styles/03c-sources-items-effects.css
- `DEAD` client/styles/03c-sources-items-effects.css:22-26 `.source-item--media-compact:hover` — rows are built as `source-item--media-detailed` (sources-panel-media.js:189); no `media-compact` producer. grep: `rg -n "media-compact" client src` → only this rule.
- `DEAD` client/styles/03c-sources-items-effects.css:28-30 and 214-230 `.source-item__preview` (+`:hover`, and the `.source-item:hover .source-item__preview` reveal) — no producer. grep: `rg -n "source-item__preview" client src` → CSS only.
- `DEAD` client/styles/03c-sources-items-effects.css:41-44 `.source-item--previewing` — grep: `rg -n "item--previewing" client src` → CSS only.
- `DEAD` client/styles/03c-sources-items-effects.css:71-89 `.source-item__meta` and `.source-item__meta--cols` with `__meta-ext/-res/-codec/-dur/-size` — rows use `__meta-row`/`__meta-tag` only (sources-panel-media.js:207-213, sources-panel-placeholders.js:47-49). grep: `rg -n "source-item__meta[^-]|meta--cols|meta-ext|meta-codec" client src` → CSS only.
- `DEAD` client/styles/03c-sources-items-effects.css:370-374 `.source-item__icon--effect` — grep: `rg -n "icon--effect" client src` → CSS only.
- `QUALITY` client/styles/03c-sources-items-effects.css:140-180 vs 04-media-lists-sources-tree.css:246-284 — `.source-item--folder`, its `__label`, `:hover`, `.collapsed .__expand-arrow` are defined in both files; 04 loads later and wins (background `rgba(255,255,255,.03)` replaces `transparent`, label colour `#f59e0b` replaces `--text-muted`, arrow `font-size:8px` replaces `.65rem`). The 03c versions of those properties are dead. Keep one copy.
- `QUALITY` client/styles/03c-sources-items-effects.css:212 `.sources-media-list .source-item + .source-item { margin-top: 0 }` — `.source-item` has no margin, so this is a no-op.

## client/styles/03d-mapping-editor.css
- `RISK` client/styles/03d-mapping-editor.css:36-45 `.device-view__mapping-node` — this is the LAST file in client/styles.css (line 47, after all 09*) and redefines the live WO-42 "minimal mapping node" from 09a3-device-view-segments-mapping.css:96-110 (the only markup, device-view-mappings-render.js:47). Same specificity, later wins: `background #1c2128` (09a3: `#111116`), `border-color #30363d` (`#3f3f48`), `border-radius 6px` (`8px`), `padding 12px` (`4px 6px`), `gap 8px` (`6px`), and adds `margin-bottom:12px`. 09a3's `min-width/min-height/cursor/box-shadow/align-items` still apply, so the rendered node is an unintended merge of two designs. Decide which design is wanted and delete the other; I did not render it, so this is not a proven defect.
- `DEAD` client/styles/03d-mapping-editor.css:47-321 — every rule after the base node targets a retired "compact" node markup: `.device-view__mapping-node--compact`, `-node-head`, `-node-title(-btn)`, `-node-ports-row`, `.device-view__port--mapping-in/-out`, `.device-view__port--compact`, `-node-outputs`, `-port-index`, `-add-output-wrap/-btn`, `-overflow(-sum/-panel/-item)`, `-node-hint`, `-port-lbl`, `-enter`, `-node-toolbar`, `-toolbar-danger`, `-output-config(-row)`, `-output-label`, `-output-mode`. The renderer emits only `device-view__mapping-node`, `-node-label`, `-node-port(--in/--out)`, `-node-out-stack`, `-node-idx`, `-node-plus-btn` (device-view-mappings-render.js:47-83), styled in 09a3. grep: `rg -n "mapping-(overflow|enter|add-output|output-config|node-head|node-toolbar|port-lbl|port-index)|mapping-node--compact|port--mapping-" client src --glob '*.js' --glob '*.html'` → none. ~275 of the file's 321 lines.
- `QUALITY` client/styles/03d-mapping-editor.css:1-4,29-34 — the live remainder (`.mapping-browser*`, `.pixel-map-editor .mv-toolbar`) is hard-coded hex instead of tokens, uses undefined `--ui-font-family`; file name "mapping-editor" and slot `03d` do not match its import position (last).
- `QUALITY` client/styles/03d-mapping-editor.css:96,246 / 86,315 / 129,159 — duplicate selectors (`-node-outputs`, `-node-ports-row` where the later `display:flex` cancels the earlier `display:contents`, `-add-output-btn`); moot once the dead block is removed.

## client/styles/04-media-lists-sources-tree.css
- `DEAD` client/styles/04-media-lists-sources-tree.css:1-161 `.media-list*` (header/body/row/col/name/ext/res/dur/line/meta/preview, `--compact`) — no producer. grep: `rg -n "media-list" client src tools --glob '*.js' --glob '*.html'` → only the `sources-media-list` (different class) toggle in sources-panel-render.js:71,75.
- `DEAD` client/styles/04-media-lists-sources-tree.css:163-244 `.media-card*` ("Legacy media-card (kept for compatibility)") — grep: `rg -n "media-card" client src tools` → CSS only.
- `DEAD` client/styles/04-media-lists-sources-tree.css:255-258 `.source-item--folder .source-item__kind-pill` — folder markup (sources-panel-media.js:108-116) has no kind pill.
- (Lines 246-253, 259-284 — folder tree, nest indent, drop target — are live: sources-panel-media.js:108,111,145-151,220.)

## client/styles/05b-timeline-editor.css
- `QUALITY` client/styles/05b-timeline-editor.css:125-146 vs 175-198 — `.tl-layer-menu` and `.tl-layer-menu button(:hover)` are each declared twice; the second block wins on every shared property, so the first block's hover (`var(--bg-hover)`, undefined, no fallback) and `min-width:140px` is only partly effective. Remove the first block.
- `QUALITY` client/styles/05b-timeline-editor.css:196-198 — hover is `var(--bg-dark, #30363d)`; `--bg-dark` IS defined (`#0d1117`), so the fallback `#30363d` never applies and the hover is darker than the `#21262d` menu it sits on. Almost certainly meant `--border`/`#30363d`.
- `QUALITY` client/styles/05b-timeline-editor.css:7-13 — `.tl-editor` duplicated from 02c1:55-61 (see there).

## client/styles/05c-multiview-editor.css
- `DEAD` client/styles/05c-multiview-editor.css:33-37 `.mv-toolbar__label` — grep: `rg -n "mv-toolbar__label" client src` → CSS only (multiview-editor.js:93-105 uses `mv-chk`, `mv-toolbar__sep`, `mv-preset`).
- `DEAD` client/styles/05c-multiview-editor.css:65-70 `.mv-btn--live-on` ("Operator-GUI Edit ⇄ Live toggle") — no producer in web, src or godot. grep: `rg -n "mv-btn--live-on|live-on" client src godot tools --glob '!*.md'` → only unrelated `scenes-edit-live-on-pgm` event names.
- `QUALITY` client/styles/05c-multiview-editor.css:131 — dangling `/* ── Inspector panel ── */` heading with nothing after it.

## client/styles/05d-inspector-fields.css
- `DEAD` client/styles/05d-inspector-fields.css:276-282 `.inspector-hint` and 284-288 `.inspector-fill-fields` — grep: `rg -n "inspector-hint|inspector-fill-fields" client src tools` → CSS only (the `inspector-fill*` hits are module file names).
- `QUALITY` client/styles/05d-inspector-fields.css:293 — `var(--bg-2, #21262d)` and :146 `var(--bg-hover, …)` rely on tokens that do not exist (see 01a1).

## client/styles/05d2-inspector-clip-trim.css
- `OK`

## client/styles/05e-inspector-media-file.css
- `DEAD` client/styles/05e-inspector-media-file.css:62-66 `.media-insp__transport` and 76-80 `.media-insp__tc` — inspector-media-file.js:55-60 renders no transport row; the only reference to `.media-insp__tc` is the `querySelector` at inspector-media-file.js:75, which never finds an element (so the timecode branch of `onDuration` is dead too). grep: `rg -n "media-insp__(transport|tc)" client src` → CSS + that one query.

## client/styles/06a1-scenes-deck-toolbar.css
- `DEAD` client/styles/06a1-scenes-deck-toolbar.css:84-102 `.scenes-screen-tabs`, `.scenes-screen-tab`, `.scenes-screen-tab.active` — scene-list.js builds `scenes-main-pills`/`scenes-main-pill` instead. grep: `rg -n "scenes-screen-tab" client src` → CSS only.
- `QUALITY` client/styles/06a1-scenes-deck-toolbar.css:1-30 — header says "Scenes deck toolbar, look cards" but the first 30 lines are inspector rules (`.fixture-inspector__sep`, `.inspector-btn-sm:hover` for a button defined in 05d:290, `.inspector-kf-remove`, `.inspector-keyframe-row`); they belong in 05d/06c.

## client/styles/06a2-scenes-deck-cards.css
- `DEAD` client/styles/06a2-scenes-deck-cards.css:292-303 `.scenes-card__thumb-empty`, 333-349 `.scenes-card__title`, `.scenes-card__meta`, `.scenes-card__actions` — card markup uses header/name-input/thumb/thumb-canvas/footer/missing-badge only. grep: `rg -o "scenes-card__[a-z-]*" client --glob '*.js'` → no `thumb-empty|title|meta|actions`.
- `QUALITY` client/styles/06a2-scenes-deck-cards.css:305-312 and 328-331 — `.scenes-card__footer` declared twice; the second overrides `gap`/`padding` of the first. Merge.

## client/styles/06a3-scenes-deck-multi.css
- `BUG` client/styles/06a3-scenes-deck-multi.css:73-75 `.scenes-main-pill__eye:hover { background: var(--bg-3) }` — `--bg-3` is undefined and has no fallback here (the sibling `__out:hover` at line 59 has `#30363d`), so the declaration is invalid and hover turns the eye button's background from `--bg-panel` to transparent instead of lighter. Fix: `var(--bg-3, #30363d)` or a real token. Cosmetic.
- `DEAD` client/styles/06a3-scenes-deck-multi.css:77-86 `.scenes-next-global` — grep: `rg -n "scenes-next-global" client src` → CSS only.

## client/styles/06b-scenes-edit-transitions-layerstrip.css
- `DEAD` client/styles/06b-scenes-edit-transitions-layerstrip.css:81-89 `.scenes-look-transition__dur` (+`span:first-child`) and 101-104 `.scenes-look-transition__unit` — scenes-shared.js:93-101 emits `__select`, `__num`, `__hint` (and queries `__label`); no `__dur`/`__unit` wrapper. grep: `rg -n "look-transition__(dur|unit)" client src` → CSS only.

## client/styles/06c-inspector-effects-pip.css
- `DEAD` client/styles/06c-inspector-effects-pip.css:110-118 `.inspector-pip-overlay-params` (+ `.inspector-field` child rule) — inspector-pip-overlay.js:383 only sets `inspector-group inspector-pip-overlay-group`. grep: `rg -n "pip-overlay-params" client src` → CSS only.
- `QUALITY` client/styles/06c-inspector-effects-pip.css:135,141 — `--bg-2`/`--bg-3` undefined (see 01a1).

## client/styles/06c2-inspector-layer-style-presets.css
- `OK`

## client/styles/06c3-inspector-lt-roster.css
- `DEAD` client/styles/06c3-inspector-lt-roster.css:101-143 `.inspector-lt-status`, `__dot` (+`--idle/--loaded/--playing`), `__text`, and :133-136 `@keyframes lt-pulse` — no producer. grep: `rg -n "inspector-lt-status|lt-pulse" client src tools` → CSS only. `--idle` (118-120) duplicates the base colour anyway.

## client/styles/07a-scenes-compose-canvas.css
- `QUALITY` client/styles/07a-scenes-compose-canvas.css:351-359 — two stale/contradictory comments: line 351 says "the only remaining handle button is the WO-158 crop toggle", line 357-358 says that toggle was removed in the todos30.07.26 pass; "blue scale/rotate handles" no longer exist either. Trim to one accurate comment.

## client/styles/07b-audio-mixer-modal-shell.css
- `BUG` client/styles/07b-audio-mixer-modal-shell.css:248-252 vs 259-274 — the green `.audio-mixer__start-btn` look (background/border/colour) is declared BEFORE the shared `.audio-mixer__solo-btn, .audio-mixer__mute-btn, .audio-mixer__start-btn, .audio-mixer__stop-btn { background: rgba(255,255,255,.05); border: …; color: var(--text-muted) }` rule; both are single-class selectors, so the later grey rule wins. Failing case: a live-input strip in the inspector mixer (audio-mixer-panel-live-inputs.js:91) shows a grey ▶ button, green only on hover (the `:hover` rule at 254 has higher specificity and is not in the shared hover list at 276). The comment says it should be always visible and distinct, "especially when no signal". Fix: move lines 246-257 below line 274.
- `QUALITY` client/styles/07b-audio-mixer-modal-shell.css:1-3 — header says "…generic modal shell"; the shell moved to 07b1 (07b3 is imported between them at client/styles.css:33-34).
- `QUALITY` client/styles/07b-audio-mixer-modal-shell.css:33 — `var(--bg-3, #21262d)` undefined token (see 01a1).

## client/styles/07b1-modal-shell-base.css
- `OK`
