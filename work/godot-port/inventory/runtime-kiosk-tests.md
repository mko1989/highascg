> **Provenance:** Haiku-generated inventory (2026-10-17) for [WO-593](../../work-orders/593_WO_godot_client_port_epic.md), spot-checked by hand where a WO relies on it. Line refs are to the 2026-10-17 tree (synced to `origin/main` d5521d50) and will drift; re-grep before acting on one.

# F. Runtime / deployment / test footprint of the Firefox operator kiosk

Repo: /Users/marcin/highascg (read-only; no git commands run). LOC = `wc -l`. Line refs are to the current working tree.
Excluded per brief: node_modules, .git, dist-web, client/tools/electron-launcher/sim-server, work/.

Terminology: "kiosk" = the operator GUI, a `firefox-esr --kiosk` window on X :0 spawned by Node
(`src/system/operator-gui-launcher.js:155`). The shape helper (python-xlib) punches SHAPE holes in that
window so the Caspar `operator_gui` screen consumer below it shows through.

Verdict on WO-258 browser sources: they ALSO run a Firefox per source (`src/system/browser-source-session.js:187-189`,
`spawn(bin, ['--kiosk', '--no-remote', '--new-instance', '--profile', profileDir, url])`) and the "open browser"
helper (`src/api/system-hardware-gui.js:147-148`, `spawnGuiDetached('firefox')`) also uses Firefox.
So Firefox is NOT removable from the repo while browser sources / Settings "Open browser" remain. Those
files are marked KEEP or CONDITIONAL below.

---

## 1. Kiosk / runtime code

### 1a. Launcher (spawn, placement, raise, profile)
| File | LOC | Purpose | Status if GUI is no longer Firefox |
|---|---|---|---|
| src/system/operator-gui-launcher.js | 352 | Spawns `firefox-esr --kiosk --new-instance --profile .operator-firefox-profile <url>` (l.155), raise via `xdotool windowactivate` (l.106), boot auto-launch retry (l.287-313), WM_CLASS matchers (header l.6-13) | DELETE |
| src/system/operator-gui-launcher-placement.js | 307 | Places/verifies the kiosk window on the operator monitor (xdotool move/verify, WO-279) | DELETE |
| src/api/routes-operator-gui.js | 94 | HTTP handlers: `launch`/`raise` (l.55-62) plus layout POST/GET/DELETE (l.34-92) | PARTIAL: launch/raise dead; layout GET is used by remote operator view (l.67-68); layout POST feeds shape helper |
| tools/runtime/highascg-launch-operator-firefox.sh | 97 | Shell launcher installed to /usr/local/lib/highascg; picks profile, alternates on lock (l.61-92), `exec firefox-esr -profile ... -url` (l.96) | DELETE (but see note: browser sources need a Firefox launcher too; this one is operator-specific) |
| src/system/operator-snap-home.js | 70 | Fixes root-owned ~/snap so snap Firefox can start | DELETE (snap Firefox only) |
| tools/runtime/highascg-operator-snap-home.sh | 25 | sudo helper for the above | DELETE |
| tools/runtime/highascg-clean-firefox-snap-leftovers.sh | 76 | Removes snap Firefox leftovers at install | DELETE (install helper; keep only if browser sources still use the apt Firefox and leftovers matter) |
| src/system/operator-gui-scale.js | 80 | Firefox DPI/zoom scaling for the operator_gui 4K case (l.1-10; Firefox `layout.css.devPixelsPerPx`-style env) | DELETE |

### 1b. Shape overlay (SHAPE holes in the Firefox window)
| File | LOC | Purpose | Status |
|---|---|---|---|
| src/system/operator-shape-overlay.js | 211 | Node side: spawns `python3 -u tools/runtime/operator-shape-overlay.py` (l.87), feeds `{monitor, rects, channel}` over stdin, kiosk top-assert (l.34 names WO-258 browser firefoxes) | DELETE |
| tools/runtime/operator-shape-overlay.py | 236 | python-xlib helper: punches SHAPE holes in the FIREFOX window at preview rects, keeps Caspar consumer below | DELETE |
| tools/runtime/operator_shape_overlay_lib.py | 464 | Xlib plumbing for the above (EWMH atoms, SHAPE punching, stacking) | DELETE |
| tools/smoke/xvfb-shape-overlay-harness.py | 142 | Xvfb behavioral harness for the shape helper (test-only) | DELETE |

