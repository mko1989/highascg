# WO-432 — Remove Settings→USB video tab; produce writes BUILD_STAMP; produce restores node_modules

**Status: DONE (2026-08-05 — client rebuilt + kiosk reloaded; suite 1835/0/2, lint 0 errors (216 warn), unwired-exports clean; stamp+restore land on the NEXT produce run)**

Owner 05.08 (three asks):
1. "in the settings modal. there is a usb video tab. no idea what its supposed to do, remove it."
2. "the server stamp in the updates is old 26.05.20 when it was built this morning"
3. "add to the final step of build-produce-flash-stick.sh npm install so the build machine
   is back on track after eggs" (the WO-430-era discovery: produce prunes the live tree).

## Investigation

**USB video tab** — WO-121's V4L2 settings panel (`settings-v4l2-inputs-panel.js`,
mounted from `settings-modal.js` on `data-tab="usb-video"`). Redundant with the
device-view input tiles: add goes through Sources → Live modal (`v4l2-add-input.js`),
remove through the inspector tiles (`inspector-v4l2-input.js`,
`device-view-destinations-inspector-host-channel.js` → `v4l2-remove-input.js`).
Matches the standing rule that per-input controls live in the device-view inspector
(Sources-tab/no-inspector decision). No smoke pinned the tab (WO-284's "USB video 1"
is fixture data only).

**Stale server stamp** — `src/system/build-stamp.js` reads `BUILD_STAMP` →
`.highascg-build-stamp` → package.json version. The repo root has NO `BUILD_STAMP`;
the legacy `.highascg-build-stamp` holds `2026.05.20` (== package.json `version`,
written 03.07). Only `tools/release/make-github-release-server.sh` ever writes a fresh
`BUILD_STAMP` (and trap-deletes it after tarring) — **the eggs produce chain
(`build-produce-flash-stick.sh` → `build-highascg-egg.sh` → `install-iso-defaults.sh`)
never wrote any stamp**, so every ISO ships the May date and fresh installs report
26.05.20 in Updates. The exclude fragments explicitly do NOT mask BUILD_STAMP
(embed-server list line ~100), so a stamp written at produce time rides into the squashfs.

## What was done

- **Tab removed**: template button + pane (`settings-modal-templates.js`), mount wiring
  + import + state vars (`settings-modal.js`), and the now-orphaned
  `client/components/settings-v4l2-inputs-panel.js` deleted (only importer was the
  modal; unwired-exports gate confirms no new orphans). The max-slots error in
  `v4l2-add-input.js` repointed from "Settings → USB video" to the device-view tile.
  Server-side V4L2 (WO-121) untouched — add/remove still fully wired via Sources → Live
  and inspector tiles.
- **`tools/eggs/live-usb/build-produce-flash-stick.sh`**: before Phase 1 it now writes
  `BUILD_STAMP` = `date -u +%Y-%m-%d_%H%M%S` (release-stamp format; WO-424's comparator
  normalizes separators) to the repo root, chowned to the repo owner.
- Same script, right after the produce: `npm install --include=optional` as the repo
  owner (runuser) restores the dev tree the produce pruned — placed after Phase 1, not
  after flashing, so `--build-only` and a failed flash still restore the box.
- `.stignore`: `BUILD_STAMP` added (machine-local; **owner: mirror the line on the Mac**,
  .stignore does not sync).

## What was VERIFIED to work

- `npm run build:client` clean; kiosk reloaded (`DISPLAY=:0 xdotool key F5`).
- Suite 1835/0/2; `check-unwired-exports` 1086 files, no new orphans; lint 0 errors
  (216 warnings — deleting the panel dropped 2); prettier clean; `bash -n` on the build
  script clean.
- Residual grep for `usb-video` / `usbVideo` / `settings-v4l2-inputs-panel`: zero hits.
- NOT yet proven: stamp + restore in a real produce (next run). The 05.08 10:32 ISO
  predates this — machines installed from it still show 26.05.20 until re-produced or
  drop-updated.

## Owner QA

- [ ] Settings modal: USB video tab gone; add/remove USB inputs still works via
      Sources → Live + device-view tiles.
- [ ] Next produce: console shows `==> BUILD_STAMP=…` and ends the build phase with the
      npm restore; a machine installed from that ISO shows the produce date in Updates.
- [ ] Mirror `BUILD_STAMP` into the Mac's .stignore.
