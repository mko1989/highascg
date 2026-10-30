# WO-609 — Cutover: package + install the Godot operator client, then decommission the Firefox kiosk

**Area:** godot-client, os-iso
**Status: IN PROGRESS (2026-10-21) — investigation written 17.10; interim on the owner's box 21.10: Openbox autostarts the dev Godot client (stand-in for T2) and the operator destination runs `videoOutput: shm` (cutover step 2), New project keeps it. T1–T6 not packaged; ISO / factory reset still seed the kiosk (resolved 22.10 by [WO-684](./684_WO_kiosk_output_deprecated_factory_shm.md): the factory seed is `videoOutput: shm`). Next: boot-time operator/destination monitor assignment → [WO-638](./638_WO_boot_monitor_assignment.md). Parent: [WO-593](./593_WO_godot_client_port_epic.md). LAST in the chain: runs only after the parity WOs (600–608) are owner-accepted on real shows.**

## Investigation

Source: Haiku inventory [`work/godot-port/inventory/runtime-kiosk-tests.md`](../godot-port/inventory/runtime-kiosk-tests.md) (2026-10-17), with the
load-bearing claims re-checked by hand (marked ✔).

### Firefox cannot leave the box — only the *kiosk* can

- ✔ WO-258 browser sources spawn their own Firefox per source:
  `src/system/browser-source-session.js:187-189` (`spawn(bin, ['--kiosk','--no-remote','--new-instance','--profile', profileDir, url])`).
- ✔ Settings → "Open browser" helper: `src/api/system-hardware-gui.js:147-148` (`spawnOperatorFirefox` → `spawnGuiDetached('firefox')`).
- So `firefox-esr` (267 MB, `work/NATIVE_GUI_PROPOSITIONS.md` §3B) **stays** in the image. The
  port saves no ISO space from Firefox; it adds the Godot client (single export binary + `.pck`).

### What dies with the kiosk — DELETE group: 21 files / 3,799 LOC

| Area | Files |
|------|-------|
| Launcher / placement / scale / snap | `src/system/operator-gui-launcher.js` (352), `operator-gui-launcher-placement.js` (307), `operator-gui-scale.js` (80), `operator-snap-home.js` (70); `tools/runtime/highascg-launch-operator-firefox.sh` (97), `highascg-operator-snap-home.sh` (25), `highascg-clean-firefox-snap-leftovers.sh` (76) |
| Shape overlay | `src/system/operator-shape-overlay.js` (211), `tools/runtime/operator-shape-overlay.py` (236), `operator_shape_overlay_lib.py` (464), `tools/smoke/xvfb-shape-overlay-harness.py` (142) |
| Helper windows / taskbar | `src/system/operator-helper-window.js` (451), `-window-state.js` (151), `-window-plan.js` (159), `-coordinator.js` (133), `-applier.js` (133), `-live.js` (172), `-registry.js` (181); `src/api/operator-helper-icon.js` (139); `tools/runtime/highascg-window-above.py` (103), `highascg-window-below.py` (117) |

Plus client-side: `client/lib/operator-gui-mode*.js` (3 files, 667 LOC) and the interaction-suppress
/ foreground-blocks-video machinery — dead only when the **web** client stops being the operator
surface (it stays for remote browsers, WO-608).

### REWORK group: 15 files / 3,556 LOC

`routes-operator-gui.js` (launch/raise dead; layout GET stays for remote view), `system-hardware-gui.js`
(helper handlers dead; `firefox` "Open browser" action stays), `routes-system-hardware.js`,
`x-display-session-gui-windows.js`, `x-display-session-runtime.js`, `operator-gui-channel.js` +
`-geometry.js` + `-media-layer.js` (shape feed dead; layout/atlas stays — WO-597),
`config-generator-operator-gui.js` (WO-597 `videoOutput`), `operator-monitor-picker.js` + `.py`
(WO-290 picker → native client does it, WO-599), `install-operator-firefox.sh` (keep for browser
sources), `09-openbox-autostart.sh`, `05-caspar-deps.sh` (drop `python3-xlib` once the shape
helper is gone; `xdotool` stays for `tools/startup/place-screen-consumers.sh`).

### Kiosk-only HTTP routes (13) → removed at cutover

`POST /api/operator-gui/launch|raise` (`router.js:261-262`), `POST|DELETE /api/operator-gui/layout`
(hole feed; `:258,:260` — the POST is *replaced* by atlas demand in WO-597),
`GET|POST /api/system/operator-helper-window` (`:138,:156`), `GET|POST /api/system/operator-helper-taskbar`
(`:140,:157`), `GET /api/system/operator-helper-icon` (`:141`). ✔ registrations checked.

### Tests

- ~17 smoke files die with the kiosk (`smoke-wo283-*`, `smoke-wo317-*`, `smoke-wo290-*`,
  `smoke-wo255-shaped-overlay`, `smoke-shape-overlay-input-dead`, `smoke-operator-gui-launch-timing`,
  `smoke-wo279-*`, `smoke-wo264-*`, `smoke-operator-gui-4k-scale`) → removed **together with** their
  entries in the curated list (`tools/ci/run-offline-tests.js`, 346 entries today, 42 kiosk-named).
- 64 tests pin `client/` sources → **unaffected** while the web client stays (WO-608).
- CI (`.github/workflows/ci.yml`): `python3-xlib` apt install (`:34-37`) only serves the shape
  harness → drop at cutover. New job `godot` from WO-599 (lint, unit tests, Linux export).

### Install / ISO footprint

