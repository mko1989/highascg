# WO-1012 — Zoom integration via the Zoom desktop client: its windows on hidden virtual desktops as live inputs (presenter / share / gallery), the normal Zoom window on the operator monitor, two-way audio, and a program feed back into Zoom
**Area:** video-io, audio, devices-config, godot-client
**Status: OPEN — PLAN ONLY (09.11, owner: "write a wo (just this so i wont forget)"; no code yet)**

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
   x11grab'd by window id / region. A hidden window that is unmapped stops rendering, so "hidden" has to mean
   off-screen-but-mapped or behind the operator GUI, not minimised. **This is the first spike.**
2. **Sources** = window plus mode, one host channel each, chosen per input:
   - **Presenter / active speaker**: a Zoom video window in Speaker view.
   - **Share**: the screen-share window ("dual monitors" mode in Zoom settings separates share from video).
   - **Gallery**: a window in Gallery view.
   Each one becomes an x11grab bridge (browser-capture-bridge shape) into a dedicated host channel. Windows are found
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

## Open questions

- Does Zoom on Linux (X11) let the popped-out share or video windows be moved off-screen and still render? (Spike.)
- Can Speaker and Gallery be shown at the same time? (One meeting window has one view, so Gallery and Presenter at once
  may need the second-monitor mode or a second Zoom window.)
- Clean frames: hiding Zoom's toolbar and name overlays (settings: "always show video controls" off, hide
  non-video participants, etc.).
- Latency of x11grab at 1080p50 with several grabs, and GPU / CPU cost next to Caspar.
- Licensing: none (stock client). The owner's Zoom account settings decide the share and "dual monitor" options.

## What was done

Nothing yet (plan only, by owner instruction).

## What was verified

Box facts only (09.11): `/usr/bin/zoom` exists; v4l2loopback is not loaded (no `/dev/video*`); X screen `:0` is
5120×1080.