### 1c. Helper windows / taskbar (nvidia-settings, file manager, browser stacked over the kiosk)
| File | LOC | Purpose | Status |
|---|---|---|---|
| src/system/operator-helper-window.js | 451 | Opens a helper window over the kiosk; suspends/restores kiosk top-assert (l.200, l.318-349) | DELETE (see note on "browser" action) |
| src/system/operator-helper-window-state.js | 151 | State machine for helper windows | DELETE |
| src/system/operator-helper-window-plan.js | 159 | Action→action-plan table (spawn, raise, below) | DELETE |
| src/system/operator-helper-coordinator.js | 133 | Coordinates helper + kiosk raise order | DELETE |
| src/system/operator-helper-applier.js | 133 | Applies planned actions | DELETE |
| src/system/operator-helper-live.js | 172 | Live state for taskbar | DELETE |
| src/system/operator-helper-registry.js | 181 | Registry of running helpers / raise-and-stress | DELETE |
| src/api/operator-helper-icon.js | 139 | Icon lookup for taskbar entries (firefox icon paths l.23-26) | DELETE |
| tools/runtime/highascg-window-above.py | 103 | xdotool-free promote-to-ABOVE + raise + focus (WO-283) | DELETE |
| tools/runtime/highascg-window-below.py | 117 | Park helper BELOW the Caspar consumer (WO-317) | DELETE |
| src/utils/x-display-session-gui-windows.js | 361 | xdotool window search for GUI tools; EXCLUDES the kiosk by title (l.36-42) | PARTIAL: window matching for helper windows dead; generic search may serve the browser helper |
| src/utils/x-display-session-runtime.js | 197 | X session runtime helpers; old in-process above/raise (l.~ header) | PARTIAL |

Note: `desktop-app-catalog*.js` (src/utils/desktop-app-catalog*.js, 275+311 LOC) is the generic app catalog for helper
windows. It is not Firefox-specific, but it is only consumed by the taskbar, so it is dead with the taskbar.

### 1d. Monitor placement / monitor picker
| File | LOC | Purpose | Status |
|---|---|---|---|
| src/system/operator-monitor-picker.js | 455 | WO-290 boot picker: paints "make this your operator screen" on each output | REWORK: still needed if the native app needs an operator monitor; the paint/prompt is kiosk-only in form |
| tools/runtime/operator-monitor-picker.py | 336 | python Xlib/Tk prompt for the picker | REWORK (same) |
| src/utils/operator-monitor-resolve.js | 155 | Resolves operator monitor port (WO-246), used by the Caspar operator_gui channel AND launcher | KEEP (generator also needs it) |
| src/system/screen-consumer-placement.js | 151 | Places Caspar screen-consumer windows | KEEP (Caspar consumer, not Firefox) |
| tools/startup/place-screen-consumers.sh | 122 | xdotool place "Screen consumer [n|" windows (l.46-64) | KEEP (Caspar consumers still exist) |
| tools/startup/diagnose-screen-consumers.sh | 88 | Diagnoses consumers; greps for "kiosk|chrome" (l.66) | KEEP (minor edit) |

### 1e. Channel / layout / config (operator_gui Caspar channel)
| File | LOC | Purpose | Status |
|---|---|---|---|
| src/config/config-generator-operator-gui.js | 137 | Emits the operator_gui `<channel>` + `<screen>` consumer (see section 3) | REWORK: `always-on-top false` / "HOLES in Firefox" comments are kiosk-only; channel remains if a Caspar consumer stays |
| src/config/config-generator-channel-plan.js | 110 | Plans operator_gui dims (l.77-81 `ogDests`) | KEEP |
| src/config/config-generator-channels.js | 215 | Wires `buildOperatorGuiChannel` (l.18, l.144-150) | KEEP |
| src/system/operator-gui-channel.js | 500 | Applies routes 10-49 layout as holes/MIXER FILL on the operator channel (`applyOperatorGuiLayout`, `clearOperatorGuiLayout`) | REWORK: hole-related logic dead; channel layout remains if preview layers are still used |
| src/system/operator-gui-channel-geometry.js | 327 | Rect math for cells on operator channel | REWORK |
| src/system/operator-gui-media-layer.js | 81 | WO-592 media preview cell on operator channel | REWORK |
| src/api/routes-media-preview.js | 58 | `POST /api/media/preview` "WO-592 kiosk preview" (router.js:326) | REWORK (depends on operator channel) |
| src/bootstrap/operator-gui-stream.js | 37 | Attaches remote NVENC stream for operator GUI (not Firefox-specific) | KEEP (remote view) |
| src/preview/gui-stream-ingest.js | 322 | NVENC gui-stream ingest for remote operator view | KEEP |
| src/api/routes-gui-stream.js | 38 | `GET /api/gui-stream/status` (router.js:106) | KEEP |