- `scripts/setup/05-caspar-deps.sh:34` (`nodm openbox unclutter xterm xdotool thunar python3-xlib`).
- `scripts/setup/lib/install-operator-firefox.sh:70-100` (firefox-esr via mozillateam PPA) — keep.
- `scripts/setup/09-openbox-autostart.sh:80-144` — Node spawns the kiosk today
  (`maybeAutoLaunchOperatorGui`, `operator-gui-launcher.js:287`), autostart does not.
- eggs exclude lists: `tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list:131-134,238-239`,
  `…-fragment.list:110-113,221-222` (Firefox operator profiles) → add Godot user-data dir.
- ~19 docs mention the kiosk (largest: `docs/MANUAL_INSTALL.md` 12 hits, `openbox_autostart.md` 9,
  `ISO_CONTENTS.md` 9, `LIVE_USB_IMAGE.md` 8).

**Owner 17.10:** "if godot works we will deprecate the kiosk client." — confirms this WO's end state;
the web client itself stays for remote work (WO-608 D1).

## Design

### Packaging

- `godot/` project exported headless in CI and on the box: `godot --headless --export-release "Linux"`
  → `dist-godot/highascg-operator.x86_64` + `.pck` + `libhshm.linux.x86_64.so` (WO-596).
- Installed to `/opt/highascg/operator/` (versioned dir + `current` symlink, previous kept —
  mirrors the `casparcg.prev` habit) by a new `scripts/setup/15-godot-operator.sh`.
- Godot engine version pinned in one place (`godot/GODOT_VERSION`), export templates cached for
  offline ISO builds (same idea as the pinned CEF tarball in the Caspar build kit).

### Start / supervise

- systemd **user** unit `highascg-operator.service` (`Restart=always`, `RestartSec=1`,
  `Environment=DISPLAY=:0`), started from openbox autostart via
  `systemctl --user import-environment DISPLAY XAUTHORITY && systemctl --user start highascg-operator`.
- Replaces `maybeAutoLaunchOperatorGui`; `autoLaunch:false` on the destination → the unit is not
  started (server exposes the flag; the autostart snippet asks the server).
- The client places itself on the operator monitor from `GET /api/system/operator-display`
  (WO-599) — no xdotool.

### Cutover sequence (each step reversible)

1. Ship client + unit **disabled**; kiosk still default (`videoOutput:'screen'`).
2. Owner flips the destination to `videoOutput:'shm'` + enables the unit (one Settings toggle).
   Kiosk launch suppressed while the native client owns the operator monitor.
3. N ≥ 3 real shows on the native client with no fallback → step 4. Any blocker → flip back
   (one toggle; kiosk code still present).
4. Delete the DELETE group + dead routes + dead smokes in one commit; rework group; docs.

## Tasks

- [ ] T1 — export pipeline + `15-godot-operator.sh` + version pin + offline templates.
- [ ] T2 — user unit + autostart wiring + `autoLaunch` honour. *(Start policy superseded by [WO-645](./645_WO_startup_launcher_autostart_opt_in.md): launcher by default, autostart opt-in; the user unit remains.)*
- [ ] T3 — kiosk suppression switch (single source of truth: destination `videoOutput`).
- [ ] T4 — ISO/eggs: include `/opt/highascg/operator`, exclude Godot user data; `ISO_CONTENTS.md`.
- [x] T5 — done as [WO-646](./646_WO_kiosk_decommission.md) (21.10, stages A–D). Was: deletion commit (21 files / 3,799 LOC + 13 routes + ~17 smokes + CI apt dep).
- [ ] T6 — docs rewrite (~19 files).

## What was done

Nothing packaged yet. Interim on the owner's box (2026-10-21, owner asked for the Godot GUI to auto-start):
- Openbox autostart starts `godot/client/run-client.sh --screen=0` from the dev install (`~/.local/opt/godot`), log
  `~/.highascg/log/godot-client.log`; also in `scripts/setup/09-openbox-autostart.sh` (944767b1). That commit also fixes
  the generated autostart's comment-only `else`, a bash syntax error that stopped the script at that block. Stand-in for T2.
- Step 2 of the cutover sequence done on this box: operator destination `videoOutput: 'shm'`, applied. Owner report
  that prompted it: a New project + apply brought the kiosk back, because New project reseeded the factory `'screen'`.
  Fix (7a19fa5e): `new-project.js keepOperatorVideoOutput` keeps the live `videoOutput` / `shmName` (a machine property,
  like `gpuPhysicalTopology`). Factory reset and the ISO still seed `'screen'` — `.local` is excluded from the ISO, so a
  fresh install has no Godot client.
- 2026-10-21 (WO-638): the autostart line dropped `--screen=0` (setup script + this box). The client follows the
  server's operator monitor, and on a multi-screen boot asks which screen that is while `run.sh` holds Caspar.

## What was VERIFIED

- 2026-10-21 box: after the shm apply, `config/casparcg.config` has `<shm><name>opgui</name>` on the operator channel,
  `/dev/shm/highascg-opgui` is written, node logs `[Operator GUI] auto-start skipped: native_client_shm`, no kiosk
  process, Godot reconnected and shows the Devices tab on DP-2. Smoke `smoke-new-project.test.js` 6/6 (the new test fails
  with the call removed).

Inventory claims re-checked by hand: browser-source Firefox spawn (`browser-source-session.js:187-189`),
"Open browser" spawn (`system-hardware-gui.js:147-148`), helper routes (`router.js:136-157`),
curated list size (`run-offline-tests.js`, 347 quoted lines ≈ 346 entries).
