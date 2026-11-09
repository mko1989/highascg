# WO-1012 — Zoom integration via the Zoom desktop client: its windows on hidden virtual desktops as live inputs (presenter / share / gallery), the normal Zoom window on the operator monitor, two-way audio, and a program feed back into Zoom
**Area:** video-io, audio, devices-config, godot-client
**Status: IN PROGRESS (09.11, owner: "start work on zoom integration") — stage A done (window grabber, Zoom device API, sources as shm rings / Live sources); next: host channels, audio, return camera, inspector UI**

Owner, 09.11 (verbatim):
> write a wo (just this so i wont forget) for zoom plugin/integration.
> id like to be able to open zoom windows on a virtual desktops and grabed as input/host channels so they can be used
> as live inputs with a chosen source (presneter, share, gallery)
> id like to have the normal zoom window on my operator monitor and just the seperate windows hidden.
> this needs both ways audio routing as well as video output (screen destination, or input channel) routing to be the
> source of video for zoom.

## How this differs from WO-521

WO-521 (OPEN, plan only) joins meetings through **CoreVideo / the Zoom Meeting SDK**. That route gives per-participant raw
frames, but it needs an SDK entitlement, a first-ever Linux build of the engine, and has no send path.
**This WO is the other route:** run the **stock Zoom desktop client** (`/usr/bin/zoom`, installed on this box) and treat
its windows like any other screen content. That needs no SDK, no Zoom app review, and Zoom's own UI for join, mute,
admit and chat. The trade-off: the picture is what Zoom draws (its layout and overlays), not clean per-participant frames.
The two WOs can coexist; this one is the pragmatic first route.

## What already exists to build on (from the INDEX, 09.11)

- **WO-258 / WO-282 browser source.** A real Firefox runs on a virtual display (Xvfb), and ffmpeg **x11grab** captures a
  region of it into a Caspar **host channel** (`src/capture/browser-capture-bridge.js`, `browser-capture-args.js`,
  `browser-source-region.js`). There is real audio in, and an operator "Interact" that moves the window to the operator
  screen and back (`browser-source-session.js` `moveBrowserSourceToOperator` / `returnBrowserSourceToOffscreen`, via
  xdotool). This is the same shape this WO needs, with Zoom windows instead of Firefox.
- **WO-121 v4l2 input bridge** (`src/capture/v4l2-input-bridge.js`): the spawn / stop / status pattern for
  external-process inputs.
- **Virtual camera out** (WO-109 / 137 / 145 / 399, `src/virtual-output/v4l2-bridge*.js`,
  `v4l2-kernel-modules.js`): Caspar STREAM → ffmpeg → a v4l2loopback `/dev/video10`. That is exactly "a screen
  destination or input channel as Zoom's camera". On 09.11 the module is **not loaded** (no `/dev/video*`), so the
  install / load step must be checked.
- **Host channels / screen destinations** (WO-414, WO-381 and the device graph), so a grabbed window becomes a channel
  the operator can route like a DeckLink input.
- Box facts: one X screen 5120×1080 (WO-906 reverted to one screen); the operator GUI runs on DP-4 (WO-868).
  Memories: each test Xvfb shows in NoMachine (clean them up); `flock` children inherit the lock; node-spawned children
  lack the user session environment (XDG_RUNTIME_DIR / DBUS — WO-780), which matters for PipeWire audio.

## Design sketch (to confirm before building)

