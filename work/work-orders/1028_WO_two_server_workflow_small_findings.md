# WO-1028 — Two-server workflow: the small findings of the WO-1026 runs
**Area:** network, video-io, tracking-vr, devices-config
**Status: OPEN (09.11 — a list from the WO-1026 runs, each with its evidence; none fixed)**

## Investigation

Each item was seen on the two boxes during WO-1026 (phase 1 = tracking + stream / record on the second server, phase 2
= tracking on main). Ordered by how much it would hurt in a show.

1. **Phase 1 lost frames in stream and record on the second server; phase 2 does not.** Phase 1: recording 1698 of
   2903 frames with a stream running, stream ~27 fps, GPU 96–100 % already when idle. Phase 2: 3000 of 3000, stream
   49.8 fps, GPU ~70 %. Between the two, the tracking detector (~420–440 % CPU, two shm surfaces) *and* two signal-less
   DeckLink input channels left that server. Not separated: which of them costs the frames, and where they are lost
   (the channel itself kept 50 fps). To do: phase 1 layout with detection off; then with the inputs but no shm
   surfaces. Streaming is libx264 only (no NVENC path).
2. **The tracking duty moves when the connector is saved, not when Caspar is applied** (WO-1026 fix C reads the saved
   channel map). Between edit and apply: the new tracking server sends `ADD 9-751 SHM in1` into whatever channel 9
   currently is, and retries a failing `ADD` every 5 s; the old one has already stopped. Tracking is down for that
   window. A gate on "the running layout" has its own risk (a box that never aligns would never track).
3. **Live sources of ports that stop being inputs stay** (`route://9-1`, `route://10-2`) and point into the channels
   the remaining inputs renumber into. Removed by hand.
4. **`screen_N_decklink_device` is not cleared when a port goes `out` → `in`** (phase 1 setup): the next apply reports
   an output conflict until it is set to 0 by hand.
5. **After a config apply, `setupInputsChannel` ran twice on the second server:** `PLAY 10-4 DECKLINK 4` again on an
   open device → `Could not enable video input` + a 404. The input works; the log line is wrong.
6. **A follower answers a read-only `MIXER 7-10 OPACITY` query on a PGM channel with a made-up `202 OK`
   (`skipped: true`)** — the local-PGM block does not tell queries from commands.
7. **A new destination reaches the other server only after a project save;** `addDestination` defaults to
   `mainScreenIndex` 0.
8. **The show rewrite loop from `multiview.canvasWidth` after sharing,** and a destination lost in it (phase 1 setup).
9. **The second server renders every shared destination** (uncabled 3072x1024, 7680x2160) on its 8 GB card.
10. **A preset recalled on a follower loses take-group sync.**
11. `scenes.liveSceneIdByMain` on the master stays all `null` after a take; main's `/api/system/version` shows the dev
    checkout's old `BUILD_STAMP`.

## What was done

Nothing yet.

## What was verified

Nothing; evidence for each item is in WO-1026 (phase sections, traps, Open list history).
