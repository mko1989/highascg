# VERIFY IN UI — session WO-310 … WO-319

What to click and what you should see. Each item is **pass** only if the observed
result matches. Order assumes you have already **restarted the highascg service**
(activates screen_3 clear + WO-312/316 server fixes) and done a **kiosk reload**
(picks up WO-310/313 client). If you haven't, the client-side items will show the
OLD behaviour — do those two first.

Legend: 🟢 = testable purely in the UI now · 🟡 = needs a deliberate action
(apply a layout, pull a cable) · 🔴 = needs the live-only pieces that are NOT wired
yet (marked so you don't waste time looking for them).

---

## WO-310 — Audio fader sends LINEAR, once
🟢 Client (kiosk reload)

1. Open a channel's audio mixer, grab a fader, move it.
2. **Pass:** the value settles where you put it — no snap-back, no second jump a
   beat later. Set it to unity and the number reads a clean `1.0` (not `0.999…`).
3. Set a fader to **0** → audio mutes, fader stays at 0 (does not drift).
4. **Hazard check:** there should be **no way** to drive the fader to a negative
   value from the UI. Negative linear gain = inverted phase at huge volume.
   **Fail** if any UI control produces a negative number on the wire.

Why: the old client double-sent (a linear REST write *and* a dB AMCP write). The
dB path is gone; REST is the single writer. If you see the value fight itself,
the reload didn't take.

---

## WO-311 — A deleted project does not come back
🟢 Client + server

1. Retire (trash) a project you don't need. Confirm it disappears from the list.
2. Reload the kiosk / open the app fresh.
3. **Pass:** the project stays gone. You should NOT see it re-appear from a stale
   autosave.
4. If a client still had it open when it was retired, on its next save you get a
   toast: **"project gone on server"** (header bar). That is the correct,
   expected message — it means the 410 latch fired and the client stopped trying
   to resurrect it.

Fail: the project reappears in the list after reload, or autosave silently
recreates it.

---

## WO-312 — Live-input audio routes re-assert
🟢 Server (watch the journal, then confirm in UI)

1. After the service restart, watch the log for the **first live run** of the
   reassert pass — a line tagged `[Audio reassert]` (or similar) during routing
   setup. This is brand new; its first appearance is the thing to confirm.
2. In the UI: a live input that is on PGM should have its audio routed to the
   monitoring/aux bus as configured — check the input's audio actually reaches
   where you route it after a fresh start, **without** you re-touching it.
3. **Pass:** audio routes are present on boot, honouring the per-input policy
   (an input set to route 'never' stays unrouted — verify one of each).

Fail: you have to manually re-trigger routing after every restart.

---

## WO-313 — Cable overlay redraws smoothly on resize
🟢 Client (kiosk reload)

1. Open the device/cabling view (the one that draws the cable overlay).
2. Drag-resize the window / browser repeatedly, fast.
3. **Pass:** the cable overlay tracks the resize smoothly, no stutter or lag
   spikes. It now redraws at most once per animation frame instead of on every
   resize event.

Fail: heavy jank or the overlay visibly falling behind the window edge while
dragging.

---

## WO-315 — Growing the GPU canvas triggers a nodm restart
🟡 Needs a deliberate apply — do this in a maintenance window, it restarts X

This is the "VERY IMPORTANT" regression. Test it explicitly.

1. Note the current total desktop resolution (xrandr) across the planned GPU
   outputs.
2. In the GPU/layout config, apply a layout whose **total canvas is LARGER** than
   the current desktop (e.g. add an output, or raise a mode).
3. **Pass:** the apply schedules a **nodm restart** (not just a Caspar screen
   re-config). Watch the journal for the planned-vs-current log line and the
   nodm restart decision.
4. Apply a layout that is the **same size or smaller** → **no** nodm restart
   (a screen re-config is enough). Confirm it does NOT needlessly restart X.
5. Degenerate/empty layout → you get a **WARN** in the log (`no_live_canvas`),
   not a silent skip.

Fail: growing the canvas re-configs Caspar but leaves the desktop too small
(outputs clipped / black), i.e. the nodm restart didn't fire.

---

## WO-316 — DeckLink input stops the periodic failing retry
🟢 Server (watch the log)

1. After restart, watch the log for a while over a live DeckLink input that is
   already playing on its host channel.
2. **Pass:** **no** periodic "failed to open DeckLink / retrying" spam (the old
   ~2s retry loop where it fought its own producer).
3. In the UI the input shows healthy/live, steady — not flickering between
   playing and error.

Fail: recurring DeckLink open failures in the log for an input that is visibly
on-air.

---

## WO-318 — Punch holes work on the operator monitor at 2160p50
🟡 Look at the actual operator glass

1. On the operator monitor (the 2160p50 head), open the operator GUI with a
   video hole (the region where the Caspar screen consumer shows through the
   Firefox kiosk).
2. **Pass:** the hole is in the **right X position** — the video shows through
   exactly where the UI cut-out is, edges aligned. Click inside a hole → the
   click lands on the video/consumer, not eaten by the browser.
3. Move/scroll UI elements that own holes → the holes track correctly, still
   aligned at 2160p50.

Fail: the hole is offset horizontally (video peeking left/right of the cut-out),
or clicks in the hole do nothing.

Note: the stale `screen_3` override was cleared from `general.json` this session
(7 keys removed, backup in `scratchpad/general.json.bak`). If holes are still
offset, tell me the pixel offset and which output.

---

## WO-317 — Multi-window taskbar (file browser + web browser)
🔴 Core built & tested, applier/taskbar NOT wired yet

Do **not** expect a working taskbar in the UI yet. What exists is the tested
core (registry + command planner + park script). The applier that finds real
window ids and restacks the live X session is the remaining live-only piece.

When we DO wire it, this is what you'll verify:
- Open file browser and web browser together; both run.
- Clicking a running helper in the taskbar brings it **to front, over** the
  Caspar window, focused.
- "Parking" a helper sends it **under** the Caspar consumer (video holes clean
  again) without closing it; the kiosk reclaims the top.
- A crashed/parked helper does not wedge the kiosk (refcount, not a boolean).

For now: **pass = nothing regressed** — the existing single-helper WO-283
behaviour (promote a browser over the kiosk) still works exactly as before.

---

## WO-319 — GUI live preview via NVENC stream
🔴 Core built & tested (NVENC verified on hardware), pipeline NOT wired yet

Do **not** expect live motion in the compose preview yet. Verified this session:
the NVENC arg builder's own command attached to the on-air 2160p50 channel and
produced valid downscaled H.264 + AAC on the RTX (1 NVENC session, released
cleanly on REMOVE). The relay policy (IDR-first, stale-drop) is a tested state
machine.

Still to wire (all live-only): the composed channel itself (needs a Caspar config
change + restart to schedule), UDP ingest, WS binary relay, WebCodecs client.

When wired, verify:
- The compose preview shows **live motion** (not a stills refresh), low latency.
- A browser that joins mid-stream comes up cleanly (no green frames) — that's
  IDR-first working.
- Under load the preview **jumps to current** rather than lagging further and
  further behind — that's stale-drop working.

For now: **pass = the operator channel is undisturbed** — no leftover test
consumer, `0` NVENC sessions when nothing is previewing.

---

## Quick sanity after restart (do these first)
- [ ] Service came up healthy, UI loads, channels live.
- [ ] Journal shows the `[Audio reassert]` first-run line (WO-312).
- [ ] No DeckLink retry spam (WO-316).
- [ ] Operator holes aligned at 2160p50 (WO-318).
- [ ] Fader behaves (WO-310), cable overlay smooth on resize (WO-313).

If any 🟢 item shows the OLD behaviour, the restart or kiosk reload didn't take —
re-do that step before reporting a real failure.
