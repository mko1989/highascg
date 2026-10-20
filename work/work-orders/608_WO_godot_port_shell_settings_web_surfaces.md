**Status: IN PROGRESS (2026-10-19) — owner layout rules R1–R5 DONE (box-verified 18.10, below); Settings slice 1 (Defaults / Companion / Media-USB) DONE 19.10; other settings tabs, logs and modals open. D1/D2 decided by the owner 17.10 (below); D3 defaults to the recommendation. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599.**

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

Not ported yet (next slices): updates, system (hardware / mounts), decklink, diagnostics, Tailscale, live audio (+ ALSA
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
