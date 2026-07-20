# WO-282 — Browser source: real audio in, virtual display, operator control

**Source:** todos19.07.26 — "i have a feeling that playing shaders in cef won't let me use it as
intended. mostly audio might be hard. what we need to work thru is directing a proper audio source
to the browser. the browser source apart from getting a casparcg host channel should also get a
virtual display to be displayed in kiosk mode and that relayed to casparcg as a source played on
the host channel. what are the options for having control (mouse keyboard) over that window from
the operator position?"

**This is a research work order.** The deliverable is a written options analysis with a
recommendation, grounded in what this repo and this box actually do today. Implement nothing
beyond small, clearly-safe groundwork until the owner picks a direction.

## Established facts to start from (verify, do not assume)
- Shader FX has two playback paths, already documented in `docs/wiki/guides/shader-fx.md`: the CG /
  CEF template path (needs GPU enabled in CEF; audio reactivity is coarse) and the
  **browser_display source** path, which gets real FFT via `getUserMedia` against an ALSA
  monitor/loopback input, with a `?audioDev=` override. The owner's instinct that "CEF won't let me
  use it as intended, mostly audio" matches the documented limitation.
- Existing browser-source plumbing: `src/` browser display/source handling (see
  `tools/smoke/smoke-wo258-browser-source.test.js`, `smoke-wo260-browser-display-ui.test.js`) and
  the operator browser launcher `tools/runtime/highascg-launch-operator-firefox.sh` +
  `src/api/routes-system-browser.js`.

## Questions to answer
1. **Audio in.** What are the real options for feeding a chosen audio source into the browser?
   Enumerate what exists on this box (ALSA/PulseAudio/PipeWire — check which is actually running),
   how a monitor/loopback device is selected today, and what it would take to let the operator pick
   the source per browser instance from the UI instead of a URL parameter. Note whether Caspar's
   own audio can be routed to the browser and at what latency/quality cost.
2. **Virtual display.** What would it take to give a browser source its own virtual display shown
   in kiosk mode, relayed back to Caspar as a source on the host channel? Cover the realistic
   mechanisms (Xvfb/Xephyr headless X, a real output on spare GPU head, `xrandr --setmonitor`
   virtual head, PipeWire/portal screencast) and for each: capture path into Caspar, latency, GPU
   cost, and how it interacts with the existing NVIDIA/xrandr topology handling on this box.
3. **Operator control.** How can the operator drive mouse/keyboard on that window from the operator
   position? Options to weigh: the window on a real screen with focus handling (relates to WO-283,
   foreign windows over the kiosk), an embedded remote-control view, or input forwarding
   (`xdotool`, XTEST) driven from the operator GUI. State the security implication of each — input
   forwarding into a browser is effectively remote control of the box.

## Deliverable
Append a findings section to this file: per question, the options table (mechanism → latency → GPU
cost → complexity → risk), a clear recommendation, and the smallest first step that would prove the
recommended path works. Flag anything that would require a Caspar restart, a driver change, or new
system packages, since those affect the ISO and the eggs produce.

## Constraints
- Do NOT restart the highascg service or CasparCG, do NOT mutate the running X session, do NOT
  install packages. Read-only investigation only (`xrandr --query`, `pactl info`, `aplay -l`,
  `systemctl status`, reading config) — the box is live.
- Do NOT run `npm run build:client`.