### 1f. Generic GUI launcher ("open browser", nvidia-settings, file manager) - shared
| File | LOC | Purpose | Status |
|---|---|---|---|
| src/api/system-hardware-gui.js | 437 | `spawnGuiDetached(action)` (l.31), `spawnOperatorFirefox` (l.147-148), `handleGuiLaunchPost` (l.362), helper-window/taskbar handlers (l.205-349) | PARTIAL: helper handlers dead; `firefox` action (l.53-85, l.373, l.393) is "Open browser" and stays only if browser helper stays |
| src/api/system-hardware-gui-resolve.js | 174 | Resolves binaries/paths for hardware GUI tools | KEEP (non-Firefox tools) |
| src/api/routes-system-hardware.js | 93 | Route dispatch for `/api/system/operator-helper-*` (l.38-46, l.69-73) and `/api/system/gui-launch` (l.64) | PARTIAL |
| src/utils/which.js | 55 | Binary lookup | KEEP |

### 1g. Browser sources (WO-258) - Firefox per source; KEEP if browser sources stay
| File | LOC | Purpose | Status |
|---|---|---|---|
| src/system/browser-source-session.js | 322 | Spawns one Firefox per browser_display source, `--kiosk --no-remote --new-instance --profile <per source>` (l.187-189) | KEEP (needs Firefox) |
| src/capture/browser-capture-bridge.js | 164 | ffmpeg x11grab of the Firefox window region (l.18-47) | KEEP |
| src/capture/browser-source-region.js | 113 | X root region where browser source Firefox lives (l.5) | KEEP |
| src/api/host-live-browser.js | 209 | Browser source handlers; "Interact on operator screen" xdotool-moves the Firefox (l.145) | KEEP |
| src/config/host-live-sources-browser-runtime.js | 57 | Wires session + bridge into host-live | KEEP |
| src/api/routes-host-live.js | 176 | `POST /api/host-live/browser` (router.js:251), `POST /api/host-live/browser/interact` (router.js:252) | KEEP |
| tools/runtime/highascg-launch-operator-firefox.sh | 97 | (see 1a) | CONDITIONAL: browser sources use Node spawn, not this script; this script serves the operator kiosk only |

### 1h. Index / bootstrap / run.sh
- index.js:45 `require('./src/bootstrap/operator-gui-stream')`; no direct Firefox code in index.js (grep matched only the unrelated "Serving operator UI" log at l.289).
- src/bootstrap/shutdown.js:85 calls `stopOperatorShapeOverlay()` (dead when shape overlay is removed).
- src/system/operator-gui-launcher.js:287 `maybeAutoLaunchOperatorGui(ctx)` is the boot-time Firefox spawn trigger. Its caller was NOT traced in this pass (not in index.js).
- run.sh: no Firefox/kiosk code. Only `/tmp/caspar-operator-restart` marker (l.204, operator restart fast relaunch) that is not kiosk-specific.

### 1i. Totals for section 1 (src/ + tools/ + scripts/ + config/ + index.js + run.sh grep set)
- DELETE group (21 files): 3,799 LOC (launcher, shape overlay, helper windows, snap-home, scale, harness).
- REWORK group (15 files): 3,556 LOC.
- KEEP group (9 files): 1,345 LOC (browser sources and monitor/consumer placement).
- Broad grep match set (src/tools/scripts/config/index.js/run.sh/template) covers several hundred files and about 40k LOC including tests, docs and deprecated scripts. It is broad because "operator-gui" and "shape" also match Caspar channel code. Use the three groups above, not the raw count.

---

## 2. Server API used only by the kiosk

Router registrations are in src/api/router.js. Handler file:line is where the call is dispatched.

