# WO-741 — VR: walk into the MVR scene and program lights from inside it (future)

**Status: DONE (24.10.26) as detachable future development — steps 1–2 built: the client flag `-- --xr` walks the
Previs at 1:1 and programs through the walk camera / a controller ray. Proven without a headset: Godot tests and a GUI
e2e in the sandbox (`run-gui-e2e.js --e2e=06_xr_walk --xr`: 4/4). The OpenXR (headset) path is built but untested:
no headset or runtime on any box. Step 3 (the full Programmer on the left wrist) built 25.10 in
[WO-757](./757_WO_vr_programmer_panel.md); step 4 is not built. See "How to
remove". 24.10: the Meta Quest path through WiVRn is ready to test (`godot/client/run-xr.sh`,
`help/vr-walk.md`); WiVRn 26.9 installed and running on .4 (published on the LAN); headset = owner.**

Owner, 24.10: *"write it down for future. allow walking into the mvr scene and programing from vr. mostly for lights
preprogramming."*

## Investigation (what already exists)

- **The scene.** The Godot previs is native 3D: Forward+ renderer (`project.godot:32`, WO-607), with an orbit camera
  in `features/previs/previs_stage.gd`. It holds:
  - the MVR import: geometry, layers, and fixtures with their GDTF types (WO-612 / 636 / 643);
  - LED screens carrying the live channel texture (WO-634);
  - beams drawn from the fixtures' live values (WS `tracking:fixtures`, `gdtf-visual.js`).

  Standing inside the venue is "only" a different camera and different input.
- **Programming.**
  - The Programmer (`programmer_section.gd`, WO-615 T6) selects typed fixtures and sets intensity, colour, CTO,
    pan / tilt, zoom and gobo through `POST /api/fixtures/program`, coalesced to 20 Hz.
  - **Point at** aims the selected heads at a floor point through the server's follow IK. In VR that becomes
    "point the controller at the floor, pull the trigger".
  - **Looks** store the programmer's state per look (`look_fixtures_model.gd`, WO-615 T8: `project.fixtures.looks`).
    A PGM TAKE crossfades the rig to that look.
  - So preprogramming in VR = select + set + Point at + Store into a look. The API exists; the VR client needs
    no new server work for a first version.
- **Calibration** (WO-700 / 713) makes the digital beams land where the real ones do. VR preprogramming is only
  trustworthy on a calibrated or correctly patched rig. Without one, programming in VR is programming the model,
  which is exactly what preprogramming is.
- **Godot 4.7** has OpenXR built in (XROrigin3D / XRCamera3D / XRController3D, hand tracking, passthrough). No
  plugin is needed for the basics. Godot XR Tools (MIT) adds teleport / smooth movement and pointer interaction.

## Shape of the work (when it starts)

1. **XR mode in the previs.** An XROrigin3D replaces the orbit camera when a headset is present. The same stage
   nodes are used, so the MVR scene, beams and LED textures come for free. Movement: teleport plus snap turn, for
   comfort; smooth walk as an option. Scale 1:1, so the MVR's metres are real metres.
2. **Pick and aim.**
   - The controller ray selects fixtures, with a grip modifier adding to the selection, mirroring ctrl-click.
   - A trigger on the floor or a surface = Point at, using the same server IK route.
3. **A wrist / floating panel.** The existing Programmer UI rendered into a SubViewport on a quad, operated with the
   ray. It reuses `programmer_section.gd`, not a second UI (minimalism; one source of truth). It covers intensity,
   colour, zoom, gobo, Store to look and Release.
4. **Optionally, later.** Stand where the audience or a camera stands (presets from the MVR / tracking cameras), to
   check sightlines and how looks read from the house.

## Constraints and open questions

- **Never on the on-air kiosk.** The playout box's GPU and display serve Caspar and the operator GUI. VR rendering
  at 72–120 Hz per eye is a heavy, latency-critical load. The Godot client is already a network client (it can run
  on another machine against the server, as the Mac does), so VR should be a client on a separate PC or a
  standalone headset talking to the box's API. Programming over the LAN is what the Programmer already does.
- **Headset path, unverified.**
  - (a) A PC client with a tethered or streamed headset: SteamVR or Monado on Linux, WiVRn / ALVR for Quest
    streaming.
  - (b) A native Android/Quest export of the client, which raises questions about the native modules (shm
    surfaces, WO-594) and about video textures over the network instead of shared memory.
  - Choose after a hardware test.
- **Live LED textures** reach the previs through local shared-memory surfaces (WO-594/617). A remote VR client
  needs them streamed (NDI or the existing remote surface path, if any). Without that, screens show stills. That
  is acceptable for lighting preprogramming.
