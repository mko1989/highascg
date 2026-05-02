# Work Order 29: USB Drive Media Ingest

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Give the end user a **dead-simple, one-click** way to copy media files from a **USB drive** attached to the HighAsCG / CasparCG production machine into the application's media folder (`local_media_path`, default `/opt/casparcg/media` on Linux). No terminal, no file manager — just plug in, pick, and go.

Primary UX target: field operator with no Linux experience, working from the web UI over LAN.

## Success Criteria

1. When a USB stick is plugged into the server, the web UI **detects it automatically** and shows it in a new "Import from USB" entry inside the existing Sources panel **+ (Add Media)** drop-up menu.
2. The user can browse the USB's folder tree, select one or many files (or a whole folder), and click **Import**.
3. Files are copied (not moved) into the media folder with a **live progress bar** and **ETA**, resilient to large files (200 GB+ ProRes).
4. On completion, media library refreshes; imported clips immediately appear in the sources panel.
5. **Safe eject** button unmounts the stick cleanly; UI confirms when it's safe to remove.
6. All operations authorised and path-sandboxed; no access outside the mount point and the media folder.
7. Works on headless Ubuntu (production target). Degrades gracefully on macOS/dev laptops (best-effort detection, or disabled with a clear message).

---

## Current State

- `src/api/routes-ingest.js` already implements:
  - `POST /api/ingest/upload` (busboy, streaming, zip auto-extract)
  - `POST /api/ingest/download` (HTTP + WeTransfer URL downloads)
  - `GET /api/ingest/download-status` (poll background progress)
- Web UI (`web/components/sources-panel.js`) has the **+ (Add Media)** drop-up with “Select File(s)” and “Paste URL”.
- Media folder resolution lives in `src/media/local-media.js` → `getMediaIngestBasePath(config)`; sandbox via `resolveSafe`.
- There is **no USB awareness** today — users must either:
  - SSH in and `cp` files manually, or
  - Carry files to their laptop first and use the browser upload (slow, doubles transfer time).

---

## Architecture

### 1. USB detection (Linux / Ubuntu target)

Ubuntu auto-mounts USB drives under `/media/<user>/<label>` (GNOME/udisks2) or `/run/media/<user>/<label>` depending on desktop session. For the headless production install we need to guarantee auto-mount. Two options:

- **Preferred:** rely on **`udisks2`** (already present on Ubuntu desktop, installable via `apt install udisks2`) with a tiny helper using `udisksctl` for mount/unmount and `lsblk --json -o NAME,LABEL,SIZE,MOUNTPOINT,HOTPLUG,TRAN,RM,FSTYPE` for enumeration.
- **Fallback:** poll known mount prefixes (`/media/*`, `/mnt/*`, `/run/media/*`) every ~2s and diff.

New server module **`src/media/usb-drives.js`**:
- `listUsbDrives()` → `[{ id, label, mountpoint, size, fsType, removable, readOnly }]`
- `listDirectory(driveId, relPath)` → entries scoped to the mount root (uses `resolveSafe` logic)
- `copyFromUsb(driveId, items, { onProgress })` → streams each file to `getMediaIngestBasePath(config)` with per-file + overall progress
- `ejectUsb(driveId)` → `udisksctl unmount` + `power-off`

WebSocket push: broadcast `usb:attached`, `usb:detached`, `usb:copy-progress` via `ws-server` so the UI reacts instantly without polling once it's loaded.

### 2. REST API (`src/api/routes-usb-ingest.js` [NEW])

| Method | Path | Body / Query | Purpose |
|--------|------|--------------|---------|
| GET  | `/api/usb/drives` | — | List currently mounted USB drives |
| GET  | `/api/usb/browse` | `driveId`, `path` | List files/folders inside a drive |
| POST | `/api/usb/import` | `{ driveId, items:[paths], targetSubdir? }` | Queue a copy into media folder |
| GET  | `/api/usb/import-status` | — | Poll progress (mirrors `download-status`) |
| POST | `/api/usb/eject` | `{ driveId }` | Safely unmount + power off the drive |

Register in `src/api/router.js` alongside `routes-ingest.js`. Reuse `setDownloadState`-style pattern for progress (or unify under a generic `ctx._ingestJobState`).

### 3. Web UI

Keep the discoverable pattern users already know: the **+ drop-up** in the sources panel.

- Add new item **"📼 Import from USB…"** to the drop-up.
  - Disabled with hint "No USB drive detected" when the list is empty.
  - Badge with drive count when present.