1. **Zoom session on a virtual display.** Start Zoom on a dedicated Xvfb (e.g. `:98`, large enough for several windows)
   under the user session, so PipeWire and D-Bus work (WO-780). The **main Zoom window is shown on the operator monitor**
   (the owner's control surface): either Zoom runs on `:0` and only the popped-out windows move to the hidden display, or
   the main window is mirrored or moved to `:0` with the WO-258 "Interact" mechanism. To decide in a spike: Zoom is one
   process per X display, so a single client cannot span `:0` and `:98`. The likely answer is **Zoom on `:0`**, with the
   extra windows (pop-out share, a second video window) moved **off the visible desktop** or onto a hidden area, then
   grabbed by window id (shm ring, see "Transport" below). A hidden window that is unmapped stops rendering, so "hidden" has to mean
   off-screen-but-mapped or behind the operator GUI, not minimised. **This is the first spike.**
2. **Sources** = window plus mode, one host channel each, chosen per input:
   - **Presenter / active speaker**: a Zoom video window in Speaker view.
   - **Share**: the screen-share window ("dual monitors" mode in Zoom settings separates share from video).
   - **Gallery**: a window in Gallery view.
   Each one becomes a window → shm ring grab (see "Transport") into a dedicated host channel. Windows are found
   by WM_CLASS / title (`xdotool search --class zoom`), and the bridge re-finds the window after Zoom recreates it.
3. **Audio, both ways** (PipeWire):
   - **Zoom → HighAsCG**: Zoom's output device = a PipeWire null sink ("HighAsCG Zoom In"). Its monitor feeds the
     host-channel audio of the Zoom inputs (WO-282 shape), so the mixer sees it like any input.
   - **HighAsCG → Zoom**: a PipeWire virtual source ("HighAsCG Program") fed from a chosen mix (PGM or an aux, whatever
     the audio routing offers) and selected as Zoom's microphone.
   - Avoid the echo loop: the Zoom input's own audio must not return to Zoom as a mix-minus. The return mix excludes the
     Zoom channels. This is the key routing rule.
4. **Video to Zoom.** The program, or any screen destination or input channel, goes to the v4l2loopback virtual camera
   (existing WO-137/399 path), selected as Zoom's camera. The choice of source is a device-view route like the other
   destinations.
5. **UI.** Devices / Sources: a "Zoom" device with Start / Stop, a source picker per input (Presenter / Share / Gallery
   → host channel), the return feed picker (video + audio) and status (window found, grab running, devices present).
   Options belong in the inspector, not a new tab (rule: minimalism, inspector right).
6. **Opt-in.** Like WO-521 §4: nothing in core depends on Zoom. Off by default; a missing `/usr/bin/zoom` reads as
   "not installed".

## Transport: shared-memory rings, not x11grab → ffmpeg (owner 09.11)

Owner, 09.11: *"we have a shared memory input output now so maybe its better to use this as grab?"* Yes, and it was
the stated reason for building the rings. WO-742, owner 24.10: *"definitly shared memory … i think it will be useful for
future window grabbing from virtual screens"*.

- **In (Zoom window → Caspar).** A small native **window grabber** writes each chosen Zoom window into its own ring
  `/dev/shm/highascg-zoom-<source>` (hshm v1 header, `hshm_abi.h`; WO-743 / WO-745 writers are the models). The grab
  uses XComposite (the window's own pixmap, so it renders even when covered or off-screen) plus XShm. That is no
  encode, no ffmpeg, and one copy per frame. Caspar plays it as `PLAY <ch>-<layer> SHM NAME highascg-zoom-<source>` (the
  WO-742 producer, live on the box since 25.10). It appears automatically in `/api/shm/sources`, so it is also a Live-tab
  look source (WO-744) and a host-channel input. XComposite may also solve the "hidden windows" problem in design §1:
  the window can stay off-screen and mapped, and the grab reads its backing pixmap, not the screen.
- **Out (channel → Zoom camera).** The WO-594 shm **consumer** already writes a Caspar channel (a screen destination or
  input channel) into a ring. A ring → v4l2loopback writer replaces the Caspar STREAM → ffmpeg encode path of WO-399
  for this use, with lower latency and no encoder. Zoom selects that `/dev/videoN` as its camera.
- **Audio** stays on PipeWire (design §3). The rings carry video only. Lip sync: measure ring latency against the
  PipeWire path once both run.
- x11grab (WO-258) stays the fallback if XComposite capture of Zoom's GL windows misbehaves.

## Investigation — spikes on the box (09.11)

- **Box facts.**
  - Window manager: Openbox (`_OB_*` atoms on the root window), with 4 virtual desktops on one X screen 5120×1080.
  - Monitors: DP-6 = operator, 1920×1080 at 0,0. DP-2 = program, 3072×1024 at 2048,0 (Caspar `Screen consumer [2|3072x1024]`).
  - Zoom Workplace 7.1.0.3715 is installed and signed in to a free account. The main window is titled
    "Zoom Workplace - Free account".
  - The X dev headers for XComposite, XShm and XDamage are installed, along with g++ 15.
- **Virtual desktops do not work under Openbox.** `xdotool set_desktop_for_window <zoom> 3` gave
  `Map State: IsUnMapped`, because Openbox unmaps windows on other desktops. The grab then holds its last frame
  (`mapped:false`, `published` still counting); there are no live pixels. The owner's first idea (Zoom windows on
  virtual desktops) is therefore out on this box.
- **Off-screen does not work either.** `xdotool windowmove <zoom> 5400 100` was clamped by Openbox to X=1792. Part of
  the window then sat over DP-2 (the program monitor, showing the test card at the time) for about 3 s, then was moved
  back. Never move a grabbed window "off-screen".
- **What works: the BELOW layer, under the operator GUI.**
  - `_NET_WM_STATE_BELOW` (+ SKIP_TASKBAR/PAGER), then `_NET_MOVERESIZE_WINDOW` into the operator GUI's rect
    (`HighAsCG Operator`, 1920×1080 at 0,0).
  - The window stays `IsViewable` and is covered by the GUI: a :0 screenshot of the operator screen showed only the
    GUI.
  - XComposite still reads it: the grab showed the live Zoom home page, with its clock ticking.
  - The window can never reach a program monitor, because it is only ever placed inside the GUI's rect.
- **Grab cost.** A 1920×1080 grab at 30 fps (XComposite pixmap + XShmGetImage, one memcpy into the ring) gave 0 drops
  over 3+ s.
- **Zoom stores its settings encrypted.** `zoomus.conf` has no dual-monitor key. "Use dual monitors" (which gives a
  second meeting window, so Speaker and Gallery can run at once) is a Zoom Settings toggle the owner sets once.
- **Meeting windows still need checking.** The titles of in-meeting windows (meeting / dual-monitor second window /
  share) have not been seen yet, because no meeting was started (it needs a click in Zoom). Roles are a title guess
  and the operator picks the window.

## Open questions

- Does Zoom on Linux (X11) let the popped-out share or video windows be moved off-screen and still render? (Spike.)
- Can Speaker and Gallery be shown at the same time? (One meeting window has one view, so Gallery and Presenter at once
  may need the second-monitor mode or a second Zoom window.)
- Clean frames: hiding Zoom's toolbar and name overlays (settings: "always show video controls" off, hide
  non-video participants, etc.).
