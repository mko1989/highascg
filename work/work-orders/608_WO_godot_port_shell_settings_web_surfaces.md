**Status: IN PROGRESS (2026-10-19) — owner layout rules R1–R5 DONE (box-verified 18.10, below); Settings slice 1 (Defaults / Companion / Media-USB) DONE 19.10; other settings tabs and modals open; logs window, Diagnostics, Updates, Nuclear done 20.10. D1/D2 decided by the owner 17.10 (below); D3 defaults to the recommendation. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599.**

# WO-608 — Godot port: app shell, header, settings, logs, project/load/USB modals, connection, optional modules — and what stays web

## Investigation

Inventory (Haiku, spot-checked): [`shell-settings-contract.md`](../godot-port/inventory/shell-settings-contract.md).
Scope: 31 components (6,859 LOC), 81 lib (9,608 LOC), shell `app.js`/`index.html`/`setup.html`/`map.html`
(684 LOC), 4 optional-module entries (297 LOC); CSS 64 files + `styles.css` (14,192 LOC, 58 reachable
via 45 `@import`s).

| Area | Notes |
|------|-------|
| Boot (`app.js:66-381`) | settings → state → project; WS handlers attach before open (WO-599 replicates) |
| Header bar (`header-bar.js` 347) + tabs (`app-tabs.js`) + workspace side panels (`workspace-layout.js` 149) | Godot `TabContainer`/`HSplitContainer`; collapsible side panels |
| Settings modal (no Save button, 600 ms whole-object autosave — Godot posts changed sections only, 19.10) | tabs: defaults, companion, media/usb, updates, system, decklink, diagnostics, tailscale, live audio (+ ALSA mixer), **nuclear** (password option), variables |
| Logs modal (`logs-modal.js` 473 + filter 177) | `log_line` WS; needs a **virtualized** list in Godot (research risk 4) |
| Connection eye (365) + A/B hot-backup profiles | status from `state`/`caspar.connection` |
| Project: load modal (434), new/reset/factory reset, hardware reconcile modal (policy in `localStorage['highascg_hardware_policy']` → server prefs, WO-598 D), media gather/reconcile | Download/upload of project JSON → Godot `FileDialog` (no portal) |
| USB import modal (456) | `usb:attached/detached/copy-progress` WS |
| Optional modules (`optional-modules.js`, `assets/modules/*/entry.js`: previs, tracking, autofollow, cg-studio) | Godot: feature scenes loaded when the server reports the module enabled |
| Orphans | `sync-modal.js`, `publish-modal.js` (0 importers) → **not ported** unless the owner revives them |

### Web-only surfaces (no web view in Godot core)

- **CG Studio** — separate browser app (`src/cg-studio/public/`, embedded as a lazy `<iframe>` by
  `client/components/cg-studio-tab.js`). Shader FX preview iframe → solved in WO-606 via Caspar.
- **Wiki/docs** (`docs/wiki-site/`), `setup.html`, `map.html` (dev map — not ported).
- **Remote operators** use the web client in a browser (and the `/ws/gui-stream` NVENC view, WO-319).

## Owner decisions

**Decided 17.10:** D1 — "id like the webclient to stay as is for remote work. if godot works we will
deprecate the kiosk client." → web client stays (remote), no parity obligation for new Godot features;
the kiosk (Firefox operator surface) is deprecated after WO-609. D2 — "cg studio whatever, can be
seperate browser." → CG Studio opens in its own browser window. Options as originally written:

- **D1 — Web client policy during/after the port.** Recommended: the web client **stays** as the
  remote/browser client (it is also the only thing a laptop on the network can open), gets bug fixes
  and the WO-598 thin-client refactors, and **new operator features land in Godot first**; parity
  in the web client only when asked. Alternative: freeze the web client entirely after cutover.
- **D2 — CG Studio.** Recommended: open it in its own Firefox window from the Godot client (the
  existing `POST /api/system/gui-launch` `firefox` action — Firefox stays on the box for browser
  sources anyway, WO-609). Alternatives: port CG Studio to Godot (~800 LOC UI per
  `NATIVE_GUI_PROPOSITIONS.md` §1), or a third-party web-view GDExtension (adds a browser engine).
