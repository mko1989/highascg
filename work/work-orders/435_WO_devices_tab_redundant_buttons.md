# WO-435 — Devices tab: remove redundant Refresh / Save snapshot / Load snapshot buttons

**Status: DONE (2026-08-06 — suite 1842/0/2, built + kiosk F5; buttons verified absent from the dist-web device-view chunk)**

Owner (todos06.08.26 item 5): "in the devices tab the buttons refresh (already done on each
devices tab click in), save and load snapshot (should already be part of project file) are
redundant, remove them."

## Investigation

- The three buttons lived in the Devices-tab header:
  `client/components/device-view-toolbar.js` created `refreshBtn` / `saveSnapBtn` / `loadSnapBtn`
  and returned them from `buildDeviceViewShell()`; `client/components/device-view-events.js`
  was their ONLY consumer (handlers at the old lines 46–58).
- Redundancy confirmed:
  - **Refresh** — tab activation already calls `ctx.load()` (device-view.js), and every
    config-changed signal (`highascg-settings-applied`, `highascg-device-view-reload`,
    add-destination, config-modal apply) forces a refresh — guarded by
    `tools/smoke/smoke-device-view-reload-forces-refresh.test.js`, which pins ctx.load
    call PATTERNS, not the button, so removal does not touch it.
  - **Save/Load snapshot** — hardware snapshots ride in the project file; the snapshot modals
    (`device-view-snapshot-modals.js`) remain reachable through
    `project-hardware-reconcile-modal.js` (its import keeps the module alive), so nothing else
    breaks.
- Grep sweep: no smoke test pins the strings `Save snapshot` / `Load snapshot` or the
  `refreshBtn`/`saveSnapBtn`/`loadSnapBtn` refs outside these two files (other `refreshBtn`
  hits are unrelated components: sources panel, multiview editor, companion settings).

## What was done

- `device-view-toolbar.js`: dropped the three button creations, their `actions.append(...)`
  entries, and their keys from the returned refs object.
- `device-view-events.js`: dropped the three handlers, the refs destructure entries, and the
  now-unused `device-view-snapshot-modals.js` import.

## Verified

- Offline suite: **1844 tests, 1842 pass, 0 fail, 2 skipped** (the 2 skips are the CI=1
  server-spawn tests, standing).
- `npm run build:client` clean; `dist-web` device-view chunk no longer contains
  `Save snapshot`, still contains the kept `Reset all cabling`.
- Kiosk reloaded (`DISPLAY=:0 xdotool key F5`). Owner eyeball on the header remains.

## Incidental find (fixed in the same session, separate concern)

The working tree carried an UNCOMMITTED 2-line deletion in `src/api/system-hardware-decklink.js`
that removed WO-433's `~/Downloads` vendor-scan entry (committed only yesterday, 4f298c3) and
turned the WO-433 smoke red. No session touched that file — this is the Syncthing peer-revert
signature (a peer holding the pre-WO-433 file overwrote the working tree; cf. the WO-354-era
shader fight). Restored via `git checkout -- src/api/system-hardware-decklink.js`; WO-433 smoke
green again (4/4). Watch for recurrence — if the peers re-clobber it, the file needs the
`.stignore` treatment on the Mac side, or the peers need to pull.