- **The beam look decides the value.** Volumetric beams, gobo projection and colour accuracy in the headset decide
  how far VR preprogramming can be trusted versus a real-light check. Test this before building past step 2.
- **Safety.** Programming from VR changes what the rig does when the DMX output is on. The same rules as the
  Programmer apply: DMX leaves the box only while the Fixtures DMX output is on. Offer a "blind" (previs-only)
  default in VR.

## What was done (24.10, /loop: "include the future development but try to make those easily detachable")

Steps 1–2 of the shape above, as a separate folder behind a client flag. The kiosk never starts with `--xr`, so it is
unaffected.

- **`godot/client/features/previs/xr/xr_walk_model.gd`** (new, pure):
  - `start_pose`: eye height 1.7 m, 8 m downstage, looking upstage;
  - `step`: walks along the floor at any pitch, diagonals no faster, 1.4 m/s;
  - `look`: pitch clamped;
  - `keys`: WASD;
  - `snap`: 30° per stick push, re-armed at centre;
  - `trigger`: a head under the ray (or the nearest) → pick, grip adds; no head with a selection → the floor under
    the ray → aim at PSN `[x, -z, 0]`; else nothing.
- **`godot/client/features/previs/xr/xr_walk.gd`** (new), a Node3D on the Previs stage:
  - `attach(stage)` finds the Previs tab (the ancestor with `fixtures3d` and `aim_drag`). The Live tab's read-only
    3D view, which also uses `previs_stage.gd`, gets no walk.
  - **No headset:** its own first-person Camera3D becomes current. WASD walks (shift x3), polled only while the
    Previs tab shows, no text field has focus and ctrl/cmd is not held (⌘D still duplicates). Left-drag looks and
    the wheel steps.
    - Because `previs_stage.camera()` returns this camera, all the existing mouse programming works through it
      unchanged: click a head, ctrl-click to add, right-drag onto the floor to aim, Point at.
  - **Headset:** when `XRServer.find_interface("OpenXR")` is initialised, which needs Godot started with
    `--xr-mode on` and a running runtime (no `project.godot` change, so the kiosk never tries OpenXR):
    - the stage's SubViewport gets `use_xr`, plus XROrigin3D, XRCamera3D and left/right XRController3D;
    - right `trigger_click` → `trigger()` along the controller ray, through a non-current Camera3D on the controller
      whose viewport centre is the ray, so the existing `fixtures3d.hit` / `near` work as they are;
    - pick → `Sel.shared().pick`, aim → `aim_drag.aim` (POST `/api/fixtures/program/aim`, one request in flight);
    - left stick walks along the head's yaw, right stick snap-turns.
- **`previs_stage.gd`**: 4 lines marked `WO-741`:
  - the `walk` var;
  - `attach` in `_ready` only if `Config.args.has("xr")`;
  - `handle_input` gives the walk first refusal;
  - `camera()` returns the walk's camera.
- **`godot/client/tests/test_xr_walk.gd`** (new): the model, the desktop node's input (look, wheel, eye height),
  `attach` in and out of the Previs tab, and the 4 hook lines pinned.
- **`godot/client/e2e/scenarios/06_xr_walk.gd`** (new) and one line in `tools/e2e/run-gui-e2e.js` (`--xr` passes
  `-- --xr` to the client). Without `--xr` the scenario has one step, "Not run".

**Why a camera swap, not a second picking path.** The previs already programs from a camera and a screen point. A
first-person camera reuses every existing tool (select, aim, Point at, the Programmer column) with no copy to keep in
step. The headset only adds the controller ray, mapped onto the same calls.

**Not built:**
- ~~step 3, the Programmer as a panel inside VR~~ — built in WO-757 (25.10). Was: (in a headset today you aim and select; the sliders are on the
  desktop);
- step 4, house / camera viewpoints;
- a blind (previs-only) mode. There is none in the server today. Aiming from VR is exactly what a right-drag does:
  DMX leaves the box only while the Fixtures DMX output is on. **Owner decision:** whether a VR session should force
  blind.

## Meta Quest through WiVRn (24.10, owner)

Owner, 24.10: *"WiVRn is your best bet on Linux. Install the WiVRn server on Ubuntu and the WiVRn app on the Quest,
connect them over fast Wi-Fi or USB, and WiVRn becomes the OpenXR runtime. Then launch your Godot project with OpenXR
enabled and it'll show up in the headset. So I will be able to test VR with the meta quest."*

### Investigation

