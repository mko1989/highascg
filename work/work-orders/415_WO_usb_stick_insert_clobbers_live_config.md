# WO-415 — Live box config wiped to defaults during the 12:54 stick-insert stack restart

**Status: CLOSED — NOT AN INCIDENT (2026-08-04, owner: "normal operation that happens when I run eggs produce. It sets all configs to defaults so the produced ISO is clean and not full of old test projects." No restore wanted; the clobbered config is the accepted current state. Hardening options 1–2 DROPPED — they would fight the intended stick-wins produce flow; the flow-independent durability parts (atomic copies, corrupt-file quarantine) done as [WO-421](./421_WO_config_durability_and_monitor_fps_fallback.md). The diagnosis chain below stays as reference for what produce does to a live box.)**

## CORRECTION (same day, before any fix)

Round 1 blamed the exfat-sync pair `usb-modular-config` (stick → live config). **That is wrong.**
Verified afterwards:

- `/home/casparcg/exfat` is **not a mount point at all** (plain empty dir), and
  `/home/casparcg/exfat/configs/` is **empty** (mtime Jun 7). The USB volume therefore supplied
  no config content; the `usb-*` pairs cannot have been the source.
- The stick auto-mounted at `/media/casparcg/highascg-nvidia-595` + `/media/casparcg/0B31-AE32`,
  not at the sync path.
- The stick itself is a **raw hybrid-ISO dd only**: `sda1` 3.5 G iso9660 + `sda2` 16 M vfat, with
  ~25.8 GB unallocated and **no `HIGHASCGEXF` exFAT partition** — so it has no `configs/` to push.
- `/home/casparcg/bridge/configs/device_graph.json` (internal NVMe partition `HIGHASCGDAT`,
  pair `bridge-modular-config`, `direction: both`, `bootPrefer: exfat`, `pushOnSave: true`) is
  **byte-identical to the clobbered live file** (181 bytes; git HEAD has 4420) with the same
  preserved mtime 12:55:03.21.

**Most probable mechanism, given the evidence** — not the stick's content, but the
config-load-failure amplifier documented as finding #1 in
`work/reviews/2026-08-03-config-system-bootstrap.md`: the stick insert triggered
`highascg-exfat-server-update.service`, which **stopped the playout stack mid-flight**; on
restart the server came up with a default device graph (journal 12:54:44:
`[device-graph] boot hardware sync saved (0→4 gpu_out ports from live probe)`,
`Layout plan: no assigned outputs`), the next `save()` persisted those defaults over the real
`config/*.json`, and `pushProjectConfigToExfat` then propagated the defaults to the bridge disk
(`[exfat-sync] push to volume(s) copied=96 skipped=2`). Direction bridge→project vs
project→bridge is not provable from the surviving artifacts (both sides are identical and
mtimes are preserved by the copy), but the empty USB volume rules the stick out either way.

**Operational consequence of the correction:** plugging a stick is not itself a config-overwrite
event. What IS verified is that **stick insertion stops and restarts the whole playout stack**
(companion, highascg, casparcg-server) via `highascg-exfat-server-update.service` — that alone
is disruptive on a live box, and it is what exposed the defaults-wipe.

---

## Round 1 investigation (trigger chain — still valid; source attribution superseded above)

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

- (03.08) `npm install` restored the pruned node_modules; build + suite re-verified.
- Nothing else touched yet — config restore is an owner decision (restart interrupts playout).

## Recovery attempt 04.08 — BLOCKED at the restore step (needs owner)

Owner said "do those" over the open queue; recovery was attempted and stopped at the exact
`git restore config/` step: the permission classifier hard-blocks git working-tree restores in
this session, and recreating 21 live config files by other means to sidestep that denial was
not appropriate. Everything AROUND the restore was verified fresh:

- The clobber persists and re-amplifies: `config/device_graph.json` is an 11-line default
  (201 in git); the server restarted 16:15:49 (03.08) and re-saved defaults at 16:17
  (`boot hardware sync saved (0→4 gpu_out ports)` again in the journal).
- `git diff c45b17a HEAD -- config/` is EMPTY — restoring to HEAD lands exactly on the
  live-verified 12:17 state; no later config commits exist.
- **Shader provenance** (do NOT blanket-restore `template/shaders/`): the 4 modified files
  (sh-audio, sh-fft-test, sh-ksbhdgdgb, sh-ksjb) are OWNER EDITS from Jul 28 16:29-16:37
  (mode 664, renames like ksjb→tunnel-ball) — keep them. Only the two now-DELETED files
  (`sh-ext.html`, `sh-ios.html`) are damage.
- `projects/wesele.json` exists again (plus `projects/_autosave/wesele.json`) — compare
  mtimes/content before trusting either.
- **Boot re-clobber trap** (verified in source): `exfat-sync-fs.js:66` copies volume→project
  UNCONDITIONALLY on boot when `bootPrefer: exfat` — the bridge NVMe (`HIGHASCGDAT`, currently
  unmounted) still holds the 12:55 defaults, so the next boot/bridge-mount re-clobbers a
  restored `config/` unless the bridge's `configs/` is refreshed first. A plain service
  restart does NOT run the sync — safe; a reboot is NOT safe until the bridge copy is fixed.
- The claim that a sync pair covers `template/shaders` is WRONG — no pair in
  `/etc/highascg/exfat-sync.json` touches it (hardening option 3 is moot for shaders; the
  shader hits came another way, likely the drop rsync or Syncthing).
- Collateral re-fired overnight: `node_modules` pruned to prod-only again
  (`highascg-apply-server-drop.sh:211` `npm ci --omit=dev`; update service re-ran 17:01 with
  the stick inserted; journal hostname briefly `highascg-nvidia-595`). Restored 04.08 ~09:50
  via `npm install`. Every stick insertion keeps re-triggering this until the stick is pulled
  or the WO-416-fixed flow is used.

### Owner runbook (in this order, stick UNPLUGGED)

```bash
cd /home/casparcg/highascg
git restore config/
git checkout -- template/shaders/sh-ext.html template/shaders/sh-ios.html   # ONLY these two
kill -TERM $(systemctl show -p MainPID --value highascg)
# verify: journal shows real destinations (not "no assigned outputs"); suite 1808/0 expected
# BEFORE any reboot — refresh the bridge copy so boot sync can't pull defaults back:
sudo systemctl start home-casparcg-bridge.mount   # or mount HIGHASCGDAT at ~/bridge
rsync -a --delete config/ /home/casparcg/bridge/configs/
```

The service restart also loads WO-418's fixes (traversal, AMCP CR/LF, error handlers,
healthy flag) and the WO-416 poller inhibit — one restart covers all of it.

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
