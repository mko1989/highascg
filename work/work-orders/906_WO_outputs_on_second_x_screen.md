# WO-906 — Playout outputs on a second X screen (:0.1) of the same X server, operator heads alone on :0.0

**Area:** devices-config, os-iso, mapping
**Status: IN PROGRESS (31.10.26 — helper installed by the owner; run.sh `CASPAR_DISPLAY` plumbing in; box experiment done and rolled back (§5): two screens work, but an operator modeset still stalls playout — generator waits for the owner's go)**

## Owner request (31.10.26)
"would it be possible to move the screen consumer outputs to another x display like display:1 so they are separate
from the operator from the start. if yes what about sync?" → "make a work order for the second x screen on the same x
server. passwordless sudo might have been already granted for the x edits. each change in channels, outputs etc needs
a caspar restart so that's not an issue. would also need a config for multi head outputs so they land on the same
screen. it was already possible through mapping nodes."

## 1. Investigation (31.10.26, before any change)
- **Why not `:1`:** a second X *server* cannot drive heads of the GPU the first one owns (one NVIDIA X driver instance
  per GPU in practice). A second X *screen* of the same server can: `Screen 0` and `Screen 1` sections on the one
  `Device` (BusID `PCI:1:0:0`, RTX PRO 4000 Blackwell, driver 615.71.09), each with its own metamodes, Xinerama OFF.
  Apps choose with `DISPLAY=:0.0` / `:0.1`; windows can never cross, the pointer can (the WO-903 fence keeps it on
  the operator heads).
- **Today:** one X screen (`xdpyinfo`: `number of screens: 1`, XINERAMA present). xrandr DP-4 0,0 (primary, operator 1),
  DP-6 1920,0 (operator 2), DP-0 3840x1792 +3840,0 (Dioda PGM, Caspar's only `<screen>` consumer, ch2). The operator
  GUI channel (ch1) has no screen consumer (shm / video surfaces), so the whole of Caspar can run on `:0.1`.
- **X restart:** nodm (`NODM_X_OPTIONS='-s 0 -dpms -nolisten tcp'`); sudo allows `systemctl restart nodm` (WO-315
  restarts it on canvas growth). **Not allowed:** writing `/etc/X11/xorg.conf.d/` — only
  `99-highascg-force-composition.conf` (ForceCompositionPipeline On, Device section) is there. A root helper must be
  added to the allowlist once by the owner (§2.1).
- **Sync:** with one playout X screen, `__GL_SYNC_DISPLAY_DEVICE` / `CASPAR_GL_SYNC_DISPLAY` (run.sh, WO-407) names a
  head of that screen only — no ambiguity with operator heads, and operator-side xrandr / GUI work can no longer
  disturb Caspar's swap. All heads still flip on the same GPU clock; no frame lock needed between the two screens.
  Several playout heads on screen 1 keep today's rule: the GL sync device is the PGM head (mapping-rig auto, WO-437).
- **Single-desktop assumptions that must learn "screen":** `src/utils/os-config.js` + `xrandr-layout-verify.js`
  (xrandr on :0 → per screen), `os-layout-calculator*` (positions in one canvas → per-screen canvases, each from 0,0),
  `x-display-session-runtime-env.js` (`DISPLAY: ':0'`), `run.sh` (`DISPLAY=${DISPLAY:-:0}`) / caspar-env, the pixel-
  map slice windows (`config-generator-slice-windows.js`), screen consumer `<x>/<y>` (`config-generator-screen-xml.js`),
  `caspar-window-sync.js`, compose-preview / browser-source capture (`src/capture/browser-source-region.js`: x11grab
  `:0.0+x,y` → `:0.1+…`), pointer confine (stays :0.0), the WO-638 boot screen gate, NoMachine (probably shows :0.0 only
  — owner check).

## 2. Plan
1. **Root helper** `/usr/local/lib/highascg/highascg-xorg-screens-apply.sh <generated.conf|--off>`: validates the file
   (only `Screen` / `ServerLayout` / `Device` sections, our BusID), installs it as
   `/etc/X11/xorg.conf.d/98-highascg-screens.conf` (or removes it), keeps the previous copy; sudoers line shipped in the
   ISO setup and given to the owner as one command for this box.
2. **Config:** `x11.playoutScreen` = off | on (default off = today). On: generator writes the two-screen layout —
   screen 0 = every head cabled to an operator GUI destination, screen 1 = every other GPU head (PGM / PRV / multiview /
   mapping outputs) — with each screen's metamodes from the existing layout plan, ForceCompositionPipeline kept.
3. **Multi-head outputs on the playout screen:** the mapping-node path (WO-40a, mapping GPU outputs + bbox) already
   places several heads side by side in one canvas; on screen 1 that canvas starts at 0,0 and every head of it lands
   there. Screen destinations without mapping nodes follow the same placement (left → right in destination order).
4. **Runtime:** Caspar (run.sh / caspar-env) gets `DISPLAY=:0.1`; xrandr verify / apply per screen (`xrandr -d :0.1`);
   capture paths take the screen of the region; the GUI, pointer confine, boot gate stay on :0.0.
5. **Apply:** a change of the screen split = write conf + nodm restart (+ Caspar restart, as any channel / output
   change already needs); a mode / position change inside a screen stays an xrandr apply.
6. **Rollback:** `--off` removes the conf + nodm restart → today's single screen.

## 3. Verification plan
- Box: `xdpyinfo` 2 screens; `xrandr -d :0.0` = DP-4 + DP-6 only, `-d :0.1` = DP-0 (+ mapping heads); Caspar window on
  DP-0 fullscreen at the EDID mode (NovaStar memory: DP-0 relights only at its EDID mode); alt-tab / GUI moves / operator
  xrandr changes during playback leave the Dioda output untouched (ring + screen capture of :0.1).
- Offline: generator smoke for the conf (screen split from a device graph, BusID, Xinerama off), per-screen layout plan
  from 0,0, DISPLAY plumbing.

## 4. Done so far (31.10.26)
- **Root helper** `tools/runtime/highascg-xorg-screens-apply.sh` — `check <file> | install <file> | off | restore | status`.
  Validates before writing: only Device / Monitor / Screen / ServerLayout sections (+ SubSection "Display" in Screen), a
  keyword and NVIDIA-option whitelist, values = quoted strings / numbers / screen position words, `Driver "nvidia"`,
  `BusID "PCI:b:d:f"`, no "NVIDIA Default Device" (that identifier is 99-highascg-force-composition.conf's), a
  ServerLayout required, ≤ 16 KiB, no symlink / control chars. Install copies the content to a temp file in the target
  dir, re-validates it, keeps the current file as `98-highascg-screens.conf.prev` (not `*.conf`: X never loads it),
  then renames. `off` moves it to `.prev`, `restore` swaps `.prev` back. Nothing touches X until nodm restarts.
- **Installer** `scripts/runtime/install-xorg-screens-apply.sh` (as `install-network-apply.sh`): the helper to
  `/usr/local/lib/highascg/` (755 root) + `/etc/sudoers.d/highascg-xorg-screens` (one NOPASSWD line, 440, `visudo -cf`).
  On this box, once: `sudo bash ~/highascg/scripts/runtime/install-xorg-screens-apply.sh`.
  Not yet in the ISO setup (no ISO caller of the network helper's installer either — to wire with the generator).
- **Verified:** shellcheck clean; `tools/smoke/smoke-wo906-xorg-screens-helper.test.js` (4/4, curated CI) — a two-screen
  layout validates / installs / turns off / restores in a temp dir (`HIGHASCG_XORG_DIR`, ignored for root); Files, Module,
  other drivers, unknown options, a BusID with `;`, `$(id)`, an unclosed section, no layout and the default-device
  identifier all exit 2 with the installed file untouched and no temp file left; symlinks refused.

## 5. Box experiment (31.10.26, 17:16–17:20, rolled back)
Hand-written conf (scratchpad `wo906/98-highascg-screens.conf`): ServerLayout with Screen 0 "Operator" (`UseDisplayDevice`
DP-4, DP-6; metamodes DP-4 +0+0, DP-6 +1920+0) and Screen 1 "Playout" RightOf it (DP-0 +0+0), two Device sections on
`PCI:1:0:0` (`Screen 0` / `Screen 1`, ForceCompositionPipeline On), Xinerama 0. `helper check` OK → `install` →
`sudo systemctl restart nodm`.
- **X:** `xdpyinfo` 2 screens. `xrandr -d :0.0` = DP-4 + DP-6 (3840x1080), `-d :0.1` = DP-0 3840x1792@50 (its EDID mode —
  the NovaStar relit at once). No (EE) in Xorg.0.log. The session autostart brought the GUI back on :0.0 by itself.
- **Caspar:** `run.sh` now exports `DISPLAY=${CASPAR_DISPLAY:-<unit DISPLAY>}` per launch from caspar-env (this WO); with
  `CASPAR_DISPLAY=:0.1` in caspar-env and the screen consumer at `<x>0</x>` the process ran with `DISPLAY=:0.1`,
  `__GL_SYNC_DISPLAY_DEVICE=DP-0`; window "Screen consumer [2|3840x1792]" 3840x1792+0+0 on screen 1; OSC presented 50/s,
  drop 1; the visuals ring back at 50/s (WO-914). Grabs: `wo906/screen0.png` (the GUI alone), `wo906/screen1.png` (Dioda).
- **Alt-tab ×6 on :0.0:** 50/s throughout, drop flat (38 → 38). Same as single-screen since WO-888.
- **Operator modeset** (DP-6 50 → 60 → 50 Hz, `xrandr -d :0.0`): **each one cost the playout ~18 dropped frames**
  (pres/s 32 / 31, drop 1 → 20 → 38, no catch-up). Same op on the single screen after rollback: a stall of the same length
  (pres/s 37 / 27) but caught up (62 / 72 in the next second), drop 1 → 3. An NVIDIA modeset stalls the GPU's whole
  display engine whichever X screen it is on, so a second X screen does NOT isolate playout from operator mode changes;
  it only turns the late frames into dropped ones.
- **What a second screen does give:** windows can never cross (the Caspar window cannot bury the GUI after a NovaStar
  replug, the GUI cannot cover DP-0), per-screen xrandr, and the GL sync head is the only head of its screen.
- **Rollback:** `helper off` (file kept as `.prev`), caspar-env and casparcg.config restored from the backups (config
  byte-identical), nodm + Caspar restarted: 1 screen, Caspar `DISPLAY=:0`, 50/s.
- **Why not left on:** until the generator exists an Apply rewrites `<x>3840</x>` (off-screen on :0.1) and node's xrandr
  verify (`os-layout-watchdog.js`, 12 re-applies at node start) would chase DP-0 on :0 — each re-apply a modeset.

Remaining (owner decision, given the modeset finding): the generator (`x11.playoutScreen`), per-screen layout plan and
xrandr verify/apply, capture paths on :0.1, the ISO sudoers line.
