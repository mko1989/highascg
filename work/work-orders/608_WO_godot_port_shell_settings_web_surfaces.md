**Status: IN PROGRESS (2026-10-18) — R1–R4 shell layout DONE (box-verified 18.10, below); R5 look thumbnails, settings/logs/modals open. D1/D2 decided by the owner 17.10 (below); D3 defaults to the recommendation. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599.**

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
| Settings modal (no Save button, 600 ms whole-object autosave) | tabs: defaults, companion, media/usb, updates, system, decklink, diagnostics, tailscale, live audio (+ ALSA mixer), **nuclear** (password option), variables |
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

Open: R5 look thumbnails; Inspector modes (Layer presets / Look presets) and the bottom Playlists / Timers /
Program audio strip; settings / logs / project modals (plan steps 2–4).