- Clicking opens a new modal component **`web/components/usb-import-modal.js`**:
  - Left: drive picker (label, size, free space, fs type).
  - Centre: folder-tree browser + selectable file list with checkboxes + "Select all videos/images" shortcut.
  - Right: summary (count, total bytes, estimated time at measured copy rate).
  - Bottom: **Import** (primary), **Safely eject** (secondary), **Cancel**.
- Progress pane (reuse styling from `ingest-upload-progress`):
  - Per-file + overall bars, current file path, MB/s, ETA.
  - Cancel button cleanly stops and removes partially-copied file.
- Success toast: "Imported N files (X GB)" + link to media tab.
- Auto-refresh drive list from WebSocket events; fall back to `GET /api/usb/drives` every 5 s.

### 4. Settings

Add to the Settings modal under a new **"Media / USB"** section:
- `usb_ingest_enabled` (default `true`).
- `usb_ingest_default_subfolder` — template like `usb/{label}/{date}`; blank → flat copy.
- `usb_ingest_overwrite_policy` — `skip | overwrite | rename` (default `rename`, appending `_N`).
- `usb_ingest_verify_hash` (default `false`) — optional sha1 post-check for critical installs.

Persist via existing `config/default.js` + settings routes.

### 5. Production / OS setup

Update **WO-11 Boot Orchestrator** and **`install-phase4.sh`**:
- `apt install -y udisks2 policykit-1` in production install.
- Add a polkit rule so the headless service user can `udisksctl mount/unmount/power-off` without sudo password. Ship rule at `/etc/polkit-1/rules.d/50-highascg-udisks.rules`.
- Ensure the HighAsCG service user is in the `plugdev` group.
- Document in `docs/MANUAL_INSTALL.md`.

---

## Code map

| Concern | File / area |
|---------|-------------|
| USB enumeration / mount / copy | `src/media/usb-drives.js` [NEW] |
| REST endpoints | `src/api/routes-usb-ingest.js` [NEW] |
| Router wiring | `src/api/router.js` (+5 lines) |
| WebSocket broadcast | `src/server/ws-server.js` (new events) |
| Media folder resolution (reuse) | `src/media/local-media.js` (`getMediaIngestBasePath`, `resolveSafe`) |
| Settings schema | `config/default.js`, `src/api/routes-settings.js` |
| Install helpers | `scripts/install-phase4.sh`, `docs/MANUAL_INSTALL.md` |
| Drop-up menu hook | `web/components/sources-panel.js` |
| Import modal | `web/components/usb-import-modal.js` [NEW] |
| Styles | `web/styles/08-modals-settings-logs-misc.css`, `web/styles/03a-offline-sync-publish-ingest-menu.css` (badge) |

---

## Tasks

### Phase 1 — Server foundation
- [x] **T29.1** Create `src/media/usb-drives.js` with `listUsbDrives()` (lsblk/udisks) and cross-platform shim (macOS = `/Volumes/*` read-only, clearly marked).
- [x] **T29.2** Implement `listDirectory(driveId, relPath)` with path sandboxing to the mount root (reuse `resolveSafe` pattern).
- [x] **T29.3** Implement `copyFromUsb(..)` with streamed `fs.createReadStream → createWriteStream`, per-file and total byte progress, cancellation token, overwrite policies.
- [x] **T29.4** Implement `ejectUsb(driveId)` via `udisksctl unmount && udisksctl power-off`; surface user-friendly errors ("Drive busy, close any open previews").
- [x] **T29.5** Add a udev/udisks watcher (or 2-second poll fallback) that emits `usb:attached` / `usb:detached` to the WS layer.

### Phase 2 — API & WebSocket
- [x] **T29.6** Create `src/api/routes-usb-ingest.js` with the five endpoints above; reuse progress-state pattern from `routes-ingest.js`.
- [x] **T29.7** Wire routes in `src/api/router.js`.
- [x] **T29.8** Broadcast `usb:*` via `ctx._wsBroadcast` (WebSocket server); include throttled progress payloads for live bar updates.
- [x] **T29.9** Add settings keys (`usb_ingest_enabled`, `usb_ingest_default_subfolder`, `usb_ingest_overwrite_policy`, `usb_ingest_verify_hash`) to `config/default.js` and the Settings modal.

### Phase 3 — Web UI
- [x] **T29.10** Extend `web/components/sources-panel.js` drop-up with **"📼 Import from USB…"** item + drive-count badge + empty-state hint.
- [x] **T29.11** Build `web/components/usb-import-modal.js` (drive picker, folder tree, multi-select file list, summary, progress, eject).
- [x] **T29.12** Wire modal to WebSocket `usb:*` events + REST; refresh media library on completion (no separate client state module).
- [x] **T29.13** Add styles (glass/dark-mode consistent) in `web/styles/08-modals-settings-logs-misc.css`.
- [x] **T29.14** Add keyboard shortcuts: `Enter` to import, `Esc` to cancel/close.