| Method path | Registration | Handler | Kiosk-only? |
|---|---|---|---|
| POST /api/operator-gui/launch | router.js:261 | routes-operator-gui.js:55 -> operator-gui-launcher.js `launchOperatorGuiBrowser` | YES |
| POST /api/operator-gui/raise | router.js:262 | routes-operator-gui.js:59 -> operator-gui-launcher.js `raiseOperatorGuiBrowser` | YES |
| POST /api/operator-gui/layout | router.js:258 | routes-operator-gui.js:34 (feeds shape helper + channel holes) | YES (hole feed) |
| DELETE /api/operator-gui/layout | router.js:260 | routes-operator-gui.js:82 (clears holes + hides overlay) | YES |
| GET /api/operator-gui/layout | router.js:259 | routes-operator-gui.js:72 (remote operator view reads cells) | NO (remote view) |
| GET /api/system/operator-helper-window | router.js:138 | routes-system-hardware.js:38 -> system-hardware-gui.js:349 | YES |
| POST /api/system/operator-helper-window | router.js:156 | routes-system-hardware.js:69 -> system-hardware-gui.js:205 | YES |
| GET /api/system/operator-helper-taskbar | router.js:140 | routes-system-hardware.js:42 -> system-hardware-gui.js:288 | YES |
| POST /api/system/operator-helper-taskbar | router.js:157 | routes-system-hardware.js:73 -> system-hardware-gui.js:314 | YES |
| GET /api/system/operator-helper-icon | router.js:141 | routes-system-hardware.js:46 -> system-hardware-gui.js:258 | YES |
| POST /api/system/gui-launch | router.js:154 | routes-system-hardware.js:64 -> system-hardware-gui.js:362 (incl. `firefox` = Open browser) | NO (browser stays) |
| GET /api/system/operator-display | router.js:136 | routes-system-hardware.js:37 | NO (monitor info; picker-related, rework) |
| POST /api/system/setup/restart-window-manager | router.js:173 | routes-system-setup.js:344 (restarts WM/openbox) | Kiosk-adjacent; not inspected in detail |
| GET/POST /api/host-live/operator-fullscreen | router.js:244, :246 | routes-host-live.js:16, :42 | Operator-monitor feature, not Firefox-specific; not inspected in detail |
| POST /api/host-live/browser | router.js:251 | routes-host-live.js:145 | NO (WO-258 browser sources) |
| POST /api/host-live/browser/interact | router.js:252 | routes-host-live.js:159 (moves the Firefox onto operator screen) | NO (WO-258) |
| POST /api/media/preview | router.js:326 | routes-media-preview.js (WO-592 kiosk preview) | Rework; depends on operator channel |
| GET /api/gui-stream/status | router.js:106 | routes-gui-stream.js | NO (remote NVENC) |
| POST /api/network/tailscale/login-operator-ui | router.js:169 | routes-network-tailscale.js:86 | Name only; not Firefox code; not inspected |

Count: 13 routes are kiosk-only (launch, raise, layout POST/DELETE, 6 operator-helper routes incl. GET/POST window and taskbar and icon, plus the `operator-helper-icon` GET); 5 are shared or rework.

Note: `routes-system-hardware.js:65` `/api/system/pointer-confine` and `src/system/pointer-confine.js` (393 LOC) are the cursor-confine feature; they are not checked against the kiosk and should be verified before deletion.

---

## 3. Config generator for the operator GUI channel and screen consumer

Files: src/config/config-generator-operator-gui.js (137), config-generator-channel-plan.js (110), config-generator-channels.js (215), factory-starter.js, screen-destinations.js.

Flow:
1. Destination normalization (`src/config/screen-destinations.js`): `modeRaw === 'operator_gui'` maps to mode `operator_gui` (l.81-82). Explicit `physicalPort` 1-4 (l.151-152) and `headless` flag (l.155-160) are copied into the normalized dest. operator_gui is excluded from main-screen index (l.174).
2. Factory seed: `src/config/factory-starter.js:25-30` creates `dst_operator_gui` with `mode: 'operator_gui'`, `autoLaunch` default true.
3. Channel plan (`config-generator-channel-plan.js:77-81`): `ogDests = destinationsFromConfig(config).filter(d => d.mode === 'operator_gui')`; dims from `getModeDimensions` custom branch (config-modes.js:170-196).
4. Channel XML (`config-generator-channels.js:144-150` calls `buildOperatorGuiChannel(config, dest, dims, {cumulativeX, nextDevice, layout}, ch)`).
5. `buildOperatorGuiChannel` (`config-generator-operator-gui.js:65-135`):
   - Port resolution `resolveOperatorGuiPort` (l.20-44): headless returns null (l.24); explicit `physicalPort` (l.25-28); else `resolveOperatorMonitorPort(config)` (l.31, src/utils/operator-monitor-resolve.js); else multiview physical port (l.36-41).
   - Position from `resolveLayoutRectForOperatorPort` (l.70) else `cumulativeX`/0 (l.75-76).
   - `<device>1</device>` (l.80) fixed.
   - Screen consumer (l.82-100): `<x>`/`<y>` (l.84), `<width>`/`<height>` from dims (l.85), `<stretch>none</stretch>` (l.86), `<windowed>true</windowed>` (l.87), `<vsync>true</vsync>` (l.88), `<always-on-top>false</always-on-top>` (l.94), `<borderless>true</borderless>` (l.95), `<gpu-texture>true</gpu-texture>` (l.99).
   - Headless branch (l.109-120): channel with empty `<consumers>` and `<audio-osc>true</audio-osc>`; no screen consumer.
   - Normal branch (l.122-134): `<screen>` consumer inside `<consumers>`.
