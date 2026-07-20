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

---

# FINDINGS (research pass, 2026-07-20)

Read-only investigation on the live box. No packages installed, no service restarted, no X mutation,
no audio routing changed. Every system claim below is backed by verbatim command output.

## 0. The one constraint that reframes all three questions

**This box has no sound server at all. It is raw ALSA, and there is no loopback or monitor device.**

```
$ pactl info
/bin/bash: line 1: pactl: command not found

$ pgrep -a pulseaudio; pgrep -a pipewire; pgrep -a wireplumber; pgrep -a jackd
(no output — none running)

$ for b in pactl pipewire wireplumber pulseaudio pw-cli jackd; do command -v $b; done
pactl          (not installed)
pipewire       (not installed)
wireplumber    (not installed)
pulseaudio     (not installed)
pw-cli         (not installed)
jackd          (not installed)
```

`libpulse0` is present, but only as a client library — nothing serves it. The complete set of
capture endpoints:

```
$ arecord -l
card 0: PCH [HDA Intel PCH], device 0: ALC1220 Analog [ALC1220 Analog]
card 0: PCH [HDA Intel PCH], device 2: ALC1220 Alt Analog [ALC1220 Alt Analog]

$ arecord -L | grep -v "^ "
null
hw:CARD=PCH,DEV=0
hw:CARD=PCH,DEV=2
plughw:CARD=PCH,DEV=0
plughw:CARD=PCH,DEV=2
default:CARD=PCH
sysdefault:CARD=PCH
front:CARD=PCH,DEV=0
dsnoop:CARD=PCH,DEV=0
dsnoop:CARD=PCH,DEV=2

$ ls /proc/asound/ | grep -i loop
NO LOOPBACK DEVICE
```

Two physical motherboard analog inputs. That is the entire menu. **"Monitor" and "loopback" sources
are a PulseAudio/PipeWire concept and do not exist here.**

This directly contradicts the shader-fx guide, which states:

> | browser_display source | **Real FFT** via getUserMedia — picks an ALSA monitor/loopback input automatically; `?audioDev=<substring>` overrides |

The selection code is real (`template/shaders/player.js:128-142`):

```js
const monitor = inputs.find((d) => /monitor|loopback/i.test(d.label || ''))
return monitor ? monitor.deviceId : undefined
```

…but on this box that regex **can never match**, because no such device is enumerable. The
documented "picks a monitor automatically" behaviour is aspirational, not operative. Anyone
following the guide today silently gets the motherboard mic input, or nothing.

Corollary that matters for the ISO: this is not a bug to fix in JS. There is no audio to pick.

## Q1 — Audio into the browser

### What exists today

- Selection lives **entirely client-side** in `template/shaders/player.js:128-165`, driven by a
  hand-typed URL parameter. There is **no server-side code that reads or injects `audioDev`** —
  grep across `src/`, `client/`, `lib/` returns nothing. (`src/capture/v4l2-input-bridge.js:48` has
  an unrelated local of the same name.)
- The browser_display capture path **explicitly strips audio**. `src/capture/browser-capture-args.js`
  passes `-an`, with the header comment at `:60-61`: *"Video only — WO-258 explicitly scopes audio
  out for v1 (ALSA-loopback is the documented future path)."*
- `.browser-source-profiles/` **does not exist** on this box — no browser_display source has ever
  been launched here. The path is implemented but unexercised.

### Two latent defects found while reading, independent of the missing device

1. **Firefox does not populate `MediaDeviceInfo.label` until a `getUserMedia` grant exists for the
   origin.** `pickAudioDevice()` calls `enumerateDevices()` *before* any `getUserMedia`, and
   `src/system/browser-source-session.js:62-64` gives every source a **fresh profile dir**. So on
   first run all labels are `''`, and both the `audioDev` substring match and the monitor heuristic
   fail silently, falling through to the default device. Fixing the device supply without fixing
   this ordering will still produce "no audio reaction".
