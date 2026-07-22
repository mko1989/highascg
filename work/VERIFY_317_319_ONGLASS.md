# WO-317 & WO-319 — on-glass validation (owner, on the live box)

Everything buildable-and-testable-headless is done and committed:
- `fd4ecbb` WO-319 pipeline · `d72f292` WO-317 core · `358ce83` WO-317 taskbar
- Offline gate: **1409 tests, 0 fail**.
- WO-319 server chain is already **proven live** on channel 4 (250 AUs/4s, 5 keyframes
  at exact 50-frame GOPs, keyframe-first, NVENC 0→1→0 clean).

What's left needs your eyes on the operator monitor — I can't verify a window restack
or a browser decode from a headless shell. Two independent activations below.

---

## Enabling steps (do these first)
1. **Restart the highascg service** — loads all the new server code (WO-319 relay +
   `/api/gui-stream/status`, WO-317 routes + `operator-helper-live`).
2. **Build the client**: `npm run build:client` (writes `dist-web/`).
3. **Reload the kiosk** — picks up the new client.

Until all three are done, the new client will call the new endpoints, get 404/disabled,
and quietly fall back to the old behaviour (by design — nothing breaks, but nothing new
shows either).

---

## WO-319 — live motion in the compose preview
No config flag; it activates as soon as a browser opens a preview cell showing the
operator-GUI channel (channel 4).

**Watch for:**
- [ ] The compose preview cell for **channel 4** shows **live motion** (cursor moves,
      UI animates) instead of the ~1 Hz JPEG snapshot refresh.
- [ ] `GET /api/gui-stream/status` returns `{enabled:true, channel:4, running:true,
      watching:N}` while the preview is open (N = number of browsers watching).
- [ ] `nvidia-smi` shows **1 encoder session** while a preview is open, **0** a few
      seconds after every preview is closed (the linger, then teardown).
- [ ] Opening the preview fresh comes up clean — **no green/garbled frames** (that's the
      IDR-first join working). If you ever see green, it means a client got a P-frame
      first — tell me.
- [ ] Under load (drag things fast) the preview **jumps to current** rather than lagging
      further behind (stale-drop).

**Pass = live motion, clean join, and NVENC returns to 0 when nobody's watching.**
Fail-safe: if anything is off, it falls back to the JPEG cell — the preview never goes
blank. The channel 4 output itself is never touched (the encode is an added consumer,
verified non-disruptive).

Note: channel 4 is a near-static screen, so the stream is a low bitrate — that's normal
and correct, not a fault. Motion still shows.

---

## WO-317 — multi-window taskbar (raise/park)
**OFF by default.** Turn it on deliberately, because it changes how the operator kiosk
stacks windows — and that's the thing to watch.

**Enable:** set `operatorTools.multiHelperTaskbar: true` in `config/general.json`, then
restart the service. (One writer rule: with it on, the new coordinator owns the kiosk
shape flag; with it off, the old WO-283 single-button path does. Never both.)

**On the operator monitor, watch for:**
- [ ] The header shows a **taskbar chip strip**. Open the **Web browser** from the
      "Open window" menu — a chip `▾ Web browser` appears and the browser sits **over**
      the GUI, focused.
- [ ] Open the **File browser** too — a second chip appears, **both windows run** (the old
      path only allowed one).
- [ ] Click the `▾ Web browser` chip → it **parks**: the browser drops **behind** the
      GUI (video holes clean again), chip dims to `▸ Web browser`. Click it again →
      **raises** back on top.
- [ ] With one helper **parked** and one **raised**, the punch-holes/kiosk behave
      correctly (holes clean where nothing is raised over them).
- [ ] Park the last raised helper → the **kiosk reclaims the top** even though helpers are
      still running (this is the refcount fix; the old boolean got this wrong).
- [ ] **Crash test:** with a helper **parked**, kill it (close its window) → the kiosk
      must **not** get stuck with suspended top-assert. With a helper **raised**, close it
      → kiosk reclaims the top. (A parked-crash wedging the kiosk was the exact WO-283
      failure this fixes.)

**Pass = two windows coexist, chips toggle raise/park, and no close/crash ever leaves the
kiosk wedged.** If a raise or park visibly half-applies (window in the wrong layer), that
means a required X step failed — the server log will name it (`[Helper coord] … did not
fully apply (failed at …)`); send me that line.

**Back out:** set the flag back to `false` + restart → instantly reverts to the WO-283
single-helper behaviour you have today.

---

## If you'd rather I drive the WO-317 live test
I can flip the flag and run the raise/park sequence myself over AMCP/X **if you're
watching the operator monitor and can tell me what actually happened on screen** — I
can't see the glass. Say the word and stay on the monitor.