- Latency of x11grab at 1080p50 with several grabs, and GPU / CPU cost next to Caspar.
- Licensing: none (stock client). The owner's Zoom account settings decide the share and "dual monitor" options.

## What was done

### Stage A (09.11): window grabber, Zoom device API, sources as rings

- **`tools/window-grab/window_grab.cpp`** + `build.sh`: a native grabber that copies one X window into one hshm v1
  ring.
  - It reads the window's XComposite pixmap (automatic redirect) over XShm and writes it with the existing
    header-only `caspar/modules/shm/hshm_writer.h`.
  - The ring has a **fixed size**: the window is centred, and cropped or padded with black. `hshm::writer::attach()`
    unlinks the old name before re-attaching, so re-opening the same name on a resize would orphan the segment.
  - The ring outlives the window. stdin commands switch it: `window <id>` / `none`, plus the EWMH requests `below` /
    `normal` / `move X Y W H`, since there is no wmctrl on the box.
  - It writes JSON status lines on stdout. EOF on stdin ends the grab and unlinks the ring.
  - Built on first use; the build output is git-ignored and in `.stignore`.
- **`src/zoom/zoom-windows.js`**: lists Zoom's windows in one shell call. It keeps the mapped ones of a useful size,
  reports the BELOW state, guesses a role from the title, and finds the operator GUI's rect.
- **`src/zoom/zoom-grab.js`**: one grabber child per source, with its status parsed from stdout and the binary built
  lazily.
