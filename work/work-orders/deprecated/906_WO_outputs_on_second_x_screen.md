# WO-906 — Playout outputs on a second X screen (:0.1) of the same X server, operator heads alone on :0.0

**Area:** devices-config, os-iso, mapping
**Status: DEPRECATED (31.10.26 — built and A/B-tested, perf not positive (§8); owner reverted to ONE X screen (§9), then: "I want it gone. No need to keep dead code." — all code removed (§10). No successor: one X screen for all outputs stays the model.)**

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
- **Operator screen guard (240512e7) — removed, see §7:** it refused DP-0 as the operator screen everywhere; the owner
  needs "Start operator here" on every screen at boot (a new show, a new setup).
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
- **Operator API:** GET lists DP-0 with `caspar: true` (the 409 guard of that commit is gone, §7).
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

## 7. Boot question on every screen; machine-local switch (31.10.26, owner: "This guard can't exist in it's current state. Next boot might be a new show with new setup etc etc so I need a start gui here at boot.")
### Investigation
- The §6 guard made DP-0 un-pickable, and with two X screens the Godot client (on :0.0) cannot open a prompt on :0.1 nor
  can the pointer reach it — so the WO-645 launcher could never offer the playout screen.
- `config/device_graph.json` / `caspar_server.json` are what a boot answer rewrites (`applyOperatorMonitorChoice` +
  `planDestinationCables`), and the split follows the cables — so the split has to be recomputed AFTER the answer anyway.
- `buildHardwareConfigFromConfig` (`project-hardware-config.js`) stripped only `operator_gui_first`: a project saved with
  the switch on carried `playout_x_screen` and its load (merge) would set it on another box.
### What was done
- Guard removed (`routes-operator-screen.js`, `boot-screen-assignment.js` resolve + `defaultOperator`, `x-screens.js`).
- `x-screens-sync.js`: `dropForBootQuestion` — node start-up with a boot question pending (launcher or WO-638 ask) and
  two screens installed → helper `off` + nodm restart + xrandr cache invalidated → the question runs on ONE X screen,
  exactly the pre-WO-906 flow (prompts on every head, `prepare` spreads stacked outputs). While it is open a full Apply
  does not re-install the split. `settleAfterBootAnswer` (in the held `prestart`): after the answer's cables are saved,
  install the split they imply (nodm restart when it changed), lay out xrandr per screen, write caspar-env, then release
  Caspar. Caspar already up (backstop / node restart mid-question) → `closeBootQuestion` and the full apply re-splits.