6. Launcher gating (`src/system/operator-gui-launcher.js:202-216`): no launch when headless (l.206), when `autoLaunch === false` (l.207), or when no monitor resolves (l.210-212). Explicit `physicalPort` launches (l.209).

Config keys that drive it:
- `mode: 'operator_gui'` (dest), `label`, `physicalPort` (1-4), `headless` (bool), `autoLaunch` (bool), `mainScreenIndex` (excluded from main index), plus the global operator monitor setting resolved by `resolveOperatorMonitorPort`.
- Video mode / dims come from the destination's own size: custom WxH (`getModeDimensions('custom')`, config-modes.js:170-179).
- Layout rect comes from `ctx.layout` via `resolveLayoutRectForOperatorPort` (config-generator-operator-gui.js:6, :70).

---

## 4. Install / ISO footprint

Packages and install steps
- scripts/setup/05-caspar-deps.sh:34 apt list: `nodm openbox unclutter xterm xdotool thunar python3-xlib`.
- scripts/setup/05-caspar-deps.sh:11-12 sources scripts/setup/lib/install-operator-firefox.sh; :37 calls `install_operator_firefox`.
- scripts/setup/05-caspar-deps.sh:68-76 nodm -> openbox; writes `~/.xsession` = `exec openbox-session`.
- scripts/setup/lib/install-operator-firefox.sh:16-17 PPA detection (`ppa.launchpadcontent.net/mozillateam`); :20-40 adds ppa:mozillateam/ppa and apt pin `/etc/apt/preferences.d/mozillateam-firefox`; :46-66 installs launchers to /usr/local/lib/highascg (highascg-launch-operator-firefox.sh, highascg-clean-firefox-snap-leftovers.sh, l.54-55); :70-100 installs firefox-esr (l.87 `apt-get install -y firefox-esr`) with snap fallback (l.90-91 `snap install firefox`) and last resort `apt-get install firefox` (l.95).
- scripts/setup/07-node-highascg.sh:84 and scripts/setup/08-caspar-cef-scanner.sh:95 only print "run 09-openbox-autostart.sh next" (no install).

Autostart / systemd
- scripts/setup/09-openbox-autostart.sh:80-144 writes `/home/<user>/.config/openbox/autostart`: `export DISPLAY=:0` (l.99), `unclutter -idle 2 -root &` (l.106), capture-boot-xrandr (l.108-112), apply-layout (l.116-119), NVIDIA apply (l.121-128), then the Caspar playout block. It does NOT launch Firefox; the kiosk is spawned by Node (`maybeAutoLaunchOperatorGui`, operator-gui-launcher.js:287).
- scripts/setup/13-caspar-systemd-units.sh:91-92 invokes 09-openbox-autostart.sh with OPENBOX_SKIP_NODM_RESTART=1.
- scripts/systemd/casparcg-server.service: no kiosk/Firefox/openbox references (grep empty).
- No repo polkit rule for the kiosk. The only polkit reference is Calamares: tools/eggs/live-usb/install-eggs-calamares.sh:128-142 (not kiosk).
- No kiosk-specific systemd unit under tools/eggs/live-usb/systemd/ (calamares-session-log-rescue.service, highascg-fb-corner-throbber.service: no kiosk terms).

Startup / verification scripts
- tools/startup/place-screen-consumers.sh:26 requires xdotool; :46-64 moves "Screen consumer" windows; :76-121 overlap report.
- tools/startup/diagnose-screen-consumers.sh:64-66 greps window tree for `kiosk|nodm|chrome`.
- tools/startup/verify-caspar-autostart.sh (77 LOC): matches openbox/autostart checks.
- tools/startup/stick-boot-test/tests/test-09-openbox-wiring.sh:4 reads `~/.config/openbox/autostart`.
- tools/eggs/live-usb/verify-highascg-stick-boot.sh:16 `AUTOSTART=/home/${USER_CASPAR}/.config/openbox/autostart`.
- tools/runtime/capture-boot-xrandr.sh (27 LOC) is called from openbox autostart; layout, not kiosk.
- tools/runtime/highascg-nvidia-x-apply.sh (136 LOC) is called from autostart; DISPLAY-related, not kiosk.
- scripts/deprecated/legacy/install-phase1.sh, install-phase2.sh, install-phase3.sh (235/189/203 LOC), scripts/deprecated/lib/install-helpers-packages.sh (258), scripts/lib/install-helpers-binaries.sh (251) matched the grep for openbox/firefox/xdotool terms. Not inspected line by line; treat as legacy.