- **Install routes** (WiVRn README, Launchpad, 24.10):
  - The PPA `ppa:lvra/wivrn` (package `wivrn`, 26.9) builds **only for 26.04**. .4 is on 26.04.1 (RTX 2080 SUPER,
    avahi running), so the PPA works there.
  - This box is on 24.04.4 (RTX PRO 4000): Flathub `io.github.wivrn.wivrn`, and `flatpak` is not installed.
    Both routes need sudo, which this session has on .4 only.
  - The server and the Quest app must be the same WiVRn version.
  - Wi-Fi needs avahi plus 5353/udp and 9757 tcp+udp. USB uses `adb reverse tcp:9757 tcp:9757` and then starts the
    app with a `wivrn+tcp://localhost` intent.
  - WiVRn's README says NVIDIA (NVENC) works but is "not properly optimized".
- **WiVRn registers itself as the OpenXR runtime only while a headset is connected**, and reverts afterwards. Godot
  starts OpenXR only at launch, so the client must start **after** the Quest connects.
- **`--xr-mode on` with no runtime blocks.** Godot 4.7.2 stops at a modal OS alert, "OpenXR was requested but failed
  to start … Godot will start in normal mode", until someone presses OK. Seen live on Xvfb `:378`.
- **The client's own restart dropped the headset.** `connection_menu.gd` `restart()` (A/B switch, and
  `cluster_follow.gd:176` when following the master) rebuilt its arguments from `get_cmdline_user_args()` only.
  `OS.get_cmdline_args()` does not contain `--xr-mode` (probe: `godot --xr-mode off -s a.gd -- --xr` →
  `ARGS ["-s","a.gd"]`). A client in a headset that restarts to follow the master would come back on the desktop.
- `run-client.sh` puts everything after `--`, so it cannot pass an engine flag.

### What was done

- `godot/client/run-xr.sh` (new): the client in a headset.
  - Waits up to `XR_WAIT_S` (120 s) for an active runtime, using the loader's order: `XR_RUNTIME_JSON`,
    `~/.config/openxr/1/active_runtime.json`, `/etc/xdg/openxr/1/active_runtime.json`. Then exports
    `XR_RUNTIME_JSON` and runs `godot --xr-mode on -- --xr --windowed --tab=1`.
  - With no runtime it uses `--xr-mode off`: the desktop walk, never the modal.
  - Uses its own Godot user dir (`XDG_DATA_HOME=~/.local/share/highascg-xr`), so the kiosk's window, profiles and
    follow setting are untouched. Only `XDG_DATA_HOME` is changed: the OpenXR loader reads `XDG_CONFIG_HOME`.
- `godot/client/app/connection_menu.gd` `restart()`: one line marked WO-741. When OpenXR is initialised, the new
  process gets `--xr-mode on`.
- `godot/client/help/vr-walk.md` (new): the owner's setup guide. Install (26.04 PPA / 24.04 Flathub), the Quest app,
  connect over Wi-Fi or USB, `run-xr.sh`, the controls, the desktop fallback, troubleshooting, and "not while on air".
  It uses the WO-740 Markdown subset (commands as inline code: the renderer has no code blocks).
