**Status: OPEN (2026-10-17) — investigation + plan written; D1/D2 decided by the owner 17.10 (below); D3 defaults to the recommendation. Parent: [WO-593](./593_WO_godot_client_port_epic.md). Depends on: WO-599.**

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

## Port plan

1. Shell + header + tabs + connection eye + toasts (with WO-599 kit).
2. Settings modal tabs (forms on the shared kit; autosave semantics identical).
3. Logs (virtualized list), project load/new/reset/reconcile, USB import.
4. Optional-module mechanism; CG Studio launcher per D2.

## Acceptance

Parity checklist `work/godot-port/parity/shell-settings.md` (inventory bullets), owner-ticked;
settings changed in Godot appear in the web client and vice versa.

## What was done / What was VERIFIED

Nothing yet. Orphan status, token file and font verified by hand; rest is the Haiku inventory.