2. Firefox *can* do ALSA — verified, so this is fixable rather than blocked:
   ```
   $ strings /usr/lib/firefox-esr/libxul.so | grep -oE '^(alsa|pulse|jack|sndio)$' | sort -u
   alsa
   jack
   pulse
   sndio
   $ ldd /usr/lib/firefox-esr/libxul.so | grep asound
   libasound.so.2 => /lib/x86_64-linux-gnu/libasound.so.2
   ```
   The live kiosk process has both `libasound.so.2` and `libpulse.so.0` mapped; with no Pulse
   server, cubeb falls back to ALSA.

### The good news on cost

`snd-aloop` ships with the running kernel already. **No new package is required:**

```
$ modinfo snd-aloop | head -3
filename:       /lib/modules/6.8.0-117-generic/kernel/sound/drivers/snd-aloop.ko.zst
license:        GPL
description:    A loopback soundcard
```

It is not loaded and not configured (`no aloop in module config`, no `/etc/asound.conf`, no
`~/.asoundrc`). The repo *already knows how to drive it* — `src/virtual-output/v4l2-bridge-audio-sink.js:72`
resolves the loopback card from `/proc/asound/cards`, and `src/config/device-graph-suggest.js:260`
builds `hw:${effectiveAlsaCardId(...)},1,0`, i.e. the snd-aloop capture side.

### Can Caspar's own audio reach the browser?

Not as currently wired, and the reason is worth flagging on its own. The config requests a PortAudio
device that **does not exist**:

```
config/casparcg.config:14   <device-name>hw:2,0</device-name>

$ cat /proc/asound/cards
 0 [PCH            ]: HDA-Intel - HDA Intel PCH
 1 [NVidia         ]: HDA-Intel - HDA NVidia
```

There is no card 2. `snd_usb_audio` is loaded with a refcount but enumerates no card, so the USB
interface this pointed at is absent. Channel 1's PortAudio consumer is aimed at nothing. The audio
that is actually on air is the **DeckLink embedded audio on channel 3** (`config/casparcg.config:80`,
`<embedded-audio>true</embedded-audio>`). Routing "Caspar's audio" to the browser therefore means
adding a *second* audio consumer pointed at a loopback playback device — it does not mean
re-pointing the existing one.

### Options table — Q1