### Phase 4 — OS / production install
- [x] **T29.15** Add `udisks2 policykit-1` to `scripts/install-phase4.sh` and manual install doc.
- [x] **T29.16** Ship polkit rule `/etc/polkit-1/rules.d/50-highascg-udisks.rules` allowing the service user to mount/unmount/power-off removable media.
- [x] **T29.17** Ensure service user is in `plugdev`; document recovery steps if auto-mount fails.

### Phase 5 — Verification
- [x] **T29.18** Unit test `listUsbDrives()` against recorded `lsblk --json` fixtures (Ubuntu 22.04, 24.04).
- [ ] **T29.19** Manual test: FAT32 stick with mixed media, exFAT with 200 GB ProRes, read-only ISO, write-protected SD card (graceful error).
- [ ] **T29.20** Verify safe-eject while playback is running — expect clear "device busy" message when CasparCG holds a file open.
- [ ] **T29.21** Verify Sources panel auto-refreshes after import and that clips play.
- [x] **T29.22** Accessibility pass: modal focus trap, screen-reader labels on drives and progress.

---

## Technical Considerations

- **Large files:** use 1 MiB stream buffers; never `fs.readFile` whole clips. Throttle progress WS events to ~4/sec to avoid flooding.
- **Concurrency:** single copy job at a time (queue additional imports); enforced server-side.
- **Path safety:** every USB path sandboxed to its mount root; destination paths sandboxed via `resolveSafe` to the media folder.
- **Permissions:** some USB sticks carry files owned by `root` or with `0o000` masks; copy reads with elevated perms via udisks/polkit only, never shell out as root.
- **Disk space:** pre-flight check — reject import if `statfs(mediaBase).available < totalBytes * 1.05`, surface tidy error.
- **Cross-platform:**
  - Linux (prod): full feature set.
  - macOS (dev laptop): enumerate `/Volumes/*`, support copy + (best-effort) `diskutil eject`. OK if polish lags behind Linux.
  - Windows: not required for v1 (out of scope; explicit "Unsupported" state).
- **Security:** if `usb_ingest_enabled === false`, endpoints return 403. Rate-limit `GET /api/usb/browse` to avoid FS walk DoS.

---

## Out of scope (v1)

- Network shares (SMB/NFS) — could extend in a future WO.
- On-the-fly transcode during import (keep source, transcode later via existing pipeline).
- Multi-drive parallel imports.
- Windows support.

---

## Work Log

### 2026-04-22 (b) — Agent (T29.22 a11y)

**Work Done:** `usb-import-modal.js` — `aria-live` announcer for copy progress, `role="progressbar"` on bar, `aria-label` on listbox, focus trap (Tab) within dialog, restore focus on close, first focus on drive `select`.

### 2026-04-22 — Agent (Implementation v1)

**Work Done:**
- Shipped `src/media/usb-drives.js` (lsblk + `/media` fallback, macOS `/Volumes`, browse sandbox, streamed copy + cancel + SHA1 optional, eject via udisks/diskutil, 2s WS hotplug poll).
- `src/api/routes-usb-ingest.js` + router; `config.default.usbIngest`; Settings **Media (USB)** tab; `index.js` watcher lifecycle.
- UI: Sources **+** menu **Import from USB**, badge, `usb-import-modal.js`, styles; `npm run smoke:usb-lsblk` fixture test.
- `install-phase4.sh` + `scripts/polkit/50-highascg-udisks.rules` + MANUAL_INSTALL note.

**Status:** Core feature complete. T29.19–T29.22 = field QA / a11y.

**Instructions for Next Agent:** Run manual T29.19–T29.21 on Ubuntu with a real stick; tighten a11y (focus trap) if needed.

### 2026-04-21 — Agent (Initial Work Order)

**Work Done:**
- Surveyed existing ingest architecture (`routes-ingest.js`, sources panel `+` menu, `local-media.js`) and `install-phase4.sh` to align with existing patterns.
- Drafted scope, architecture, endpoints, UX, tasks, and production-install requirements.

**Status:** Work order created. Implementation pending.

**Instructions for Next Agent:** Start with Phase 1 (T29.1–T29.5). Prototype `listUsbDrives()` against `lsblk --json` on the target Ubuntu production machine first; that unblocks both the API and the UI modal.

---
*Work Order created: 2026-04-21 | Series: HighAsCG operations | Parent: 00_PROJECT_GOAL.md*
