# WO-413 — USB drives auto-mount on plug-in (todos03.08.26 addition)

**Status: DONE pending owner QA (2026-08-03 — watcher live on the box, polkit authorization
verified via pkcheck; owner: plug a stick (or two) and watch them appear in USB import)**
**Priority:** High (owner: "usb drives auto mount doesnt work. its neccesery so operators can
plug a drive in and import media without going into terminal to mount it. it needs to support
multiple drives/mounts.")
**Source:** `work/work-orders/todos03.08.26`
**Related:** WO-29 (USB media ingest — enumeration, sandboxed browse, streamed copy, eject,
polkit setup script), `docs/USB_AUTO_MOUNT_UBUNTU.md`

## 1. Investigation

- The WO-29 stack already had everything EXCEPT the "auto" part: `src/media/usb-drives.js`
  enumerates unmounted removable partitions (`listRemovableBlockDevices`), mounts on demand
  via `udisksctl mount --no-user-interaction` (`mountUsbBlockDevice`, → `/media/casparcg/<label>`),
  browses/copies/ejects, and `startUsbHotplugWatcher` broadcasts `usb:attached`/`usb:detached`
  over WS. **But mounting only ever happened from a UI click** — plug a drive and nothing
  mounts, which is exactly the owner's complaint. Nothing in the repo installed an OS-level
  automount either (no udev rule; the exfat udev family is bridge-disk-specific).
- **Polkit is NOT the blocker on this box**: `pkcheck --action-id
  org.freedesktop.udisks2.filesystem-mount --process $$` → exit 0 (and `…-other-seat` → 0)
  as user `casparcg`, so the WO-29 rules authorize udisks mounts. udisks2 + polkit services
  active. (If a future box denies: `sudo bash scripts/setup/13-usb-ingest.sh casparcg`.)
- No physical USB drive was available during this session (`lsblk`: only nvme + the bridge
  exFAT), so the end-to-end plug test is owner QA.

## 2. What was done

Node-side auto-mount watcher (chosen over a udev rule: reuses the tested udisks2 path, needs
no root install step, mounts land where ingest browse/import/eject already look, works for
any number of drives, and eject stays safe — see state machine):

- **`src/media/usb-automount.js` (new)** — `startUsbAutoMount(ctx, options)`: every 3 s,
  unmounted removable filesystem partitions → `mountUsbBlockDevice()` each. Per-device state
  (kept while the device is physically present):
  - success → `done`: if the operator **ejects**, the partition becomes "unmounted candidate"
    again but is NOT remounted — the drive can be pulled after eject. Unplug clears state;
    replug mounts fresh.
  - failure → backoff 30 s × attempts (cap 5 min); polkit denial → 10 min backoff + the
    setup-script guidance in the log (no retry spam).
  - success also broadcasts `usb:automounted` over WS (the existing hotplug watcher fires
    `usb:attached` when the mount appears, so the ingest UI updates as before).
  - Config gate `usbIngest.enabled` / `usbIngest.autoMount` re-read every tick — flipping the
    setting needs no restart. Injectable deps (`listCandidates`/`listMounted`/`mount`) for
    offline tests. Linux-only.
- **`index.js`** — started next to the hotplug watcher (`appCtx._stopUsbAutoMount`);
  **`src/bootstrap/shutdown.js`** stops it.
- **`src/config/defaults-core.js`** — `usbIngest.autoMount: true`.
- **`src/api/settings-post.js`** — usbIngest sanitizer passes `autoMount` through (it rebuilds
  the object field-by-field and would have eaten the key — same class of bug as the WO-406
  `role` incident).
- **`client/components/settings-modal-logic.js`** — modal save carries the stored `autoMount`
  forward (no new UI control per the minimalism principle; without this every modal save
  re-enabled auto-mount).
- **`tools/smoke/smoke-wo413-usb-automount.test.js` (new, in the CI FILES list)** — 7 tests:
  multi-drive mount, fs-less partition skip + WS broadcast, eject-is-not-replug state machine,
  failure backoff, live config gate, wiring/defaults/sanitizer/modal source pins.

## 3. What was VERIFIED to work

- Offline suite **1798 pass / 0 fail / 2 skip** (1800 tests) including the 7 new tests;
  file-line limit clean.
- Live: node restarted with the watcher running (silent — correctly nothing to mount with no
  drive plugged); polkit authorization for udisks2 mounts confirmed via pkcheck as above.
  Client rebuilt + kiosk reloaded.
- **Owner QA:** plug one drive → appears mounted in USB import within ~3 s without any
  terminal; plug a second drive → both usable; eject from the UI → drive does NOT remount
  until replugged.
