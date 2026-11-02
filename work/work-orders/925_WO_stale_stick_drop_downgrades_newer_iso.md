# WO-925 — A stale drop-update/ on the stick downgraded the 01.11 ISO on every boot (no Caspar, no Visuals tab, slow start)

**Area:** os-iso
**Status: DONE (02.11.26 — guard + smokes 11/11; second machine .31 diagnosed over ssh; its reboot confirms)**

Owner, 02.11.26, booting the 01.11 ISO (`highascg-nvidia-615-2026-11-01_1801.iso`) on a second machine (192.168.0.31,
RTX 2080 SUPER, HDMI-0 only, 4× DeckLink 8K Pro): "it took a really long time for the node server to come up. and
casparcg didnt come up yet." / "there is no visuals tab at all. changes like templates --> CG in sources browser arent
there." / "the launcher … showed up 2min after the client already started."

## Investigation

- `casparcg-server.service`: **failed**, `run.sh` exit 127, restart limit hit. Journal:
  `run.sh: 140: caspar_drop_stale_cef_lock: not found`, `141: caspar_log_mark: not found`, `146: caspar_wait_child_or_hang: not found`.
- `run.sh` on .31 matched the repo (md5 `adf728df…`). Its sourced `tools/runtime/casparcg-supervisor-lib.sh` did not:
  .31 had `0d00aa4d…` dated 25.10, the repo has `05461abf…`. The tree was half old, half new.
- Boot journal, `highascg-exfat-server-update`: `apply /home/casparcg/exfat/drop-update/ → /home/casparcg/highascg/
  (mode=retain)`, staged as `2026-10-25T080500Z`, `merge … (no --delete)`, `npm ci (package-lock from update)`,
  `retain mode: drop left at … (stamp 2026-10-25T080500Z)`. The stick's exFAT still held a **25.10 server drop**. A Ventoy
  re-flash only swaps the ISO and keeps the HIGHASCGEXF partition (WO-434 stopped *seeding* drops, but an old one survives).
- `scripts/exfat/highascg-apply-server-drop.sh` skipped a drop only when its stamp **equals** the installed one
  (`stamp_unchanged_skip`). ISO `2026-11-01_170159` ≠ drop `2026-10-25T080500Z`, so the drop was merged over the newer ISO.
  It was merged in retain mode, so this happens on **every** boot. Every file the 25.10 drop contains went back to 25.10:
  the supervisor lib, the Godot client (shell without the Visuals tab, Sources "Templates" not "CG"), and `node_modules`
  (from the old lockfile). Newer files the drop lacks (`run.sh`, `godot/client/features/visuals/`) stayed. That mix is what broke run.sh.
- The ISO itself is fine. In the squashfs lower layer, `BUILD_STAMP 2026-11-01_170159`, the lib md5 matches this box, and
  `shell.gd` has the Visuals tab.
- **Slow start**: `systemd-analyze critical-chain highascg.service`: node at 3 min 09 s ← exfat-sync 18 s ← DeckLink
  install **1 min 18 s** ← exfat-server-update **52 s** (the stale drop + npm ci). The DeckLink reinstall is by design on a
  live boot (WO-430/431 mask the payload). This boot restored 0 DKMS trees from the stick and saved them at the end
  (`decklink dkms cache: saved … 7.0.0-38-generic`), so the next boot skips the module build.
- **Launcher 2 min after the client**: the session autostarts Godot (~07:34). The client waits for the server
  (boot_question.gd, WO-696) and node listened only at 07:36:35, so the launcher came up then. That follows from the slow chain above.

## What was done

- `scripts/exfat/highascg-apply-server-drop.sh`: `stamp_digits` + `stamp_older_skip`. Both stamp spellings are UTC
  date+time, and their first 14 digits compare as numbers. A drop **older** than the installed BUILD_STAMP is logged
  (`drop … is older than the installed … — not applied`) and skipped in any mode. A drop folder containing
  `ALLOW_DOWNGRADE` still installs, for a deliberate rollback. Non-date stamps (package.json semver) compare as before
  (equality only).
- `tools/smoke/smoke-server-update-retain.test.js`: older drop not applied (installed stamp + files untouched); a newer drop
  applies; `ALLOW_DOWNGRADE` rolls back. The file was not in the curated list, but it runs the same script as the curated
  WO-737 smoke, so it is now curated too (`tools/ci/offline-test-files.js`).
- .31: the owner emptied the stick's `drop-update/` by hand (07:44, Thunar). Nothing on .31 was changed from here.

## What was verified

- `node --test` of `smoke-server-update-retain` + `smoke-wo737-update-keeps-box-config`: 11/11. `format:check` clean.
- On .31 over ssh: the journal lines, md5s and critical chain quoted above, and the ISO lower layer intact.
- Still open on .31: a reboot (the live overlay holds the downgraded tree until then). After it, expect no
  `apply-server-drop` merge, casparcg-server active, the Visuals tab in place, and a shorter DeckLink step (DKMS cache now on the stick).
