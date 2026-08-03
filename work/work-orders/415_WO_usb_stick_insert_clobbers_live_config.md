# WO-415 — Inserting a flashed live-USB stick clobbered the live box config (exfat-sync `usb-modular-config` one-way pull)

**Status: OPEN (2026-08-03 — diagnosed, recovery pending owner go-ahead)**

## Investigation FIRST

Discovered while chasing a sudden WO-237 smoke failure (suite went 1801/0 → 1799/2 within one session with no src changes). Full chain, all times UTC 2026-08-03:

1. **12:50:32** — owner plugs the flashed live-USB stick back into the box after the failed
   Calamares attempt on another machine. Journal: `USB auto-mount: /dev/sda1
   (highascg-nvidia-595)`, `/dev/sda2 (44A4-C6D7)` (the stick's exFAT data partition from the
   PREVIOUS flash).
2. **12:54:38** — stick insertion triggers the WO-47 exFAT machinery:
   `highascg-exfat-server-update.service` stops the whole playout stack (companion, highascg,
   casparcg-server). The server-drop rsync itself was SKIPPED (`stamp unchanged (2026.05.20) —
   skip rsync (retain mode)`) — the drop-update was NOT the vector.
3. **12:54:44–12:55:03** — stack restarts; `highascg-exfat-sync.service` runs the WO-47/52
   mtime sync. The map (`/etc/highascg/exfat-sync.json`) pair **`usb-modular-config`** is
   `exfat: configs → project: /home/casparcg/highascg/config` with **`direction:
   "to_project"`** (one-way, stick wins) and `bootPrefer: exfat`. Journal:
   `[exfat-sync] done boot=false dryRun=false copied=49 skipped=814 errors=0`.
   The stick's `configs/` (stale — written at the previous flash/boot) overwrote the box's
   live `config/*.json` (all files now mode 755, the exFAT fingerprint; identical mtimes
   12:55:03). `usb-projects` (`to_project`) also overwrote `projects/wesele.json` (755,
   12:55) — `projects/` is NOT git-tracked, so no git baseline for it.
4. **12:54:44** — restarted server sees the gutted device graph and rewrites defaults:
   `[device-graph] boot hardware sync saved (0→4 gpu_out ports from live probe)` and
   `Layout plan: no assigned outputs`. Destinations, connectors, multiview, stream outputs
   all gone from the running instance.
5. **13:04 / 13:09** — the update+sync units re-fire twice more (owner re-produced the ISO
   12:59 and re-flashed the stick ~13:03; each udev event re-triggers the chain).
   `new_project_1.json` picked up a 13:04 stick copy the same way.
6. Collateral in the same window: `node_modules/` pruned to ~100 prod-only packages
   (12:54:44 — vite gone, `build:client` broken until `npm install` restored it), and the
   journal briefly logs hostname `highascg-nvidia-595` (the stick's identity) between
   12:55:07 and 13:04 — not chased further.

**Damage inventory** (`git diff --stat` vs HEAD at discovery): `config/device_graph.json`
−194 lines (all destinations/connectors), `config/general.json` −50, `config/stream_outputs.json`
−40, `config/screen_destinations.json` −23, `caspar_server.json` (screen_1_mode custom→1080p5000,
multiview_enabled true→false, multiview_screen_consumer true→false), nginx proxy conf, osc/ui/
replication/usb_ingest, plus `template/shaders/sh-ext.html`/`sh-ios.html` reverted (−17 each —
the WO-354-era "peers push stale shaders" pattern, this time via the stick, since `/template/
shaders` is only Syncthing-ignored, not exfat-sync-excluded).

**Why the smokes failed**: `smoke-wo237-monitor-channel-cheapest-mode.test.js` loads the real
box config (`ConfigManager` over `config/`); with the clobbered graph the generator emits
576p2500 + no Screen 1 program block. The test is fine — it correctly detected the box
drifting from its verified state.

**Root cause (design)**: `usb-modular-config` / `usb-projects` pairs are `to_project` —
correct for a FIELD box booting from a prepared stick, wrong on the STUDIO/live box where the
stick is merely being flashed/tested: any stick insertion silently overwrites live config with
whatever the stick last held. No stamp/identity check distinguishes "prepared field kit" from
"stale just-flashed test stick".

## Recovery (pending owner)

- Fresh restore point exists: commit `c45b17a` (WO-406, **12:17 same day**, live-verified
  monitor-channel config) contains the full pre-clobber `config/`.
- Plan: unplug/leave out the stick → `git restore config/ template/shaders/` → `kill -TERM
  $(systemctl show -p MainPID --value highascg)` → verify destinations/multiview return and
  suite is 1801/0 again. `highascg.config.json` (monolithic drop) untouched (mtime May 21).
- `projects/wesele.json`: no git copy; recover newest version from a Syncthing peer or
  `projects/_autosave/` if the stick's copy is stale (stick copy = state at previous flash).

## What was done

- (this session) `npm install` restored the pruned node_modules; build + suite re-verified.
- Nothing else touched yet — config restore is an owner decision (restart interrupts playout).

## Proposed hardening (follow-up, owner to pick)

1. Studio box: flip `usb-*` pairs to `direction: "to_exfat"` or drop them from the studio
   profile entirely (map override via `HIGHASCG_EXFAT_SYNC_MAP` / `/etc/highascg/exfat-sync.json`).
2. Or gate `to_project` pulls behind a stick marker file (e.g. `configs/.field-kit-armed`)
   that the ISO build does NOT create, so only deliberately prepared sticks may push.
3. Add `template/shaders` + `projects` to exfat-sync excludes on the studio box (mirror of the
   WO-401/354 Syncthing lesson).
4. Consider tracking `projects/*.json` in git (small files, real show data, currently zero
   baseline).

## What was VERIFIED to work

- Diagnosis chain verified against journalctl (units named above, quoted lines), file mtimes
  (`stat`: 12:55:03.21 across config/), FAT 755 modes, exfat-sync map content, and the
  `copied=49` sync summary. Nothing about recovery is verified yet — recovery not run.