ISO / eggs
- tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list:131-134 excludes `home/casparcg/.highascg/firefox-operator` (l.131 comment, l.133-134), and :238-239 excludes `home/casparcg/highascg/.operator-firefox-profile`.
- tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list:110-113 and :221-222 do the same.
- tools/eggs/live-usb/BUILD_AND_FLASH.md matched the terms (doc).
- tools/eggs/live-usb/verify-highascg-stick-boot.sh:16 (above).
- tools/eggs/live-usb/prepare-eggs-clone-with-exfat.sh matched the term grep; not inspected line by line.

Shape-helper runtime deps (for removal)
- python3-xlib is installed in 05-caspar-deps.sh:34 and in .github/workflows/ci.yml:37 (CI). Removing the shape helper removes the need, but `tools/startup/place-screen-consumers.sh` still needs xdotool.

---

## 5. Tests that pin client source, and tests that pin kiosk/runtime files

Method: a Node script in the scratchpad (not the repo) scanned tools/smoke/* and tools/ci/* for `readFileSync(...)` / `require(...)` calls whose argument text includes a client path (`'client/...'`, `'../../client/...'`, or `'client'` in path.join), plus tests that read a `CLIENT`/`STYLES`/`COMPONENTS` constant built from `path.join(..., 'client')`. Counts are regex-based and approximate by a few.

### 5a. Tests pinning client files
- Totals: **N = 64 tests pin client files** (56 via direct `readFileSync`/`require` with a client path literal, plus 8 that read through a `CLIENT` constant).
- Full per-test list with the client file literals is in the scratchpad at `/private/tmp/claude-501/-Users-marcin-highascg/9363bbd4-dc7d-4038-81d8-27ea731484b3/scratchpad/pins_out.txt` (lines starting `C `). Examples:
  - tools/smoke/smoke-wo243-operator-gui-crud-ui.test.js reads client/lib/device-view-host-channels.js and client/components/device-view-destinations-inspector-operator-gui-fields.js
  - tools/smoke/smoke-wo255-shaped-overlay.test.js reads client/lib/operator-gui-mode.js, operator-gui-mode-rects.js
  - tools/smoke/smoke-wo265-cg-studio-tab.test.js reads client/components/cg-studio-tab.js, client/app.js, client/lib/operator-gui-mode.js
  - tools/smoke/smoke-wo269-shape-log-dedupe.test.js reads client/lib/operator-gui-mode.js, operator-gui-mode-report.js
  - tools/smoke/smoke-wo256-operator-compose-tiles-*.test.js (5 files) read client/components/operator-compose-tiles*.js
  - tools/smoke/smoke-wo343-prv-watch-suppression.test.js reads client/lib/operator-gui-interaction-suppress.js
  - tools/smoke/smoke-wo367-wiring-gates.test.js reads client/app.js
  - tools/smoke/smoke-wo287-wo289-styles.test.js reads client/styles/*.css
  - tools/smoke/smoke-wo47-manifest.mjs reads client/tools/release/make-github-release-launcher.sh
- CI checkers that scan client/ (not per-test but run in CI): tools/ci/check-dom-escape-duplicates.js (`CLIENT = path.join(REPO, 'client')`), tools/ci/check-max-file-lines.js (500-line limit over client/src/scripts/tools), tools/ci/check-tdz-reads.js (scans client), tools/ci/check-unwired-exports.js (scans client/src/tools/template), tools/ci/check-require-integrity.js (client/index.js/tools).

### 5b. Tests pinning kiosk/runtime files (section 1)
- Totals: **M = 26 tests pin kiosk/runtime modules** by `require` or `readFileSync` of a kiosk file (launcher, shape overlay, helper window/registry/coordinator/applier/window-plan, monitor picker, system-hardware-gui, operator-gui-channel, browser-source-session, highascg-window-above/below, place-screen-consumers, openbox autostart, install-operator-firefox).
- Of these, 5 read the kiosk source as text (`readFileSync`):
  - tools/smoke/smoke-operator-gui-4k-scale.test.js
  - tools/smoke/smoke-operator-gui-reconnect-reassert.test.js
  - tools/smoke/smoke-wo243-operator-gui-guards.test.js
  - tools/smoke/smoke-wo255-shaped-overlay.test.js
  - tools/smoke/smoke-wo387-desktop-app-catalog.test.js
- The other 21 `require` the kiosk modules directly: smoke-boot-monitor-picker, smoke-new-project, smoke-operator-gui-launch-timing, smoke-wo243-operator-gui, smoke-wo258-browser-source, smoke-wo264-operator-gui-autostart, smoke-wo279-operator-gui-monitor-placement, smoke-wo283-operator-helper-window(-reuse-and-placement), smoke-wo290-operator-monitor-picker, smoke-wo317-helper-{applier,coordinator,registry,registry-raise-and-stress,taskbar-routes,window-plan}, smoke-wo325-headless-operator-gui, smoke-wo327-dest-overlay-dims, smoke-wo382-operator-tools-flag-settable, smoke-wo502-wo503-gpu-texture-and-blind-sweep, smoke-wo592-media-preview.
- Tests that will be dead with the kiosk removed (all helper/launcher/shape/monitor-picker-only): about 17 (smoke-wo283-*, smoke-wo317-*, smoke-wo290-*, smoke-wo255-shaped-overlay, smoke-shape-overlay-input-dead, smoke-operator-gui-launch-timing, smoke-wo279-*, smoke-wo264-*, smoke-operator-gui-4k-scale, smoke-wo258 stays only if browser sources stay).

### 5c. tools/ci/run-offline-tests.js and CI workflows
- tools/ci/run-offline-tests.js: curated `FILES` array at lines 14-362 with **346 entries** (all `tools/smoke/*.test.js` style; `--test` runner). It runs `check-dom-escape-duplicates.js` and `check-tdz-reads.js` first (l.363-377), then `node --test ...FILES` with `HIGHASCG_SKIP_SERVER_INTEGRATION=1` (l.379-391).
- Of the 346 curated entries, 42 carry kiosk/operator/shape/helper/browser/openbox names by filename, e.g. smoke-wo243-operator-gui*.test.js, smoke-wo255-shaped-overlay.test.js, smoke-wo283-operator-helper-*.test.js, smoke-wo317-helper-*.test.js, smoke-wo258-browser-source.test.js (in list), smoke-wo264-operator-gui-autostart.test.js, smoke-boot-monitor-picker.test.js, smoke-wo290-operator-monitor-picker.test.js, smoke-operator-gui-4k-scale.test.js, smoke-screen-consumer-placement.test.js, smoke-screen-consumer-port-resolve.test.js, smoke-shape-overlay-input-dead.test.js.
- Also in the curated list: smoke-wo265-cg-studio-tab.test.js and smoke-cg-studio.test.js (CG studio, client-only).

.github/workflows/ci.yml (triggers push main, PR, workflow_dispatch; concurrency group):
- Job `verify` (ubuntu-latest, 15 min): setup node 24; `npm ci`; apt install `xvfb x11-xserver-utils python3-xlib` (l.34-37, needed for the shape-overlay harness); `npm run verify:repo-integrity` (l.39-40); `node tools/ci/check-max-file-lines.js` (l.42-43); `node tools/ci/check-unwired-exports.js` (l.47-48); `node index.js --no-http` (boot check, l.50-51); `npm run lint` (l.53-54); `npm run format:check` (l.56-57); `xvfb-run -a npm run test:ci` (l.59-60); `node tools/ci/npm-audit-ci.js` (l.62-63).
- Job `build-client` (ubuntu-latest, 10 min): `npm ci`; `npm run build:client` (= `vite build`, package.json:12, l.82-83); asserts `dist-web/index.html` exists and dist-web >= 100 KB (l.85-90). Its purpose per the comment (l.65-67): the served UI only exists if vite build succeeds, and every module the bundle imports must resolve.
- .github/workflows/pages.yml: GitHub Pages deploy (build + deploy jobs), not kiosk.

---

## 6. Docs that describe the kiosk / operator GUI (need rewrite)

Match counts (terms: kiosk, operator gui/operator_gui, firefox, shape overlay, helper window, operator-helper, openbox, xdotool):
- docs/MANUAL_INSTALL.md (12) - install steps for Firefox kiosk and openbox
- docs/openbox_autostart.md (9) - openbox autostart; documents the Firefox kiosk
- docs/ISO_CONTENTS.md (9) - ISO packages (firefox-esr, openbox, xdotool)
- docs/LIVE_USB_IMAGE.md (8) - live USB kiosk
- docs/internal/virtual_walkthrough.md (6)
- docs/reference/screen-consumer-vsync-nvidia.md (4) - consumer below the kiosk
- docs/reference/multi-head-gl-vblank-sync.md (4)
- docs/internal/potential_autostart_fix.md (4)
- docs/CASPAR_IMAGE_VS_HIGHASCG_OVERLAY.md (4)
- docs/reference/tailscale-integration.md (2) - operator UI login
- docs/reference/cef-interactive-bridge.md (2) - CEF interactive (not Firefox; adjacent)
- docs/README.md (2) - index links
- docs/wiki/README.md (1), docs/wiki/api/system-settings-hardware.md (also matches operator helper routes), docs/wiki/guides/shader-fx.md (matched)
- docs/internal/SERVER_CONSOLIDATION_AND_USB_IMAGE_GUIDE.md (1), docs/WO47_ISO_VS_EXFAT.md (1), docs/PLAN_SERVER_CLIENT_SPLIT.md (1), docs/HIGHASCG_PASSWORDLESS_SUDO.md (1), docs/CALAMARES_INSTALL_TO_DISK.md (1)
- scripts/README.md, scripts/setup/README.md, scripts/setup/MANUAL_INSTALL.md (466 LOC), tools/startup/README.md, tools/eggs/live-usb/BUILD_AND_FLASH.md (206), tools/eggs/live-usb/README.md also describe the kiosk and need edits.

---

## 7. Totals (files and LOC)

Groups as defined in section 1i, using the file list in the grep set.

| Group | Files | LOC | Contents |
|---|---|---|---|
| DELETE (Firefox kiosk / shape / helper / snap-home / scale / harness) | 21 | 3,799 | src/system/operator-gui-launcher*.js, operator-shape-overlay.js, operator-helper-*.js (7), operator-snap-home.js, operator-gui-scale.js, operator-helper-icon.js; tools/runtime/operator-shape-overlay.py, operator_shape_overlay_lib.py, highascg-window-above.py, highascg-window-below.py, highascg-launch-operator-firefox.sh, highascg-operator-snap-home.sh, highascg-clean-firefox-snap-leftovers.sh; tools/smoke/xvfb-shape-overlay-harness.py |
| REWORK (partial kiosk code, channel/config/picker) | 15 | 3,556 | routes-operator-gui.js, system-hardware-gui.js, system-hardware-gui-resolve.js, routes-system-hardware.js, x-display-session-gui-windows.js, x-display-session-runtime.js, operator-gui-channel*.js (2), operator-gui-media-layer.js, config-generator-operator-gui.js, operator-monitor-picker.js, operator-monitor-picker.py, install-operator-firefox.sh (conditional), 09-openbox-autostart.sh, 05-caspar-deps.sh |
| KEEP (browser sources and Caspar consumer placement) | 9 | 1,345 | browser-source-session.js, browser-capture-bridge.js, browser-source-region.js, host-live-browser.js, host-live-sources-browser-runtime.js, routes-host-live.js, operator-monitor-resolve.js, place-screen-consumers.sh, capture-boot-xrandr.sh |
| Tests dead with kiosk (approx.) | ~17 smoke files | not summed | see 5b |
| Tests pinning client (kept, must stay green) | 64 | - | see 5a |

Deletions from DELETE group only: 3,799 LOC in 21 files. If the browser helper and browser sources are also removed, add browser-* KEEP (1,345 LOC) and the firefox-related launcher scripts.
Docs (section 6): about 19 docs/ files need rewrite.

The Godot replacement needs to keep: the operator channel layout feed (`POST /api/operator-gui/layout`) only if Caspar still renders the preview layers under the native app, and the remote NVENC gui-stream (routes-gui-stream.js, gui-stream-ingest.js) if remote operator view stays.

---

## Caveats
- Test pin counts are regex-based across multi-line `readFileSync`/`require` calls; treat as approximate (+/- a few).
- `routes-operator-gui.js` layout GET and the remote operator view depend on the operator channel; not Firefox-specific.
- Items marked "not inspected" (setup/restart-window-manager, host-live operator-fullscreen, pointer-confine, deprecated install scripts) were matched by term only.
- Working tree has many untracked files (git status); line refs are to the current working tree, not HEAD.