- **`src/zoom/zoom-session.js`**: the Zoom device.
  - Three fixed sources (presenter / share / gallery), each the ring `zoom-<source>`.
  - Hidden = BELOW + placed at the GUI rect, sized to the ring. One window feeds one source.
  - A 2 s re-bind check: when Zoom recreates a window, the source is re-bound by title (else by role) and hidden
    again.
  - `launch({ url })` takes a meeting link or number and turns it into `zoommtg://…join`, with the user-session env
    per WO-780. `quit` stops every grab and the client.
- **`src/api/routes-zoom.js`** (`GET /api/zoom`, `POST /api/zoom/{launch,quit,source}`), registered in `router.js`.
  `docs/wiki/api/contract/http.md` was regenerated.
- Each source ring is a Live-tab source at once (`/api/shm/sources` → `shm://zoom-<source>`, WO-744). Caspar plays it
  with `PLAY <ch>-<layer> SHM NAME zoom-<source>` (WO-742).

### Stage B (09.11): Zoom sources as host channels (`zoom_host`)

- `src/config/host-live-sources-zoom.js` adds a fourth host-live kind. The `extraLiveSources` entry is
  `{type:'zoom', routeType:'zoom_host', source, ring:'zoom-<source>', hostChannel, hostLayer, sourceId:'zoom_<source>',
  label:'Zoom <source>', value:'route://<ch>-<layer>', hostRole:'zoom_host'}`.
  - The channel defaults to the next free one. The mode is DEFAULT_HOST_MODE (1080p5000), because the ring has a fixed
    size, like NDI and browser.
  - The AMCP plan is `PLAY <ch>-<layer> SHM NAME zoom-<source>`, then `MIXER … FILL 0 0 1 1` and COMMIT. There is no
    ready-check: the WO-742 producer waits for a writer.
- `host-live-sources.js` routes the kind through the shared paths (destination id `host_zoom_<sourceId>`). So do the
  generator ("Caspar channel N: Zoom host"), the Device View role, live-source enrich and route heal. Allocation,
  pinning and the replay on reconnect are already generic.
- `src/api/routes-zoom-host.js`:
  - `GET /api/zoom/host` → `{ok, entries:[{source, hostChannel, hostLayer, route, configured, live}], needsRestart}`.
  - `POST {source, enabled}` saves through the Devices live-source path. It plays at once only onto an existing Zoom
    host channel, and STOPs on disable.
  - `needsRestart` is true when the applied config has no "Zoom host" comment for the channel, or the running Caspar
    lacks the channel.
- Godot: `host_channels.gd` and `live_sources_model.gd` know `zoom_host`, with the same destination id as the server.
- **Caution.** With a Zoom entry saved and the channel not yet in Caspar, a node restart makes the host-live setup
  rewrite the config and restart Caspar by itself (existing NDI and webpage behaviour). So save, then Apply & restart.

### Stage C (09.11): two-way audio on a private PipeWire daemon

- **No sound server by design.** The box runs none (WO-773 and WO-282: Caspar owns ALSA, and the DM3 is single-open),
  and `pipewire-bin` is installed but idle. So `src/zoom/zoom-audio.js` starts its own `pipewire` from a generated
  config (`zoom-audio-conf.js`):
  - sockets only under `$XDG_RUNTIME_DIR/highascg-zoom-audio`, with no `pipewire-0` and no `pulse/native`;
  - no ALSA and no device monitor; no defaults changed;
  - a Dummy-Driver clock;
  - nodes "HighAsCG Zoom In" (Zoom's speaker) and "HighAsCG Zoom Out" (its mic, a loopback fed by
    `highascg_zoom_out_feed`).
- **Zoom → HighAsCG.** A `pw-cat` record of the Zoom In monitor goes through ffmpeg into mpegts mp2 on
  `udp://127.0.0.1:52233`, which Caspar can PLAY.
- **HighAsCG → Zoom.** The feed (`pgm:<screen>` / `prv:<screen>`) gets a Caspar `ADD <ch>-9277 STREAM udp://…:52232`
  (pcm s16le, like the FFT tee). A node socket passes it to `pw-cat --playback` into the virtual mic.