| Mechanism | Latency | GPU cost | Complexity | Risk |
|---|---|---|---|---|
| **A. `snd-aloop` + Caspar 2nd PortAudio consumer → Firefox `getUserMedia`** | ~20-60 ms est. (aloop buffer + cubeb; unmeasured) | none | Medium — modprobe + modules-load.d + Caspar config + consumer | **Caspar restart required**; ISO gains a module-load file |
| **B. `snd-aloop` fed by a side ffmpeg from an existing source** (not Caspar's mixer) | ~50-100 ms est. | negligible | Low | No Caspar restart; but it is not the program mix |
| **C. Physical loop: analog out → ALC1220 line-in** | ~5-15 ms est. | none | Trivial in software, needs a cable | Quality loss (DAC→ADC), needs hardware present at each install — unacceptable for ISO |
| **D. Use existing mobo line-in directly** (`hw:0,0`) | ~5-15 ms est. | none | **Zero** — works today | Only captures whatever is physically patched in; not the program mix |
| **E. Extend the OSC/Tier-B path** (levels, not real FFT) | ~1 frame | none | Low — already built (`?ch=`) | Coarse spectrum only; owner already rejected this as insufficient |
| **F. PipeWire** | — | — | High | **Requires new packages + a sound-server migration on a live playout box. Do not.** |

### Recommendation — Q1

**Option A, staged, with D as the immediate unblock.**

Ship `snd-aloop` as the supported mechanism: it needs no new package, the repo already has helpers
that resolve loopback cards, and it gives the browser the real program mix. But sequence it so the
Caspar restart lands on the owner's schedule, not mid-research.

Also: **replace the `?audioDev=` URL parameter with a server-supplied device.** Since there is no
server-side handling at all today, the clean shape is for `browser-source-session.js` to append a
resolved `audioDev`/`deviceId` to the launch URL from the existing `GET /api/audio/devices`
inventory (`src/api/routes-audio.js:43`), and to seed the source profile with a pre-granted
`permissions.sqlite` entry for `127.0.0.1:4200` so `enumerateDevices()` returns populated labels on
first paint. That fixes defect (1) and delivers the per-instance UI picker the WO asks for.

**Smallest first step that proves it:** with nothing installed and nothing restarted —
`sudo modprobe snd-aloop` on a maintenance window, confirm `arecord -L` now lists
`hw:CARD=Loopback,...`, then launch one throwaway Firefox against a test page calling
`enumerateDevices()` and check a Loopback input appears with a non-empty label after a grant. That
proves the whole chain without touching Caspar at all. Only if that passes do you add the second
PortAudio consumer and take the restart.

**ISO/eggs impact:** one `/etc/modules-load.d/highascg-aloop.conf` file and one Caspar config
change. No new packages. Low, but it is a boot-path change and should not go in unvalidated.

## Q2 — Virtual display

### The key discovery: this is already built, and Xvfb was already rejected

`browser_display` does not use a virtual display. It parks a real Firefox in an **off-screen dead
zone of `:0`** and x11grabs it:

`src/capture/browser-capture-args.js:67-117`
```js
'-f', 'x11grab',
'-video_size', `${w}x${h}`,
'-framerate', String(fps),
'-i', `${display}.0+${x},${y}`,
…
'-f', 'mpegts', `udp://127.0.0.1:${port}?pkt_size=1316`,
```
Caspar then plays `udp://127.0.0.1:${53000 + hostChannel}?overrun_nonfatal=1&fifo_size=65536`
(`host-live-sources.js:339-346`). `src/utils/x-display-session.js` hardcodes `DISPLAY: ':0'` and its
header states the off-screen-region design is deliberate.

`src/capture/browser-source-region.js:8-27` records that **a second Xvfb was explicitly considered
and rejected** — no x11vnc/xpra on the box, no cross-server window migration — and that `xrandr --fb`
canvas growth is out of scope because it is capped by the X virtual-screen max and needs an nodm
restart.

Live topology confirms the dead zone the code computes:

```
$ DISPLAY=:0 xrandr --listmonitors
Monitors: 2
 0: +*DP-5 1920/698x1080/392+3072+0  DP-5
 1: +DP-0 3072/607x1728/345+0+0  DP-0
```
Canvas is 4992x1728; DP-0 (3072x1728) + DP-5 (1920x1080) leaves a free **1920x648 at 3072,1080**.
That is small — it is the real ceiling on browser-source resolution today, and a 1080p browser
source does not fit in it.

Six outputs are electrically free (`DP-1`…`DP-4`, `DP-6`, `DP-7` all `disconnected`), but
"disconnected" means no EDID: X will not give them a CRTC without a dummy plug or a driver-level
`ConnectedMonitor`/`CustomEDID` override in `xorg.conf`.

Tool availability, verified:
```
xdotool          /usr/bin/xdotool
xprop            /usr/bin/xprop
Xvfb             /usr/bin/Xvfb
ffmpeg           /usr/bin/ffmpeg
Xephyr           (NOT installed)
wmctrl           (NOT installed)
x11vnc           (NOT installed)
```
`xrandr` is 1.5.2 / server RandR 1.6, so `--setmonitor` exists. CasparCG links the **system**
ffmpeg (`libavdevice.so.60`, the same 6.1.1 build that has `x11grab` and `alsa`) and calls
`avdevice_register_all` — so no Caspar rebuild is needed for X11 capture.

### Options table — Q2

| Mechanism | Capture path into Caspar | Latency | GPU cost | Complexity | Risk |
|---|---|---|---|---|---|
| **A. Off-screen dead zone on `:0` (status quo)** | x11grab → mpegts → UDP → Caspar | est. 100-250 ms (encode + mpegts + Caspar buffer); **unmeasured** | Low — GPU-composited window + CPU x264 | **Zero, already shipped** | Capped at **1920x648** on this layout; window is on the live `:0` and can be dragged into view |
| **B. Grow the `:0` canvas via `xrandr --fb`** | same | same | same | Medium | Needs **nodm restart**; capped by X virtual-screen max; explicitly out of scope per existing code |
| **C. `xrandr --setmonitor` virtual head** | same | same | same | Low | **Does not help.** It only partitions an *existing* CRTC into Xinerama regions; it creates no new framebuffer space. Useful for hinting WM placement, not for gaining area |
| **D. Real head on a spare DP output + dummy plug/EDID** | x11grab of that head, or DeckLink loop | same as A | Low | Medium-High | Needs a **hardware dongle at every install** or an `xorg.conf` `CustomEDID` → **X restart + ISO change**. Dongle-per-box is a non-starter for an ISO |
| **E. Xvfb second X server** | x11grab of `:N` | est. similar, possibly lower (no compositor) | **CPU-only rendering — no GPU** | High | **Loses GPU/WebGL, which kills the shader use case.** No window migration to `:0`, so kiosk display needs a viewer that is not installed. Already rejected in code |
| **F. PipeWire/portal screencast** | portal → PipeWire → ffmpeg | — | — | High | **Impossible here — no PipeWire at all.** Would mean installing a sound/video server stack on a live playout box |

### Recommendation — Q2

**Stay on A, and raise its ceiling with B only if the owner actually needs >1920x648.**

E is the trap: Xvfb has no GPU, and the entire reason this WO exists is shaders. Routing a shader
browser through Xvfb converts a GPU workload into a software-rasterised one and will not hold 50 fps
at 1080p. D is technically the cleanest "real virtual display" but a per-box hardware dongle is
incompatible with shipping an ISO, and the EDID-override alternative is a driver-config change.

Note that the existing `xrandr` machinery is narrow by design and will not fight you: 
`src/utils/xrandr-safety.js:31` emits **only** `--output/--pos/--mode/--rate`, validated against
strict regexes that throw on anything else. Adding `--fb` or `--setmonitor` means deliberately
widening that allowlist — do it explicitly, not by loosening the regex.

**Smallest first step:** measure what A actually costs before changing anything. Launch one
browser_display source into the existing dead zone and time glass-to-glass against a frame counter.
If latency is acceptable and only the 1920x648 area is the problem, the fix is a canvas change (B),
not a new display mechanism. **Nobody has run this path on this box yet** — `.browser-source-profiles/`
does not exist — so the first honest step is to exercise what is already written.

**Restart/driver/package flags:** A = none. B = nodm restart. D = X restart + `xorg.conf`. E =
none for Xvfb (installed) but Xephyr/x11vnc would be new packages. F = large new package set.

## Q3 — Operator control of that window

### Already half-built, and it composes with WO-283

`src/system/browser-source-session.js:252-286` already implements
`moveBrowserSourceToOperator` / `returnBrowserSourceToOffscreen`: xdotool moves the **real** window
onto the operator monitor and `windowactivate`s it for **native** keyboard/mouse, paired with
`restartBrowserCaptureBridge` so the grab follows the window. Routes are wired at
`src/api/router.js:235`. That is WO-283's Option B/C shape, already applied to this exact problem.

The WO-283 interaction is concrete: the kiosk is shaped on **both** Bounding and Input
(`tools/runtime/operator-shape-overlay.py:396-400`), and `enforce_caspar_under` sets the Caspar
consumer's input region to **empty** (`:282`) so clicks in a hole do not let Openbox raise the
consumer. A foreign window raised over the kiosk must therefore be raised over *Firefox*, not merely
above the consumer — and the shape feeder guards on `titleMarker = 'HIGHASCG-OPERATOR-GUI'`
(`operator-shape-overlay.js:35`), which is exactly why browser-source Firefoxes are not holed.
**Also note WO-283 Option C proposes `wmctrl`, which is NOT installed**, and
`operator-gui-launcher.js:24` explicitly rejects adding it in favour of the xdotool already present.
Whatever WO-283 picks should use xdotool.

### Security — stated plainly

This box already exposes more remote control than any option below would add:

```
$ ss -tlnp | grep -E '9222|5250|4000'
LISTEN 127.0.0.1:9222   users:(("casparcg",pid=2000814))     # CEF remote debugging
LISTEN   0.0.0.0:5250   users:(("casparcg",pid=2000814))     # AMCP — ALL INTERFACES
LISTEN   0.0.0.0:4000                                        # NoMachine — ALL INTERFACES
$ dpkg -l | grep -i nomachine
nomachine 9.8.2-1
```

**NoMachine 9.8.2 is installed and listening on `0.0.0.0:4000`, and AMCP is on `0.0.0.0:5250` with
`<lock-clear-phrase>secret</lock-clear-phrase>` in the config.** If this ISO ships as-is, every
install is a network-reachable remote desktop plus an unauthenticated playout control port with a
published clear phrase. That is a far larger exposure than anything this WO proposes, and it should
be triaged before release regardless of which option wins here.

| Mechanism | Latency | GPU cost | Complexity | Security implication |
|---|---|---|---|---|
| **A. Move window to operator screen, native focus** (built) | Native — 0 added | None | **Low, already exists** | **Lowest.** No new input channel. Risk is confined to *physical* operator access, which is already total. Composes with WO-283 |
| **B. Input forwarding via xdotool/XTEST from the GUI** | ~10-40 ms est. per event | None | Medium | **Highest. XTEST is global, not per-window** — it injects at the X server, so anything that can reach the API can drive the *whole desktop*, not just the browser. Combined with AMCP on 0.0.0.0 this is unauthenticated remote control of a playout box. Do not ship |
| **C. CEF DevTools Protocol input injection (port 9222)** | ~10-30 ms est. | None | Medium | Scoped to the CEF page, not the desktop — better than B. But 9222 has **no authentication by design**; it is 127.0.0.1-only today and must stay that way. Applies only to CEF templates, **not** the Firefox browser_display source |
| **D. Embedded remote-control view (VNC/xpra in an iframe)** | est. 50-150 ms | Encoder cost | High — **new packages** (`x11vnc`/`xpra` absent) | Adds a second remote-control surface with its own auth story. Strictly worse than A on this box |
| **E. NoMachine (already present)** | est. 30-100 ms | Encoder cost | Zero to add | Already exposed. Using it deliberately does not increase attack surface, but it *normalises* an exposure that should arguably be closed |

### Recommendation — Q3

**Option A — extend the existing move-to-operator path; do not build input forwarding.**

It is already written, it adds no new input channel, and it is the only option whose security story
is "unchanged". B is the one to consciously refuse: XTEST cannot be scoped to a window, so
"let the operator click the browser" becomes "let any API caller drive the desktop", and this box
ships to other people.

Sequence it with WO-283: whichever raise/restore mechanism WO-283 lands should be the *same* helper
that browser-source-to-operator uses, so there is one state machine for "a foreign window is over
the kiosk" and one restore-on-crash path — not two that can disagree about kiosk stacking.

**Smallest first step:** exercise the existing `moveBrowserSourceToOperator` route end-to-end on a
scratch source and verify three things — the window raises above the shaped kiosk, the capture
bridge follows to the new rect, and `returnBrowserSourceToOffscreen` restores kiosk stacking and
shape exactly. If it already raises correctly over the shaped Firefox, Q3 is largely done and the
remaining work is a button in the operator GUI.

## Release-blocking items

Ranked, for the owner's ISO/eggs decision:

1. **NoMachine on `0.0.0.0:4000` and AMCP on `0.0.0.0:5250` with a published lock-clear-phrase.**
   Not caused by this WO, but pursuing *any* remote-control option makes it materially worse.
   Should be triaged before release on its own merits.
2. **`config/casparcg.config` PortAudio points at `hw:2,0`, which does not exist on this hardware.**
   Any ISO shipping this config has a dead audio consumer on channel 1 out of the box.
3. **The shader-fx guide documents monitor/loopback auto-selection that cannot work on an
   ALSA-only box.** Ships as a promise the software cannot keep. Either land `snd-aloop` or correct
   the guide before release — the doc is currently wrong, not merely incomplete.
4. Anything requiring a Caspar restart (Q1 option A), an nodm restart (Q2 option B), or an
   `xorg.conf` change (Q2 option D) should land well before an ISO cut, not alongside it.

## Explicitly not determined (read-only limits)

- **No latency was measured.** All latency figures above are marked estimates. The x11grab → mpegts
  → UDP → Caspar chain has never been run on this box, so its real glass-to-glass cost is unknown
  and I did not want to start it on a live machine.
- Whether Firefox's cubeb ALSA backend enumerates an `snd-aloop` device with a usable **label**
  is unverified — it requires loading the module, which is an audio-routing change the WO forbids.
- Whether a spare DP output would accept a `CustomEDID` on this specific GPU is unverified; it
  requires an X restart to test.