- **WiVRn on .4** (owner's choice, 24.10):
  - `ppa:lvra/wivrn` added. The binaries are `wivrn-server` + `wivrn-dashboard` 26.9-0ubuntu2, not `wivrn` as the
    Launchpad page says. A dry run first: 26 new packages (Qt / KDE libs), 0 upgraded, 0 removed, no driver or
    kernel change.
  - `systemctl --user enable --now wivrn` for casparcg.
  - The packaged user unit failed under systemd 259: `Failed to drop capabilities: Operation not permitted`, status
    218/CAPABILITIES. Its `ProtectClock` / `ProtectKernelLogs` / `ProtectKernelModules` make systemd drop
    capabilities, which a user manager may not do. Drop-in `~/.config/systemd/user/wivrn.service.d/highascg-wo741.conf`
    sets those three to false (the other hardening stays).
  - No firewall on .4 (no ufw, no nft drop / reject rules); avahi was already running.
  - `help/vr-walk.md`: the real package names, the service, the drop-in, and pairing (`wivrnctl pair` prints a PIN).

### What was VERIFIED

- Godot 21639 passed, 0 failed:
  - `test_xr_walk.gd` `test_headset_launch`: the launcher's exec line, on only with a runtime, its runtime and user
    dir, the restart line, and the help page title;
  - `test_help_pages.gd`: `vr-walk` loads and its links resolve.
  - Mutation: the restart line deleted → `test_headset_launch` fails (restored).
- `--check` boot OK.
- **Live on Xvfb `:378`** (no runtime installed): `run-xr.sh` printed the wait, then "no OpenXR runtime — starting
  the desktop walk".
  - First run (with `--xr-mode on` regardless): the modal above, which is why the launcher now passes `off`.
  - Second run: no alert. The client opened on Previs with the walk camera at eye height, restarted itself to follow
    the master (.4) and came back on Previs with `--xr`. Stopped by PID.
- **.4 WiVRn:** `systemctl --user is-active wivrn` → active. Journal: `WiVRn 26.9 starting`, `To pair a new headset
  use PIN code: …`, `Service published: highascg5867`. `wivrn-server` listens on `*:9757`.
  - From this box, a raw mDNS PTR query for `_wivrn._tcp.local` was answered by 192.168.0.4 naming highascg5867, so a
    Quest on this LAN will list it.
  - `wivrnctl pair -d 1` printed `PIN: …`; `list-paired`: no paired headset yet.
  - `run-xr.sh` finds .4's Godot (`~/.local/opt/godot/godot`). It reaches .4 with the next server update.
- **Not verified:** the headset itself. It needs the Quest app (same version, 26.9), pairing, and the owner wearing
  it.

## How to remove (owner decision at the end)

- Delete `godot/client/features/previs/xr/`, `godot/client/tests/test_xr_walk.gd` and
  `godot/client/e2e/scenarios/06_xr_walk.gd`.
- Remove the 4 lines marked `WO-741` in `godot/client/features/previs/previs_stage.gd`. `camera()` goes back to
  `return _cam`.
- Remove the line marked `WO-741` in `tools/e2e/run-gui-e2e.js`, and its usage line in the header comment.
- Delete `godot/client/run-xr.sh` and `godot/client/help/vr-walk.md`. Remove `"vr-walk"` from `TOPICS` in
  `godot/client/tests/test_help_pages.gd`, and the 3 lines (`var xr` … `args = …`) marked WO-741 in
  `godot/client/app/connection_menu.gd` `restart()`.
- WO-757 (the wrist Programmer): its files are in `xr/`. Optionally drop `var mirror` and its `if not mirror:` in
  `programmer_section.gd` (harmless when false). `look_fixtures_store.gd` stays: the Live tab's look menu uses it.
- No server, `project.godot` or data changes to undo. WiVRn on .4: `systemctl --user disable --now wivrn`, delete
  `~/.config/systemd/user/wivrn.service.d/`, `sudo apt purge wivrn-server wivrn-dashboard && sudo apt autoremove`,
  `sudo add-apt-repository --remove ppa:lvra/wivrn`.

## What was VERIFIED

- **Godot tests:** 21616 passed, 0 failed (`test_xr_walk.gd`: 5 tests, including the pinned hook lines).
- **GUI e2e in the sandbox** (`node tools/e2e/run-gui-e2e.js --e2e=06_xr_walk --xr`): **4 passed, 0 failed, no
  SCRIPT ERROR** in `godot.log`, on the real client under Xvfb against a sandbox server:
  1. The Previs renders through the walk camera, current, y = 1.7. The screenshot shows a first-person view over
     the stage floor (the sandbox has no MVR scene).
  2. Holding W 0.5 s walks upstage (z 8 → 7.28).
  3. A left-drag of 150 px turns the view (yaw < -0.2). The screenshot shows the floor edge turned.
  4. A right-press on the floor with a head selected sends `{"ids":["e2e-head"],"target":[2.28,-3.94,0]}`, which
     equals the floor point under that pixel through the walk camera. The request was captured in the client, not
     sent.
- **First run gave false PASSes.** `page` was a local that the step lambdas captured by value, so steps 2–4 hit
  null. `e2e_scenario.gd` counts a lambda that dies on a runtime error (it returns null) as a pass. I fixed the
  scenario (a member var), and the green above has no SCRIPT ERROR. **The harness weakness remains** (WO-719
  `step()`: `why == null` → ok); it is worth a follow-up.
- **Without `--xr`:** `--e2e=06_xr_walk,05_live_inputs` gave 4/4. 06 says "Not run", and the normal client shows
  no walk.
- `run-client.sh --check`: boot OK. Gates: repo-integrity, max-lines (0 over), unwired, boot, format, and test:ci
  3193 pass / 1 fail (WO-498, export-only, as always). Lint 214 (cap 216).
- **Not verified:** anything with a headset (OpenXR init, controller action names `trigger_click` / `grip_click` /
  `primary` from Godot's default action map, `use_xr` on a SubViewport, comfort). Needs a headset and a runtime
  (SteamVR / Monado / WiVRn) on a non-playout PC, per the constraint above.