- **D3 — Nuclear tab password + Tailscale login in the native client:** port as-is (recommended).

**Decided 18.10 — owner layout/styling rules for the Godot client (binding for every port WO):**
"the sources/media browser should take most of the height of the whole app, apart from top bar. The inspector should be
a panel always on the right and just changing contents based on selected item. The main and only font used should be
Rewir font. There is no logo branding and connection eyes. The looks should show as thumbnails." Read against the web
client (`client/index.html:56-115`, reference screenshot of the web UI 18.10), that means:

- **R1 Sources** — a left column spanning the full height under the header (web `aside.panel-sources`), not a pane
  inside the Live tab. All tabs share it (drops into looks AND timelines come from it).
- **R2 Inspector** — one right-hand column, always present, whose content follows the selection (media file, look
  layer, timeline clip/flag/layer, screen timer, border…; "Select an item" when empty). Editors never open their own
  right-hand panels inside a tab. (Web: `aside.panel-inspector`, modes Inspector / Layer presets / Look presets.)
- **R3 Font** — Rewir (`assets/fonts/Rewir-Light.ttf`) is the only font: theme default AND `ThemeDB.fallback_font`,
  no per-control font overrides with other faces (size overrides are fine).
- **R4 Header** — the HighAsCG logo + title and the connection eyes (`client/assets/*eyes*.svg`, web
  `connection-eye.js`) are missing from the Godot header and must be there; debug text (origin URL, "ws connected")
  is not header content.
- **R5 Looks** — the deck shows looks as thumbnail cards, not text rows.

## Port plan

1. Shell + header + tabs + connection eye + toasts (with WO-599 kit).
2. Settings modal tabs (forms on the shared kit; autosave semantics identical).
3. Logs (virtualized list), project load/new/reset/reconcile, USB import.
4. Optional-module mechanism; CG Studio launcher per D2.

## Acceptance

Parity checklist `work/godot-port/parity/shell-settings.md` (inventory bullets), owner-ticked;
settings changed in Godot appear in the web client and vice versa.

## What was done / What was VERIFIED

Investigation (17.10): orphan status, token file and font verified by hand; rest is the Haiku inventory.

### 18.10 — R1–R4 shell layout (port plan step 1, header part)

Done:
- `app/shell.gd` — header row: logo (`assets/ui/logo.png`, from `client/assets/logo`) + "HighAsCG" + project name,
  spacer, connection eyes. URL / ws-status labels removed (R4); the status line now lives in the eye tooltip. Body =
  HSplit [Sources (min 280) | HSplit [workspace tabs | Inspector (min 400)]] (R1/R2). The shell owns the one
  OscMirror (deck timers + media preview) and hands it to the Live tab and the media inspector. Placeholder tabs
  "Inspector" and "Media" removed — the Inspector is the right column, media is Sources.
- `app/inspector_panel.gd` (new) — the right column: title, scroll, "Select an item" when empty. `present(page)`
  re-parents a feature's page and hides the others; `release(page)`; empty state follows page visibility. Pages
  stay owned by their feature, so state survives switching.
- `app/connection_eye.gd` (new) — web `connection-eye.js` port: green (AMCP connected) / red (server or AMCP
  down) / blue (`offline_mode`); 30 s blink (L → R → open, 250 ms); 5 s random-frame celebration on connect.
  Frames are the PNGs embedded in the web SVGs (`client/assets/*eyes*.svg` only wrap base64 PNGs), extracted to
  `assets/ui/` and loaded at runtime from raw bytes like the font (no import step).
