# Work order: Remove persistence partition workflow (exfat-only)

## Goal
Eliminate the “persistence partition” workflows that add huge latency / bottlenecks on live systems.

After this change, HighAsCG must rely **only on the exFAT volume** for durable storage and syncing of configuration/state. No extra persisted partitions should be mounted or waited on at boot.

## Scope
### Remove / disable
1. **WO-38 persisted media partition mount** (`mediaMount.uuid` → mount `/home/casparcg/highascg/media/drive`).
2. **Live-USB union persistence partition** workflow (docs + build/run instructions that add/enable `/ union` persistence).

### Keep
1. **exFAT mount + exFAT mtime/config sync** (WO-47).  
   In this repo, state persistence already maps through `config/exfat-sync.json` (e.g. `.highascg-state.json`, `.module-state.json`).

## Why this is urgent
- The persisted partition mount step is a major bottleneck on a live playout system.
- Operator workflow needs to be predictable: **mount exFAT quickly** and run the server without waiting for “persistence” mounts.

## Implementation tasks (code)
### A) Remove persisted media partition support (WO-38)
1. Delete/retire these modules and references:
   - `src/system/media-partition-mount.js` (and anything it exports)
   - `src/api` handlers for `/api/system/media-mount/*` and any related storage endpoints used by the UI
2. Remove startup waiting:
   - In `index.js`, remove the `mediaMountStartupPromise` path and the call to `ensurePersistedMediaPartitionMounted()`.
3. Remove config surface:
   - In `src/config/defaults.js`, remove `mediaMount` config block and any mentions of `/home/casparcg/highascg/media/drive`.
   - In `src/config/config-manager.js`, remove `mediaMount` as a modular key (if present).
4. Remove helper scripts / privileged install artifacts:
   - Remove `scripts/highascg-media-mount.sh`
   - Remove `scripts/sudoers.d/highascg-media-mount` and the install-phase4 tmpfiles / sudoers install in:
     - `scripts/install-phase4.sh`
5. Remove/adjust settings UI:
   - Any UI that can mount/call into `/api/system/media-mount` must be removed or hidden.

### B) Ensure exFAT-only durable persistence works
1. Confirm `config/exfat-sync.json` includes:
   - `.highascg-state.json` ↔ `configs/.highascg-state.json`
   - `.module-state.json` ↔ `configs/.module-state.json`
2. If any code reads any persisted mediaMount state, update it to use the exFAT-backed paths only.

## Implementation tasks (docs + operator tooling)
### A) Remove union persistence references from operator docs
Update/remove any documentation that instructs building/booting with “Live with persistence” via union `/ union` persistence.

The most relevant docs in this repo right now:
- `docs/LIVE_USB_IMAGE.md`
- `docs/ISO_CONTENTS.md`
- `docs/WO47_ISO_VS_EXFAT.md`
- `work/LIVE_ISO_BUILD_FIXES.md`
- `work/work-orders/47_WO_EXFAT_DATA_MOUNT_AND_MTIME_BOOT_SYNC.md` (references union persistence carving discipline)

Additionally, remove references to the referenced helper scripts:
- `tools/eggs/live-usb/add-union-persistence-partition.sh`
- `tools/eggs/live-usb/FLASH_AND_PERSIST.md`
- any mention of `BUILD_AND_FLASH.md` / “Live with persistence” menu entries

Even if `tools/eggs/**` is not present in this snapshot, the docs clearly reference it and must be cleaned.

### B) Remove WO-38 docs references to `/home/casparcg/highascg/media/drive`
Update/remove references in:
- `docs/LIVE_USB_IMAGE.md`
- `docs/HIGHASCG_PASSWORDLESS_SUDO.md`
- `docs/MANUAL_INSTALL.md`
- `work/work-orders/38_WO_MEDIA_PARTITION_MOUNT_LIVE_USB.md`

## Migration strategy / backward compatibility
1. If older configs still contain `mediaMount.uuid`, ignore it safely:
   - log a warning: mediaMount is no longer supported; use exFAT only.
2. If older sticks were built expecting union persistence:
   - operator guide should switch to “plain Live + exFAT mount + exFAT sync”.

## Validation plan
1. Boot on a live system with exFAT mounted (HIGHASCGEXF), verify:
   - HighAsCG starts without waiting on any `mediaMount` partition
   - AMCP connects promptly
2. Run a save/reload test:
   - verify `.highascg-state.json` persists through exFAT sync and reloads correctly.
3. Measure restart time:
   - `systemctl restart highascg` should drop from “minute(s)” to “about a second” (target: <5s end-to-end).
4. Verify media path:
   - confirm media used by scenes/CLS is on the exFAT-backed location (no reliance on `/home/casparcg/highascg/media/drive`).

## Acceptance criteria
- No systemd/node startup step mounts or waits for a persistence partition beyond exFAT.
- Operator docs no longer mention union persistence `/ union` workflow.
- `mediaMount` / `/home/casparcg/highascg/media/drive` workflow is fully removed or documented as unsupported.
- exFAT config/state syncing remains functional.

## Work log

### 2026-05-28 — Agent (USB tooling)

**`finish-operator-stick.sh` / `create-operator-stick-from-dd.sh`:** exFAT-only by default (`HIGHASCG_EXFAT_ONLY=1`); always prune `persistence` + exFAT before recreating HIGHASCGEXF on MBR slot 3. **`add-union-persistence-partition.sh`** requires `HIGHASCG_LEGACY_UNION_PERSIST=1`. GRUB/isolinux themes: removed `persistence` kernel param. **`repair-stick-exfat-only.sh`** for sticks already flashed with persistence.

### 2026-05-27 — Agent (implementation)

**Code removed:** `src/system/media-partition-mount.js`, `src/system/block-devices.js`, `src/api/routes-system-storage.js`, `scripts/highascg-media-mount.sh`, `scripts/sudoers.d/highascg-media-mount`, `config/media_mount.json`. Startup no longer waits on partition mount (`index.js`). API/settings no longer expose `mediaMount`. `install-phase4.sh` no longer installs WO-38 helpers or creates `media/drive`. Legacy `mediaMount.uuid` in config logs a one-time warning and is stripped (`config-manager.js`).

**Docs updated:** `docs/LIVE_USB_IMAGE.md` (§6–7 exFAT-only), `docs/ISO_CONTENTS.md`, `docs/HIGHASCG_PASSWORDLESS_SUDO.md`, `docs/MANUAL_INSTALL.md`, `work/LIVE_ISO_BUILD_FIXES.md`. `38_WO_…` marked superseded.

**Not validated on hardware:** `systemctl restart highascg` timing, exFAT save/reload on test laptop.

**Instructions for next agent:** Run field validation (§ Validation plan). Grep `tools/eggs/**` on build host for stale union/WO-38 script references if that tree exists outside this snapshot.

## Instructions for next agent
1. Implement the code removal (WO-38) first, then update docs.
2. Run a real boot/restart validation on the target “test laptop” rig to ensure startup ordering and transition/media loading still work.

