# WO-149 — Operator GUI on live CasparCG output (design exploration)

**Status:** Draft / idea evaluation
**Priority:** TBD
**Date:** 2026-07-07
**Related:** WO-57/58/63 (compose preview), WO-87 (pointer confine), WO-88/89 (host channels + CEF operator control), WO-137/145 (vcam stream), WO-84 (deferred)

---

## 1. The idea (owner, 2026-07-07)

Move the GUI onto the Ubuntu/operator monitor with the Caspar screen consumer "over" (or merged with)
the GUI, so compose preview and all looks editing happen against **real live CasparCG output** — like a
multiview channel with GUI controls in it. Mouse is already confined to the operator monitor (WO-87).

## 2. Hard fact first: screen-consumer transparency

**No.** The CasparCG screen consumer is an opaque OpenGL window. There is no ARGB/transparent window
mode — transparent channel content renders over black. `KEY-ONLY` exists but it outputs the alpha as a
grayscale picture (for external keyers), not a desktop-composited transparent window. So "Caspar window
floating transparently over the GUI" is not possible natively, in any Caspar version.

That kills the literal version of the idea but not the goal. Four real routes exist:

---

## 3. Route A — Tiled: screen consumer region + GUI around it (LOW RISK)

Screen consumer supports `windowed`, `borderless`, `always-on-top`, and explicit `x y width height`.
Put an opaque borderless Caspar window on a fixed region of the operator monitor (e.g. top 60%:
a multiview channel or PGM route), and run the GUI in the remaining region (or on a virtual desktop
layout around it). No overlap → no compositor needed → zero new moving parts.

- ✅ True zero-latency Caspar pixels while editing; rock solid; config-only + GUI layout work.
- ✅ Openbox + nodm stack unchanged. Pointer confine unchanged.
- ❌ Controls sit NEXT to the video, not ON it. No drag-handles-on-live-video.
- ❌ Steals a screen consumer + channel (GPU headroom check needed alongside PGM).

**Effort: days.** This is the "multiview with GUI controls" feeling with the least trouble.

## 4. Route B — Live video INSIDE the GUI (stream upgrade) (LOW-MED RISK)

Don't move the GUI — bring real motion video into it. Caspar `STREAM` consumer (mpegts/mjpeg over UDP,
exactly the WO-145 spike infra) → tiny gateway → the browser GUI:
- MJPEG over WebSocket into a `<canvas>`: trivial, ~100–300 ms latency, 25 fps, CPU cheap at preview size.
- Or WebRTC (WHIP via mediamtx/ffmpeg): ~100–200 ms, more moving parts.

The looks editor's compose cells become actual video instead of the JPEG flipbook; drag/scale overlays
draw on top of the video in the same canvas — **controls literally on the (near-)live picture**.

- ✅ Keeps the entire existing GUI, browser stack, remote operation from ANY device on the LAN
  (the tiled/overlay routes only work on the physical machine!).
- ✅ Reuses WO-145's stream plumbing; one gateway serves preview + vcam + future multiview-in-GUI.
- ❌ 100–300 ms behind air (fine for editing; not for judging frame-accurate takes).
- ❌ Encoding cost per streamed channel (mjpeg at preview res is mild).

**Effort: ~1–2 weeks incl. gateway + canvas work.** Highest value-per-risk.

## 5. Route C — GUI as an HTML layer INSIDE Caspar (THE RADICAL ONE)

Flip the stacking: don't put Caspar over the GUI — put the **GUI into Caspar**. A dedicated "operator
channel": bottom layers = routes of PGM/PRV/multiview; top layer = HTML producer running the GUI with a
transparent body. Screen consumer of that channel fullscreen on the operator monitor. Caspar's CEF
composites HTML with alpha over video natively — that part just works.

The showstopper for anyone else — mouse/keyboard into Caspar's CEF — is the one thing this project has
ALREADY built: the CEF interactive bridge (`tools/runtime/cef-interactive-x11.py`,
`src/system/cef-interactive-bridge*.js`, WO-89) injects input via CDP. Pointer confine (WO-87) keeps the
mouse on that monitor. This idea is uniquely plausible *here*.

- ✅ Pixel-perfect: controls truly ON live video, zero preview latency, one window, kiosk-grade.
- ❌ Caspar's CEF is an old Chromium: the full GUI (heavy canvas, WS, modals) must run and perform there.
- ❌ Input via CDP injection = added latency + edge cases (text fields, scroll, drag precision, IME).
- ❌ GUI crash/reload now perturbs a Caspar channel; debugging inside Caspar CEF is painful.
- ❌ Loses remote/browser operation unless the classic mode is kept in parallel (double maintenance).
- ❌ Extra fullscreen channel + CEF layer = real GPU/CPU cost next to PGM.

**Effort: weeks to prototype honestly; months to production.** Worth a strictly time-boxed spike:
load the existing GUI as an HTML producer layer, drive it via the CDP bridge, measure input latency +
render fps. Kill criteria up front (e.g. >80 ms input latency or <30 fps GUI → stop).

## 6. Route D — Compositor overlay: transparent GUI window OVER an opaque Caspar window (FRAGILE)

X11 can composite a transparent always-on-top browser/Electron window above the Caspar screen consumer —
but only with a compositor (picom) running; bare openbox has none. Compositors on a playout GPU introduce
vsync/tearing/latency risk to the REAL outputs, Electron transparency on Linux is historically flaky, and
click-through region management (video area passes clicks vs UI catches them) is hacky (XShape).

- ❌ Highest fragility, touches the one thing that must never stutter (GPU present path).
- Verdict: **not recommended** while Routes A–C exist.

## 7. Native vs Node

Keep Node. The bridge (AMCP, OSC, state reconcile, replication, exFAT, systemd wiring) is years of
accumulated behavior — rewriting native buys nothing for this feature; there is no zero-copy texture
interop exposed by Caspar on Linux anyway (no Spout/Syphon equivalent), so "native" still ends up
compositing windows or streams exactly like the routes above. **Build on top:** all four routes are
additive layers over the existing Node + browser stack.

## 8. Recommendation

1. **Now:** Route B (stream-into-GUI) — it upgrades the existing preview to real motion for every
   operator (including remote), reusing WO-145 plumbing. Ship behind a setting next to the JPEG mode.
2. **Cheap win alongside:** Route A tiled layout as an optional "console mode" for the physical
   operator monitor (config + window placement only).
3. **Spike later, time-boxed:** Route C (GUI-in-Caspar) — genuinely differentiating and this codebase
   is unusually well-positioned (CEF bridge + pointer confine already exist), but only after the
   preview/vcam/backup strengthening lands. Write kill criteria before starting.
4. **Skip:** Route D (compositor overlay).

## 9. Open questions for the owner

- Is editing-on-live meant for the *physical* console only, or must remote browsers keep parity? (Route C sacrifices remote unless dual-mode.)
- GPU headroom: how much is left next to PGM+PRV on the 595 with an extra fullscreen channel (C) or per-channel encoders (B)?
- Acceptable preview latency for looks editing: is ~200 ms fine (B), or must it be frame-true (A/C)?

## 10. Work log

- 2026-07-07 — Idea captured from owner; four routes analyzed with limitations; recommendation B → A → spike C, skip D. No implementation yet.