- `restartX` invalidates the 60 s xrandr cache: without it the prompts were labelled from the two-screen positions
  (DP-0's prompt said "DP-6") and `prepare` missed X's fresh overlap (DP-0 and DP-6 both at +1920).
- `MACHINE_LOCAL_CASPAR_KEYS = ['operator_gui_first', 'playout_x_screen']` in `project-hardware-config.js`.
### Verified (box, simulated boots: boot record cleared while node was down, gate file emptied, Caspar restarted)
- Run 1: "[X screens] boot question: playout X screen off …" → 1 X screen, Caspar held; launcher on all three heads but
  mislabelled (cache) → fixed. Clicked DP-4: "two-screen layout installed … nodm restart", "Caspar start released",
  Caspar `DISPLAY=:0.1`, 2 screens. (The answer also dropped the DP-6 operator_gui_2 cable — WO-638's one-operator
  re-cabling, unchanged by this WO; restored from the backup.)
- Run 2 (with the cache fix): "stacked outputs laid out left to right: DP-0, DP-4, DP-6"; prompts "Screen 1 — DP-0",
  "DP-4 (operator screen now)", "DP-6", each with Start operator here. **Clicked DP-0**: cables gpu_p0→gpu_p2, conf
  `:0.0 = DP-0`, `:0.1 = DP-4`, GUI on DP-0, Caspar `:0.1` with `__GL_SYNC_DISPLAY_DEVICE=DP-4`, 50/s. Then the owner's
  setup restored (config backup + forced Apply): `:0.0` DP-4,DP-6 / `:0.1` DP-0, casparcg.config identical, 0 drops.
- `smoke-wo906-playout-x-screen` 9/9 (boot drop / close / Apply held during the question; machine-local strip);
  wo638 / wo645 / wo599 smokes pass.

## 8. Performance: one X screen vs two (31.10.26, owner: "Run performance tests … If the tests are positive you can permanently add this as the default")
**Method** (scratchpad `perf/sample.py` + `perf/run.sh`): the same four 40 s scenarios per mode, two rounds, alternating
two → one → two → one (switch via `playout-screen.sh`, 40 s settle). Sampler: ch2 screen consumer presented / dropped and
the visuals shm frames from OSC :6250 (read-only), the interval between presented-counter updates (pacing proxy), CPU of
casparcg / Xorg / godot from /proc, GPU util from nvidia-smi. Scenarios: idle (Live tab); previs (Godot's 3D Previs tab
open, GUI GPU load); misaction (alt-tab ×10, super ×5, Escape, F11 on/off, openbox move-window); modeset (operator DP-6
50 → 60 → 50 Hz).

| scenario | one screen (r1 / r2) | two screens (r1 / r2) |
|---|---|---|
| idle | 50.0 / 50.0 fps, 0 / 0 drops | 50.0 / 50.1 fps, 0 / 0 drops |
| previs | 50.0 / 50.0, 0 / 0 | 50.0 / 50.0, 0 / 0 |
| misaction | 50.0 / 50.0, 0 / 0 | 50.0 / 50.0, 0 / 0 |
| modeset (2 changes) | **3 / 2 drops** (≈570 ms stall, caught up) | **35 / 33 drops** (≈425 ms stall, frames lost) |
| Caspar CPU idle / previs / modeset | 151–156 / 117–122 / 108 % | 142–232 / 165–208 / 178–180 % |

- Presentation is identical in normal operation: 50 fps, 0 drops in both modes for idle, GUI GPU load and misactions
  (one screen is already immune to these since WO-888, so the misaction test cannot show the isolation benefit).
- **Operator mode change: ~10× more dropped frames on two screens** — §5's finding reproduced with the final code.
- **CPU:** on two screens one unnamed Caspar thread spun at ~80 % (user time, wchan 0) in some runs — gone on one
  screen. Caspar total up to +90 % in those runs. In the same runs the OSC presented-counter updates arrived paired (+2
  per message, 40 ms gaps) while shm still delivered 50 new frames/s (no repeats/skips) → an OSC send coalescing
  artifact under that CPU load, not output judder; output pacing unaffected (0 drops).
- **Verdict: not positive** (equal at best, worse on modesets and CPU) → NOT made the factory default
  (`factory-starter.js` untouched). The box stays ON per the owner's choice; it is a per-box switch.
- Follow-up candidates: the spinning thread (NVIDIA swap wait on screen 1 — try `__GL_YIELD=USLEEP` for Caspar),
  then re-run `perf/run.sh` before revisiting the default.

## 9. Reverted to one X screen (31.10.26 19:29, owner: "Seems the two screen is not worth it. Revert to the standard one x screen for all outputs")
- `scripts/runtime/playout-screen.sh off`: flag removed, conf moved to `98-highascg-screens.conf.prev`, nodm + Caspar
  restarted. Verified: `xdpyinfo` 1 screen 7680x1792 (DP-4 0, DP-6 1920, DP-0 3840); Caspar `DISPLAY=:0`,
  `__GL_SYNC_DISPLAY_DEVICE=DP-0`; casparcg.config `<x>3840</x>` again; GUI up; OSC 50/s, 2 drops at the Caspar
  restart, then flat.
- The code stays, inert while the switch is off (no conf installed → every per-screen path takes the one-screen branch;
  default off, not in factory-starter). `playout-screen.sh status` fixed (an f-string with escaped quotes did not parse).

## 10. Code removed (31.10.26)
Owner: "I want it gone. No need to keep dead code." The five WO-906 commits (c113eeb3, 962b26f5, 240512e7, a0754b39,
1446a37f) were reverted as code; only this record stays. The intervening WO-881 / WO-897 / CI changes in the same files
(run.sh, tools/ci/offline-test-files-2.js, tools/ci/unwired-exports-baseline.json) are kept — the reverted tree matches
c113eeb3^ plus those.
- Gone: src/utils/x-screens.js, src/utils/x-screens-sync.js, src/api/routes-playout-screen.js (+ router entry, HTTP
  contract row), scripts/runtime/playout-screen.sh, scripts/runtime/install-xorg-screens-apply.sh,
  tools/runtime/highascg-xorg-screens-apply.sh, both smoke-wo906-* files; run.sh no longer reads CASPAR_DISPLAY;
  the `:0.1` branches in xrandr apply/persist/safety/custom-mode, hardware-info-xrandr, nvidia-display-policy,
  full-config-apply, screen-consumer-placement, caspar-gl-sync-env, the generator layout sync and the boot gate
  (dropScreens/closeScreens/settleAfterBootAnswer) are back to their pre-WO-906 form. `playout_x_screen` is no longer a
  machine-local key (only `operator_gui_first`). The §7 rule stays: the boot launcher offers every screen (the guard
  never shipped in the final code).
- Box: config has no `playout_x_screen`, caspar-env has no CASPAR_DISPLAY. Root-owned leftovers need the owner (no
  sudo for rm): `/usr/local/lib/highascg/highascg-xorg-screens-apply.sh`, `/etc/sudoers.d/highascg-xorg-screens`,
  `/etc/X11/xorg.conf.d/98-highascg-screens.conf.prev` — inert (the sudoers line only allows that helper).
- Verified: node restarted on the reverted code, `GET /api/system/playout-screen` → 404, no require errors in the
  journal; CI gates + offline suite in a clean worktree (see commit).
