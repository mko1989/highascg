# WO-258 — Web-browser source v2: real browser on a virtual display, captured into CasparCG

**Status:** OPEN — spawn AFTER WO-257 (CEF-interactive removal) lands; both touch the webpage-host surface
**Priority:** HIGH (owner architecture)
**Owner check:** A258.1

## Owner intent (verbatim)
"lets use cef only for displaying templates. lets also change the web browser source to a different approach. adding a webbrowser source adds a Display:1 virtual where that browser lives. the interaction is then system only, just need to make that browser available to the oparator screen. the display needs to be captured and relayed to casparcg. we will use similar approach for zoom (future)."

## Architecture
- CEF (Caspar html producer) = **templates only** (post-WO-257 there is no interactive CEF anyway).
- A "Web Browser" source spawns a real Firefox on a **virtual display surface**, captured by ffmpeg and relayed into Caspar as a normal video input. Interaction is native OS interaction with that browser. Design generalizes to a future Zoom source.

## Box inventory (verified 2026-07-16)
Xvfb + xvfb-run installed; ffmpeg installed (x11grab known to `src/streaming/stream-capture-tier.js`); v4l2loopback kernel module present (`/lib/modules/.../v4l2loopback.ko.zst`, NOT loaded, no /dev/video* currently); existing `src/bootstrap/v4l2-bridge-lifecycle.js` machinery (READ IT FIRST — how does it feed Caspar today: ffmpeg→? producer? follow its full path); firefox-esr + the WO-255 launcher/xdotool art; NO x11vnc/xpra.

## T258.0 — MANDATED design investigation (do first, report findings before building)
Two candidate display strategies — pick with evidence, not preference:
1. **Xvfb `:1`** (owner's literal framing): clean isolation; capture = `x11grab -i :1`. Problem to solve: "make that browser available to the operator screen" — with no VNC/xpra installed, interaction across displays needs a mirror (install) or is impossible natively. Report what interaction would cost here.
2. **Off-screen region of `:0`**: enlarge the root framebuffer (`xrandr --fb`) beyond the monitors and place the browser window in the dead zone (invisible, GPU-composited, still grabbable via `x11grab -i :0.0+X,Y`); "available to the operator screen" = xdotool windowmove onto the operator monitor (fully native interaction — the WO-255 launcher pattern), move back to the dead zone when done. Zero new dependencies. Risks to verify: NVIDIA root-framebuffer enlargement behavior with the current xrandr layout tooling (os-layout machinery manages --fb? check), and x11grab of non-CRTC regions.
Recommend one; the capture relay below is identical for both.

## Tasks (after T258.0)
**T258.1 — browser session manager** (`src/system/browser-source-session.js`): spawn/stop Firefox (dedicated profile per source, `--kiosk <url>`, window sized to the source's declared WxH) on the chosen surface; track pid; relaunch policy; clean shutdown hook. Mirror the WO-255 launcher + shape-helper spawn conventions (displaySessionEnv, logging).

**T258.2 — capture relay**: ffmpeg x11grab of the browser surface → the Caspar-visible input. Follow the EXISTING v4l2-bridge path (v4l2loopback modprobe handling, device allocation, ffmpeg args, and however its output reaches Caspar today — reuse, don't invent). Rate/size from the source config (default 1080p25 to keep grab cost sane; note the CPU cost of x11grab+scale in the report). Audio explicitly OUT of scope for v1 (note the ALSA-loopback art in [live-audio-bridge] as the future path).

**T258.3 — source type + config**: extraLiveSources (or the existing webpage-host model — WO-257 kept the content parts; read what remains) gains mode 'browser_display': { url, width, height, fps }. The old CEF-webpage-host creation path for browser sources is replaced (templates keep CEF). Route/play the captured input on the host channel exactly like the old flow routed the CEF page.

**T258.4 — operator interaction flow**: inspector button "Interact on operator screen" ↔ "Return to background": xdotool windowactivate/windowmove between the browser surface and the operator monitor (strategy-dependent per T258.0). While interacting, the on-air capture keeps running (the window IS the source — moving it moves what's captured in Xvfb strategy? In off-screen strategy the grab region is fixed — moving the window to the operator monitor means the grab region shows empty desktop! Solve: either grab-follows-window (ffmpeg re-spawn with new region) or accept "interacting = on-air shows the move". Design this consciously and report the choice).

**T258.5 — smokes** (curated gate): session-manager pure logic (spawn args, profile paths, relaunch policy) with stubbed child_process; capture-args builder; config round-trip; NO real Xvfb/ffmpeg/firefox spawns in tests.

## Constraints (standard)
LIVE box: no git, no service ops, no AMCP, no HTTP/WS to :4200/:5250, no npm/apt, no vite build, curated gate ONLY. You MAY run short-lived Xvfb/x11grab probes for T258.0 on a HIGH display number (:77) that touch nothing live — kill everything you spawn, no orphans. node --check + eslint --quiet; exact gate counts; <500 lines/file; honest checkboxes.

- [ ] T258.0 strategy investigation + recommendation (with probe evidence)
- [ ] T258.1 browser session manager
- [ ] T258.2 capture relay (reusing v4l2-bridge path)
- [ ] T258.3 source type/config + host-channel play
- [ ] T258.4 operator interaction flow (conscious grab-vs-move design)
- [ ] T258.5 smokes in gate
- [ ] A258.1 (owner) add browser source → appears on host channel via capture; Interact button brings it to the operator screen and back
