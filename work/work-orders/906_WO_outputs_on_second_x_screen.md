# WO-906 — Playout outputs on a second X screen (:0.1) of the same X server, operator heads alone on :0.0

**Area:** devices-config, os-iso, mapping
**Status: DONE (31.10.26, generator + switch built; live on the box: 2 X screens, Caspar on :0.1 at 50/s, pointer can't cross, misactions drop 0, off/on rollback proven; smokes 8/8 + full offline suite. Open: ISO sudoers wiring, see §6)**

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

Remaining at that point: the generator, per-screen layout plan and xrandr verify/apply, the ISO sudoers line. The owner
then asked for it to be built (31.10.26: "WO-906 build this. Have a backup ready to go back if it's not sustainable. But
the idea is exactly what I need, screens that are detached from the gui, operator etc meaning they are undisturbed by any
user misaction.") — §6.

## 6. Generator, switch and live use (31.10.26, 18:03 on)
### What was done
- **Switch** `casparServer.playout_x_screen` (machine-local `config/caspar_server.json`, as WO-868's `operator_gui_first`;
  the plan's `x11.playoutScreen` name was dropped for that precedent). Off / missing = one X screen, as before.
- **`src/utils/x-screens.js`** — one virtual canvas, two X screens: the layout plan is unchanged (operator heads left,
  playout heads right); `splitScreens` puts the operator GUI heads on screen 0 and every PGM / PRV / multiview /
  mapping head on screen 1, each screen's origin = the min x/y of its heads. `buildXorgScreensConf` writes the conf the
  §4 helper accepts (ASCII only: an em dash made the helper call it binary): Screen 1 `Absolute` below-right of screen 0
  with no shared edge (the pointer can never cross), Xinerama off, both Devices on the NVIDIA BusID with
  ForceCompositionPipeline, metamodes per screen from the plan, `# highascg-x-screen n display x y outputs` lines.
  The runtime truth is that installed file (`installedScreens`): every consumer asks it which screen an output is on.
  `mergeScreensXrandrText` folds both screens' xrandr back onto the canvas (positions + origin, primary only from
  screen 0, union `current`) so inventory / verify / watchdog / Device View read the same canvas as before.
  `isOperatorPickable`: under two screens only screen 0 outputs can be the operator screen.
- **`src/utils/x-screens-sync.js`** — at the start of every full Apply (`full-config-apply.js`): wanted conf vs
  installed → `sudo -n helper install <staged>` / `off`; a change adds the nodm restart (logged), caspar-env is now written
  before Step 2 so Caspar's next launch already has its display. Sandbox and the test runner never touch the box.
- **Per-screen runtime:** `os-config-xrandr-apply.js` (one xrandr argv per screen, positions minus the screen origin,
  `runXrandrWithRetries`), `xrandr-safety.js` (display arg validated `:N[.N]`), `xrandr-custom-mode.js` and
  `xrandr-persist-script.js` (newmode / addmode on the output's screen), `hardware-info-xrandr.js` (the 4 probes query
  every installed screen and merge; a failing screen 1 is skipped), `nvidia-display-policy.js` +
  `tools/runtime/highascg-nvidia-x-apply.sh` (`[screen:N]` targets, the sync output only on its screen),
  `screen-consumer-placement.js` (`:0.1`).
- **Caspar:** `build-caspar-generator-layout-sync.js` `toPlayoutScreen` subtracts the playout origin from the screen /
  PRV / multiview / slice window positions (DP-0 at canvas 3840 → `<x>0</x>`); `caspar-gl-sync-env.js` writes
  `CASPAR_DISPLAY=:0.1` only while the flag is on AND the conf is installed; `run.sh` falls back to the base display
  when `xrandr --display $CASPAR_DISPLAY` fails (a conf removed behind its back cannot leave Caspar windowless).
- **Operator screen guard:** `routes-operator-screen.js` (409) and `boot-screen-assignment.js` (`resolve` 409,
  `defaultOperator` skips screen 1) — a GUI pick, a boot answer or a stale flag can never put the operator on DP-0. The
  Godot boot prompts match screens by position and only see screen 0, so they never offer DP-0 either.
- **The switch:** `GET/POST /api/system/playout-screen` (`src/api/routes-playout-screen.js`): POST `{enable}` first
  writes a backup (`~/.highascg/backup/wo906-<ts>/`: casparcg.config, caspar-env, casparServer), sets / deletes the flag,
  then the standard forced full apply. Shell: `scripts/runtime/playout-screen.sh status | on | off | off --emergency`.

### Way back
- `scripts/runtime/playout-screen.sh off` (server up): flag off → Apply removes the conf (kept as `.prev`), nodm +
  Caspar restart → one X screen. Measured 16 s.
- `scripts/runtime/playout-screen.sh off --emergency` (server not answering): helper off, flag deleted in
  `config/caspar_server.json`, nodm restart, node restart, forced Apply once it answers.
- By hand: `sudo -n /usr/local/lib/highascg/highascg-xorg-screens-apply.sh off && sudo -n systemctl restart nodm`
  (run.sh's fallback then starts Caspar on `:0`), and the backup dir for the previous casparcg.config.

### Verified
- **Offline:** `smoke-wo906-playout-x-screen.test.js` 8/8 (switch, split, conf through the real helper `check`, merge,
  per-screen xrandr / NVIDIA / custom modes, Caspar positions + caspar-env, sync on/off/refusal, operator guard);
  `smoke-wo444-caspar-env-per-launch` 3/3 (new: screen 1 missing → base display); timeout smoke repointed. Clean
  worktree at 1edf261c + this change: lint 0 errors / 205 warnings, max-lines 0, unwired-exports clean, API contract
  regenerated, `test:ci` 5119 tests, 18 failures, all in 6 files that resolve sysIds against the box's REAL xrandr
  (`smoke-mapping-gpu-os-layout`, `smoke-os-layout-w40`, `smoke-wo439-…`, `smoke-wo868-…golden`, `smoke-wo869-…` ×2):
  identical 18 at the base commit, and 47/0 with `HIGHASCG_XORG_SCREENS_CONF` pointed at the real conf. They fail only on
  this box while it runs two screens (the test runner deliberately never reads the installed conf, so they see screen 0
  alone); CI has no X.
- **Box, `playout-screen.sh on` (18:03, 8 s):** `xdpyinfo` 2 screens (`:0.0` 3840x1080 = DP-4 + DP-6, `:0.1` 3840x1792
  = DP-0 at its EDID mode); Caspar `DISPLAY=:0.1`, `__GL_SYNC_DISPLAY_DEVICE=DP-0`, casparcg.config `<x>0</x><y>0</y>`;
  journal "xrandr verify OK", "NVIDIA … (2 X screens)"; `apply-layout.sh` has one xrandr + NVIDIA run per screen; the
  GUI came back by itself on :0.0. Grabs: the GUI alone on :0.0, the ch2 `visuals` ring alone on :0.1.
- **Pointer:** `xdotool` pushes past x=3839 and past the bottom-right corner stay on screen 0 (`screen:0`, 3839).
- **Misactions on :0.0** (alt-tab ×6, super ×3, Escape, F11 on/off) with OSC :6250 watched for 20 s: presented 50/s,
  shm 49–50/s, **drop 0**.
- **Node restart:** watchdog "xrandr layout matches config", no re-apply, Caspar pid unchanged. **Plain Apply:**
  `no_changes`, nodm pid unchanged, Caspar not restarted.
- **Operator API:** GET lists DP-0 with `caspar: true`; POST `{name: "DP-0"}` against the installed conf → 409.
- **Rollback proven:** `off` (16 s) → 1 screen 7680x1792, Caspar `DISPLAY=:0`, 50/s (4 drops at start, then flat);
  `on` again (8.6 s) → 2 screens, Caspar `:0.1`, 50/s, drop 1 at start then flat, GUI back, ring on DP-0. Left ON
  (owner's wish). Backups: `~/.highascg/backup/wo906-2026-10-31T17-03-18-240Z` (before the first on) and one per switch.

### Still true / open
- §5's modeset finding stands: an operator xrandr mode change stalls the GPU display engine for BOTH screens (NVIDIA);
  two screens isolate windows, focus, pointer and the X layout, not a modeset.
- ISO: the helper + sudoers line are not installed by the ISO setup yet (a fresh install answers the switch with the
  helper's install hint). No GUI toggle (API + script only).
- WO-258 `browser_display` (unused on this box) computes its off-screen region on the merged canvas; under two screens it
  would need screen 0's root.