- Pages moved into the Inspector: the media file inspector (`media_panel.gd` presents it on tree select; its own
  scroll wrapper removed), screen timers + global border (`live_tab.gd`; their inner ScrollContainers removed —
  nested in the Inspector's scroll they collapsed to zero height), the look editor's geometry grid + layer
  inspector as one `_page` (`look_editor.gd`: presented on a user layer select, released on close / no selection;
  the background `_refresh_list` reselect never takes the Inspector back). The look editor's compose frame + layer
  list stay in the workspace. Selecting anything else hides the media page, which stops the Caspar preview.
- `app/main.gd` — the theme is also set on the root window and its Rewir font is `ThemeDB.fallback_font` (R3:
  popups / tooltips / dialogs too).
- `deck_view.gd` — card context menu placed at the cursor: it added the window position to an embedded popup's
  window coordinates, so on DP-3 (+1920) it was clamped to the right edge.

Verified (box, 18.10): `run-client.sh --check` boot OK; `--test` 665 passed / 0 failed. GUI on DP-3, screenshots
after each step: header = logo + HighAsCG + "Untitled" + green eyes (one blink frame caught); Sources full height
left; Inspector right with "Select an item". Select `USER CONF NOCNE.mp4` → media page in the Inspector with the
Caspar preview (clip shown in the opgui crop). Timers button → timers page replaces it and
`GET /api/operator-gui/layout` shows only the prv_1/pgm_1 cells (media cell withdrawn). Border → border page with
"Enable global border on this screen"; ✕ → "Select an item". Right-click "Background" → menu at the cursor → Edit
look… → editor in the workspace; select L10 → geometry + layer style / sizing / audio / effects / crop / PIP in
the Inspector; Close → "Select an item". Owner-QA: overall look against the web; R3 not audited for per-control
font overrides yet (none known).

### 18.10 — R5 look thumbnails

Done:
- `features/live/look_thumb_math.gd` (new, pure) — web `resolveSourceThumbnailUrl(deckIdleMode)`: media/file →
  `/api/thumbnail/<id>?hq=1&w=960&t=0`; DeckLink input routes (routeType or channelMap decklink channels) →
  `/api/thumbnail/live/<ch>`; buses / templates / NDI → none (WO-63). Placement = web `drawSceneComposeStack`
  deck mode: FILL rect, clip to the crop window, contentZoom, stretch (shader / `stretch` / unlocked aspect) | cover
  (`horizontal` / `vertical`) | contain (native / fill-canvas), all as one dst + src-region pair.
- `features/live/look_thumb.gd` (new) — the card canvas at the screen's aspect (`programResolutions[main]`), layers
  bottom → top with opacity and rotation; one fetch per URL shared by all cards (the deck rebuilds cards on every
  change); sources without a static thumbnail get a dim box with their name / "Loading…" / "No preview".
- `deck_view.gd` — cards (200 px) in an HFlowContainer grid with a 12 px gap (web `.scenes-deck` auto-fill grid),
  thumbnail on top, name + meta under it (ellipsized).

Verified (box, 18.10): `--test` 688 passed / 0 failed (+23 `test_look_thumb_math.gd`, incl. the box's "Background"
L11 off-canvas layer); `--check` boot OK. DP-3 screenshot: three cards in one row with thumbnails; "Background"
shows the same cropped framing as the live PRV tile on the operator channel. Click Waves → PRV border moves to
Waves; click Background → back (thumbnail doesn't eat the click). Not covered: template/CG thumbnails (web uses a
cached render — label for now), the web's on-air snapshot mode (`isSnapshotComposePreview`), card reorder drag and
the "＋" new-look tile.

### 19.10 — Settings slice 1: Defaults, Companion, Media / USB (port plan step 2)

Investigation:
- The web modal autosaves 600 ms after any input with a **whole-object** body: `settings-modal-logic.js`
  `buildSettingsPayload` = `{...prevAll, editorDefaults, companion, ui, osc, composePreview, usbIngest, …}` minus
  `offline_mode`. The server merges each section and leaves absent ones untouched (`src/api/settings-post.js`: caspar /
  osc / streaming per field, ui / composePreview / casparServer / rtmp / companion merged with the stored value,
  operatorTools only the keys present — WO-268). So a body with only the changed sections is safe.
- Echoing the whole GET back is **not** safe:
  - GET is redacted (`redact-settings.js`: password / token / secret / auth keys read `"[REDACTED]"`, strings over
    4096 chars are truncated), and the server stores a posted placeholder verbatim (box-probed, see
    [WO-619](./619_WO_settings_editor_defaults_never_persisted.md));
  - every web save also re-posts `osc`, which restarts the OSC subsystem (`settings-post.js` `restartOscSubsystem`).
- A text field autosaving per keystroke is risky: `local_media_path` symlinks `~/highascg/media` to the typed path
  as soon as the path exists (`settings-post.js` local_media_path branch), and a half-typed `/home` exists.
- Found while verifying: Defaults-tab saves never persisted (server bug, fixed in WO-619).

Done:
- `core/settings_payload.gd` (new, pure) builds the POST body: only the dirty top-level sections, with
  `"[REDACTED]"` / truncated values dropped so the server keeps what it stores. `ui.nuclearPassword` stays
  `"[REDACTED]"`, which is the server's keep-the-hash signal. `offline_mode` is never sent.
- `core/settings_state.gd`:
  - `patch` marks top-level keys dirty, and `_flush` posts only those sections; a failed post re-marks them;
  - new `saved(ok, info)` signal;
  - after a save with nothing new pending, settings are re-read (web `settingsState.load()`), and an edit made
    while the GET is in flight is kept.
- `features/settings/settings_form.gd` (new) builds a pane from rows bound to a settings path (option, check, text,
  number, heading, note, group). A change becomes `Settings.patch(nest(path, v))`, and `hydrate()` re-reads every row
  but skips a field that has focus. Text fields commit on Enter or on leaving the field (deviation, reason above).
- `features/settings/settings_model.gd` (new, pure) holds `nest`, `is_on` (unset = fallback, only `true` / `"true"`
  count) and the Companion status text and query (web `formatStatusText` / `buildStatusQuery`). JSON floats print as
  integers.
- `features/settings/settings_panes.gd` (new):
  - **Defaults**: coordinate origin, scene loop / start / content sizing, timeline loop-always / content sizing, the
    default transition (type, duration shown resolved to frames, tween), compose preview mode with the ffmpeg fields
    only for JPEG mode, invert touchpad scroll.
  - **Companion**: a Check button with the connection status (`GET /api/companion/connection-status`, also run when
    the pane opens), host / port / satellite fields.
  - **Media / USB**: project media location, CasparCG media path, project-scoped uploads, USB import fields.
- `features/settings/settings_tab.gd` (new) holds the sub-tabs and a status line: "Saved", the server's
  sideEffects / warnings, or the error. `app/shell.gd` replaces the Settings placeholder with it; `--tab=` is now
  applied after all tabs exist (Settings = 5).
- `tests/test_settings.gd` (new) covers the payload (dirty only, redaction strip, mirror untouched), the path
  helpers and the Companion text / query.

Verified (box, 19.10):
- `--test` 912 passed / 0 failed; `--check` boot OK; 0 files over 500 lines.
- DP-3, `--tab=5`, all three panes render in Rewir with the stored values.
- Loop always → `editor_defaults.json` `true` (after the WO-619 fix), and the box stays ticked after the reload.
- Content sizing "Fit canvas" → `fill-canvas` stored.
- Invert touchpad scroll on / off → `config/ui.json` keeps `nuclearRequirePassword: false` and an empty hash (no
  placeholder written).
- Companion: Check → "Connected — HTTP press API reachable at 127.0.0.1:8000. Satellite preview connected at
  127.0.0.1:16622."; preview bitmap size ▲ → `companion.json` 73, ▼ → 72.
- USB subfolder template: typing `usb/{label}` saved nothing for 1.5 s; Enter → `usb_ingest.json` stored it; cleared
  and stored `""` again.
- Every touched slice was compared with the pre-test snapshot. It matches, except `ui.json` now carries an explicit
  `invertTouchpadScroll: false`, plus the WO-619 side notes (`screen_count`, `osc.wsDeltaBroadcast`).

Not ported yet (next slices): system (hardware / mounts), decklink, Tailscale, live audio (+ ALSA
mixer), variables, nuclear (password + restart / reboot / Caspar actions); the media pane's exFAT sync table; the
web's WebCodecs warning for the stream preview mode (irrelevant here). The Godot client does not yet honour
`ui.invertTouchpadScroll` (its zoom / pan controls); the setting is kept for the browser client.

Open: Inspector modes (Layer presets / Look presets) and the bottom Playlists / Timers /
Program audio strip; the remaining settings tabs, logs and project modals (plan steps 2–4).

## 2026-10-20 — Inspector would not scroll (owner report)

**Investigation.** Owner: "i cant scroll inspector when the contents overflow it". On the box (Previs → Camera,
tracking page in Calibrate mode) the Inspector content ran off the bottom of the screen ("Floor grid" cut) with
no scrollbar, and the Previs Stage column was cut off at "Live source" too. `app/inspector_panel.gd` already
wraps pages in a ScrollContainer, so that box was not the cause. The Previs side panel
(`features/previs/previs_tab.gd` `_build_panel`) was a plain VBox: with a stage screen selected, its form plus the
Models / Live source / Camera / Screens blocks made the tab's minimum height larger than the window. Godot then
grows the shell past the bottom of the screen, so the Inspector's ScrollContainer gets the full content height and
has nothing to scroll. A headless probe (main.tscn instanced under a SceneTree script, per-tab
`get_combined_minimum_size`) measured Previs at 695 px with *no* screen selected; selecting one adds ~500 px.

**Done.** The Previs side panel sits in its own ScrollContainer (horizontal off; the inner Screens list keeps a
120 px minimum so it stays visible when the outer scroll is in play).

**Verified.** Godot suite 15509 passed / 0 failed. Box: relaunched on Previs, selected the LED screen (long form)
and Calibrate mode. Both columns now fit the window and each has a scrollbar. Wheel over the Inspector scrolled it
down to Floor grid / Width / Depth / Spacing. Wheel over a nested list (calibration points) scrolls that list first,
which is standard.

## 2026-10-20 — Header slice 1: project name, Save / Load / New, notice line, ⚙, FTB, wall clock

Owner: "work on filling the top bar like it is in the webui".

**Investigation.** Web header, left to right (`client/components/header-bar.js`, screenshot of :4200):
- logo, HighAsCG and the project-name input;
- Save (arrow→disk; Shift = download the JSON), Load (←disk; modal, Shift = upload a file), New project (confirm);
- the autosave line;
- Server ▾ (`header-bar-config-strip.js`), ⚙ (settings modal), the LED test checkbox with Test card… and FTB
  (`header-bar-led-test.js`);
- stream/record badges (`header-bar-streaming.js`), the replication L/F badge (`header-bar-replication.js`);
- the PGM now-playing timer (`app-pgm-header-timer.js`), wall clock, audio-monitor headphones (`header-bar-audio.js`)
  and the eyes.

The Godot header only had the logo, title, project label, the perf toggle and the eyes. Every action already has a
server endpoint:
- `POST /api/project/save | load | new` and `GET /api/project/list | file/:slug/download`
  (`src/api/routes-data-project-handlers.js`, `routes-data-project-read.js`);
- `POST /api/ftb {}`, which with no `screenIdx` fades every PGM + PRV (`src/api/routes-ftb.js`).

The server also owns the side effects:
- an autosave of a renamed project retires the old slug (handlers.js, autosave branch);
- load activates the show and, with `applyHardware`, the Device View;
- new builds the starter project and broadcasts.

So the client only posts. Two web findings:
- **The web autosave line never shows.** `client/app.js:187` dispatches `project-autosaved` on `document`
  (`bubbles` false), but `header-bar.js` listens on `window`. Not fixed in the web (WO-608 retires it).
- **The LED test card is client-composed.** Its settings live in browser localStorage (`led-test-modal.js`), and
  `led-test-apply.js` picks targets and builds payloads in the browser. Directive D needs a server-side store and
  endpoint first, so it is a separate slice (below, open).

**Done.**
- **`app/header_project.gd`** — the left group:
  - Name LineEdit: Enter or focus-out sets `project.name` and flushes the autosave; the server renames.
  - Save (`ProjectSync.save_now()`): waits out a running autosave, then `POST /api/project/save`. It adopts `rev` and
    skips the project_sync echo.
  - Load (`app/project_load_dialog.gd`): a Project / Saved tree from `/api/project/list` with the active project
    preselected. Choosing one posts `load {slug, applyHardware: true}`, the same final call as the web
    `finishImport`.
  - New project: confirm, then `POST /api/project/new`.
  - After Load / New: `ProjectSync.reset()`, `Store.set_project`, then re-pull settings + `/api/state` and force a
    deck sync (the web's `startNewProject` / `finishImport`).
  - **Right-click menus** replace the web's Shift+click (owner 20.10: no intricate shortcuts):
    - Save → "Save to file…" writes the server's `file/:slug/download` bytes verbatim. A Godot JSON round trip
      turns every integer into a float, e.g. `"rev": 599.0`.
    - Load → "Load from file…" (also a button in the dialog) posts the file as `save {project, allowReplace}`,
      then loads the returned slug.
  - The notice line takes autosave ok / failed / project-gone (sticky, WO-311) plus action results; it clears after
    6 s.
- **`app/header_tools.gd`** — ⚙ switches to the Settings tab; red FTB posts `/api/ftb {}`.
- **`app/header_status.gd`** — wall clock (HH:MM:SS), left of the perf toggle and eyes.
- **`app/header_model.gd`** — pure helpers (notices, list rows, load reply/notice, file parse).
- Icons `save.svg` / `load.svg` (the web's arrow + disk pair in one 2:1 drawing).

**Verified.**
- Godot suite 16118 passed / 0 failed (new `tests/test_header_model.gd`); file-line gate 0 over.
- Box (screen 0) header reads:
  `logo · HighAsCG · [Untitled] · →💾 · ←💾 · New project · ⚙ · FTB … 20:23:50 · pulse · eyes`.
- Save → "Saved at 20:23". The server's `savedAt` stayed 20:18:19: unchanged content is not rewritten
  (`project-scenes.js:243`, WO-329B).
- The Load dialog listed all server projects, Untitled ● preselected; cancelled.
- The New project confirm was shown and cancelled.
- Right-click Save → Save to file… → `~/Untitled.json` is byte-identical to `GET /api/project/file/untitled/download`
  (`cmp`). The file was removed afterwards.
- **Not exercised on the box** (each one replaces or blacks out the owner's live show): a real Load / Load from file /
  New project, a rename, FTB. Owner-QA.

## 2026-10-20 — Header slice 2: Server ▾, stream/record + replication badges, PGM timer, headphones

**Investigation.** The web gets its data like this:
- **Badges** (`header-bar-streaming.js`): settings `streamOutputs` / `recordOutputs`, plus the live status from
  `GET /api/streaming-channel` and the WS `streaming_channel` event (`routes-streaming-channel-log.js:35`).
- **Replication letter** (`replication-ui-state.js`): polls `/api/replication/status` every 2.5 s, plus WS
  `replication_status`.
- **PGM timer** (`app-pgm-header-timer.js`): the shared `mountPgmTopLayerPlaybackTimer`, which Godot already has as
  `features/live/pgm_timer_view.gd` (WO-600 O, the deck columns). There is one 3-letter chip per screen (WO-506).
- **Headphones** (`header-bar-audio.js`): the upper half picks which browser preview stream plays locally. The Godot
  client plays no stream audio. The lower half (`POST /api/audio/monitor-source`) appears only with a monitor or
  preview bus.
- **Server ▾** (`header-bar-config-strip.js`): `state.configComparison`.

Box state: one screen, `monitorCh` null, `audioPreview.enabled` false; replication standalone; one record output
`rec_1`.

**Done.**
- **`app/header_badges_model.gd`** (pure): `stream_badges` (S/R + number, or the name's initial),
  `replication_badge` (L/F, active / pending / available), `timer_chips`, `monitor_options`, `config_strip`, and the
  web CSS badge colours.
- **`app/header_badges.gd`** — round 24 px badges after FTB. Clicking one opens the Devices tab.
- **`app/header_tools.gd`**:
  - Server ▾ / ▴ opens an opaque popup with the summary, the # / Module expects / Server table, issues and hint.
  - New beyond the web: a mismatch tints the button WARN and the summary is in its tooltip, so the operator sees it
    without opening the strip.
- **`app/header_status.gd`**:
  - Screen chips (only with more than one screen; the choice is kept in `ui.cfg [header] timer_main`).
  - The reused `TimerView` and the wall clock.
  - Headphones (`headphones.svg`, the web's Lucide path) with the server monitor menu. Hidden without a monitor bus.
- `shell.gd` wiring: badges → Devices tab, ⚙ → Settings tab, the OSC mirror → header timer.

**Verified.**
- Godot suite 16143 passed / 0 failed (new `tests/test_header_badges_model.gd`, 25 assertions).
- Box header now reads: `… Server ▾ · ⚙ · FTB · (R1) … PROJECTS/NPCC/TLO ORANGE BALL/B… 0:20 / 0:20 (−0:00)
  [red bar] · 20:29:33 · pulse · eyes`, which matches the web screenshot. Headphones are absent, as expected on
  this box.
- Server ▴ popup: "Server config matches module settings (8 channels). Caspar screen outputs: 1 (ch 1). App
  screens: 1." It shows 8 rows (ch 1 "(screen)") and the INFO CONFIG hint.
- R1 click → Devices tab. ⚙ → Settings tab. Then back to Live.
- **Not exercised on the box:** a live recording turning R1 red, the replication letter, multi-screen chips and the
  monitor menu. This box has no such state; each one is covered by the model tests. Owner-QA.

**Header slice 3 (done 20.10, [WO-629](./629_WO_led_test_card_server_side.md)):** LED test card. Settings + master
switch now live in node (`/api/led-test-card/settings`, `…/master`, `…/channel`); Godot has the checkbox + Test card…
dialog. The web's "Open window ▾" taskbar is replaced by the dock ([WO-628](./628_WO_operator_dock.md)). Also not ported:
the web's "Paired with <peer>" label beside the replication letter.

## 2026-10-20 — Logs window (port plan step 3, logs part)

Owner: logs were the next named slice after the header. Web: `client/components/logs-modal.js` (eye click).

- **`app/logs_dialog.gd`** — non-exclusive "Server logs" window, opened and closed by clicking the connection eyes
  (`connection_eye.gd` emits `clicked`; it now stops the mouse event and shows a hand cursor). HighAsCG pane:
  `GET /api/logs?…&caspar=0&categories=…&levels=…` (node filters), then live WS `log_line` filtered the same way,
  2000-line cap; CasparCG pane: the Caspar log file tailed every 2 s (`highascg=0`), replaced only when it changed;
  toggles for both panes, info / warn / error / debug, Categories ▾ (All + 14, debug off by default), Pause, Copy
  (both panes to the clipboard), Clear HighAsCG (`POST /api/logs/clear`), AMCP line → `POST /api/raw` with the
  command + reply shown under it (an echo inside the pane would be replaced by the next tail).
- **`app/logs_model.gd`** — categories, query, payload → record, filter, capped append; `tests/test_logs_model.gd`
  (same answers as `logs-modal-filter.js`).
- Not ported: the web's Shortcuts tab (owner: no intricate shortcuts in Godot — right-click menus) and the
  Support bundle download (a settings → diagnostics item, next slice).

**VERIFIED (box, 20.10):** eye click opens the window with both panes filled; debug on → the pane reloads with the
`[debug]` WS lines; a second WS client connecting → its `[WS] client connected` lines arrived live; AMCP `VERSION`
→ `<< 2.5.1 886998cc1 Stable` under the input and the command in the Caspar tail; Categories menu shows 13/14
with Debug off; a second eye click closes the window. Godot tests 16209 pass.

## 2026-10-20 — Settings → Diagnostics

Web `settings-modal-diagnostics.js`. **Settings → Diagnostics**: "Save support bundle…" (`GET /api/support/bundle`;
the server's `Content-Disposition` filename is offered in a Save dialog — `Api.get_bytes` now returns the response
headers, `settings_model.attachment_name` strips any path parts; `file_pick.gd` gained `write_bytes` and a filter
argument on `save_path`) and "Open server logs" (the logs window above).

**VERIFIED (box, 20.10):** Save → the dialog offered `highascg-support_highascg7580_2026-10-20T22-20-21-753Z.zip`;
saved 469 KB, `unzip -l` lists the 12 members; status line "Saved … (469 KB)"; "Open server logs" opens the logs
window. Godot tests 16213 pass.

## 2026-10-20 — Settings → Updates + nuclear password prompt

- **`features/settings/updates_pane.gd`** (+ `updates_model.gd`, tests in `test_settings.gd`) — web
  `settings-modal-system-updates.js`: build stamp (`GET /api/system/version`), USB / bridge drop-update line, GitHub
  check (`/api/system/update/check`, Check now = `?force=1`), Install latest release behind a confirm →
  `POST /api/system/update/apply {confirm}` and the apply log polled every 1.5 s (`/api/system/update/status`; a log
  in progress is picked up when the pane opens).
- **`app/nuclear_gate.gd`** (+ pure `nuclear_model.gd`, `tests/test_nuclear_model.gd`) — every nuclear-gated POST:
  on 403 "Invalid password." / `passwordRequired` ask for the password, retry with `body.password`, keep a working one
  in memory for the session; "… not configured." is not asked (cannot succeed). Used by Install and the dock (closes
  the WO-628 open item); the next nuclear-gated panes (System, DeckLink, Tailscale, Nuclear) reuse it.

**VERIFIED (box, 20.10):** Updates shows 2026.05.20, "USB exFAT: not mounted · Bridge drop: — · retain mode", "Latest:
2026-10-04T033256Z — update available (cached)" → Check now drops "(cached)"; Install opens the confirm — **Cancel
pressed, nothing installed** (status `{"active":false}`; this dev box runs from git). Gate: temporary password via
`POST /api/settings` → dock File browser → prompt → "wrong" → "Wrong password — try again." → right one → thunar
opened (`dock file-manager → 200`), closed again; password removed, `config/ui.json` byte-identical to the backup.
Godot tests 16231 pass.

## 2026-10-20 — Settings → Nuclear

**Investigation.** Web `settings-modal.js:120-205` (+ `settings-modal-logic.js`): Require-password checkbox +
password field, then host actions (restart WM, reboot, shut down), Calamares install, Caspar stop/start/restart, with
status from `GET /api/system/setup` (`casparService`, `calamares`). Building it found WO-611 #6: the settings GET
redacted the *boolean* `ui.nuclearRequirePassword`, so every client showed it off (fixed `7e313ca2`). The
password and hash stay `'[REDACTED]'`; the shared `Form.text()` would hydrate that string and post `""` on focus exit.

**What was done.**
- `settings_panes.gd` `nuclear(f)`: the checkbox via `Form.check`; the password row is a dedicated secret LineEdit
  (not `Form.text`) that posts only non-empty typed text and then clears itself — the redacted value is never
  shown or sent back. The row only shows while the requirement is ticked.
- `features/settings/nuclear_pane.gd`: the action buttons, each behind a ConfirmationDialog (also the WM restart,
  which closes this GUI; Caspar start has none, like the web) and `NuclearGate.post` (password prompt on 403).
  Caspar status line + Install enabled only when Calamares is installed with sudo launch, with a tooltip saying why
  not. Caspar actions re-read the status after 0 / 3 / 30 s. **Cancel gets the default focus** (a stray Enter must
  not reboot the box); the same was applied to the Updates → Install confirm.
- `settings_tab.gd`: `Nuclear` tab between Diagnostics and About.

**What was VERIFIED (box, 20.10).** Godot tests 16231/0. Pane shows "Caspar scanner: active · server: active",
Install enabled (Calamares installed). Ticking the checkbox → `ui.json` `nuclearRequirePassword: true`; typing
`t3st` + Enter → `nuclearPasswordHash: scrypt$…`, field cleared. Start CasparCG (no-op on active units —
`caspar-systemd-control.sh start` only `systemctl start`s) → password prompt; wrong → "Wrong password — try again.";
right → journal `sudo … caspar-systemd-control.sh start`, pane "Done.". Reboot → confirm with Cancel focused →
Cancel (uptime unchanged). `ui.json` restored byte-identical (`cmp`). NOT pressed: WM restart, reboot, shut down,
install, Caspar stop/restart (owner checklist).