- **No session manager.** A 2 s tick sets PortConfig and links only our nodes and streams whose app name matches
  /zoom/i (`zoom-audio-links.js`).
- **Mix-minus.** A feed whose INFO, followed through 2 `route://` hops, contains the Zoom In URL is refused, with a
  note.
- Off by default. The state is kept in `~/.highascg/zoom-audio.json` and restored on the first GET.
- `GET`/`POST /api/zoom/audio {enabled?, feed?}`. `POST /api/zoom/launch` adds only the `PULSE_SERVER/SINK/SOURCE`
  lines to Zoom's env while audio is on, and never takes them from the request.

### Stage E (09.11): the Zoom page in Devices

- A "Zoom" card at the end of the Devices rear panel (`node_panel.gd`) opens the Zoom page in the Inspector
  (`zoom_controls.gd`, logic in `zoom_model.gd`). The page has:
  - status;
  - a meeting link with Start and Quit (with a confirm);
  - per source: a window picker, Hidden, size, a live indicator and the host-channel toggle;
  - audio enable and feed.
- It polls `/api/zoom` (+ `/host`, `/audio`) about once a second, and only while visible. A section whose API is
  missing reads "not available yet".

### Stage B2 (09.11): Zoom sources as layers on an existing channel (replaces B's channel-per-source)

Owner: "also for zoom, how about using specific layers on the same channels and use route with specific layer as the
live input."

- **How it works.** Caspar's layer route (`video_channel.cpp` routesCb) sends `draw_frame::pop(layer foreground)`,
  which drops the layer transform. So a layer at `MIXER OPACITY 0` is invisible in its host channel's own picture,
  while `route://<ch>-<layer>` still carries the full frame. Layer routes fire in the same stage tick as channel routes.
- **Placement.** Presenter/share/gallery play on layers 21/22/23 of the first DeckLink input channel (OPACITY 0).
  The live input is `route://<ch>-<layer>`. With no DeckLink input, the sources share ONE generated "Zoom host" channel
  (one Apply & restart, once). Caspar 2.5 cannot add channels at runtime (WO-1016).
- **Placement follows the channel map** at PLAY, at the reconnect replay (`replayZoomLayers` in
  `host-live-sources-setup.js`) and at the route heal (`healZoomEntry`), so the saved value follows a renumber.
- **Guards.**
  - A PLAY happens only when the APPLIED casparcg.config gives the channel that role AND the running Caspar has it.
  - Borrowed channels are not pinned in the routing map.
  - Zoom PLAY failures never trigger the host-live auto-apply.
- **API.** `/api/zoom/host` keeps its shape: enable = save + PLAY, disable = STOP + save, and `needsRestart` is true
  only without a ready host channel. Stage-B entries are migrated by any POST and by the reconnect heal.
- **Godot.** The Zoom controls read "Live input", with no restart.

## What was verified

- **Offline.** `tools/smoke/smoke-wo1012-zoom.test.js`, 5/5, in the curated list. It covers:
  - window-dump parsing (unmapped and tiny windows dropped, BELOW state, roles);
  - join links;
  - hide placement (`below`, `move 0 0 W H`);
  - one window per source;
  - unknown source and unknown window refused;
  - un-hide, stop, re-bind by title, quit;
  - routes with raw JSON bodies.
- **Live on the box (09.11).**
  - `POST /api/zoom/source {"source":"gallery","window":"0x2000013","hidden":true}` gave:
    - the Zoom window resized to 1920×1080 at 0,0, with `below: true`;
    - the ring publishing at 30 fps (63 frames in about 2 s, 0 dropped);
    - `/api/shm/sources` listing `zoom-gallery` with `writer: window_grab` and `signal: true`.
  - The ring dumped to PNG showed the Zoom page.
  - `PLAY 3-990 SHM NAME zoom-gallery` on the preview channel: Caspar's INFO showed `producer shm`, `signal true`,
    `frames 60`, `lapped 0`. The layer was then stopped and cleared.
  - Before any of that, `/usr/bin/zoom` existed, v4l2loopback was not loaded (no `/dev/video*`), and the X screen was
    5120×1080.
- **Stage B, offline.** `smoke-wo1012-zoom-host` 12/12, plus related host-live and generator smokes 139/139. They
  cover normalize, ids, the AMCP plan, the generated "Zoom host" channel at 1080p5000 (not a DeckLink input), the
  Device View role, a single graph connector, the setup replay, and the routes (round trip, idempotent enable,
  `needsRestart` before and after an apply, `live` via OSC and INFO, the 400s). Godot
  `test_zoom_host_matches_the_server`.
- **Stage C, offline.** `smoke-wo1012-zoom-audio` 6/6: link policy, config (no ALSA, no defaults), enable, re-enable,
  feed change, disable, mix-minus, raw-body route. The launch-env test proves only the PULSE_* lines from zoom-audio
  reach Zoom.
- **Stage C, live with a stand-in (agent D).** A pulse client named "zoom" (ffmpeg, 440 Hz) was auto-linked into Zoom
  In, and the UDP tap received it (about −23 dB mean). 1 kHz sent to UDP 52232 was read back from the virtual mic.
  Everything was cleaned up afterwards, and the feature is left OFF.
- **Stage E.** Godot suite 26521/0 (`test_zoom_model.gd`), and the `--check` boot is OK.
- **Not yet:**
  - the live Apply & restart of a Zoom host channel;
  - real Zoom audio, and whether Zoom honours `PULSE_SINK`/`PULSE_SOURCE` or needs a one-time pick of "HighAsCG Zoom
    In/Out" in its Settings ▸ Audio;
  - Caspar playing `udp://127.0.0.1:52233`;
  - the grabs coming back after a node restart (window bindings are not persisted);
  - the 30 fps ring on a 50p channel;
  - the return camera (v4l2loopback needs `sudo modprobe`).
- **Stage B2, offline.** `smoke-wo1012-zoom-host` 15/15. It covers:
  - placement without renumbering, and the AMCP plan;
  - the shared channel listed once (generator, device view, graph);
  - migration, the heal on a renumber, and the replay ready/pending without auto-apply;
  - idempotent enable, the disable order, and the 400s.
  Godot 26562/0.
- **Stage B2, live (AMCP, agent G).** `PLAY 5-23 SHM NAME zoom-gallery` + OPACITY 0, then `PLAY 8-10 route://5-23`:
  - the ch 8 print showed mean luma 248.7 (the Zoom frame), while ch 5's own print stayed black with alpha 0;
  - `route://2-999` carried only the test-card layer;
  - two shm readers of one ring ran with lapped 0;
  - the 30 fps ring plays on a 50p channel.
- **B2 live (09.11 13:42):** node restarted (B2 loaded), then `POST /api/caspar-config/apply {force:true}` (the
  Devices Apply; WO-1017 D1(a) keeps Screen 3 as a mirror pair here):
  - Caspar now runs 9 channels: 1 GUI, 2/3 PGM/PRV 1, 4 "to zoom", 5/6 PGM/PRV 3 7680x2160, 7 DeckLink 1,
    8 DeckLink 2, 9 audio preview 64x36. The old Zoom host channel is gone.
  - Journal: `[route-heal] extraLiveSources re-pointed: "DeckLink 2": route://9-2 → route://8-2; "Zoom gallery":
    route://8-1 → route://7-23`, then `Host live sources: 1 started (zoom_host ch7)`.
  - `INFO 7`: layer 1 `decklink` (DeckLink 8K Pro), layer 23 `shm` `zoom-gallery`. `GET /api/zoom/host`: gallery
    `route://7-23`, `configured: true, live: true, needsRestart: false`.
  - WO-1013 restore ran on the same restart: `test card (card) re-applied on ch 2`, `Operator GUI re-apply: 2 cell(s)`.
  - GPU 17-18 % before and after (nvidia-smi), Caspar CPU 36 %.
  - Not yet proven: a Live-tab take of the Zoom gallery onto PGM (the route carrying the hidden layer was proven over
    AMCP in the B2 test above).
