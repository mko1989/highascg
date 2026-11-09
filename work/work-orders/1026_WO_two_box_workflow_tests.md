# WO-1026 — Two-server workflow on the real boxes: tracking + stream/record on the second server, LED wall on main (test harness + runs)
**Area:** testing-ci, network, video-io, tracking-vr
**Status: IN PROGRESS (09.11 — phase 1: 31 pass / 11 fail, four bugs fixed, re-run 39 pass / 2 fail of 44; phase 2: 41 pass / 2 fail of 45, frame loss gone; last: the stream-argument fix on the second server)**

Owner, 09.11: update the second server, then test it "as doing part of the workflow":

- **Phase 1.** Second server (highascg5867, 192.168.0.10): tracking cameras on DeckLink 1 + 2, a mixer source on
  DeckLink 3 and a PPT source on DeckLink 4, one PGM/PRV destination in 1080p50 that is only connected to that
  server's output, stream + record of it. Main (highascg7579, 192.168.0.17): only the LED wall destination that the
  Narvil project already has.
- **Phase 2.** Tracking moves to main (its DeckLink 1 + 2). The second server keeps DeckLink 3 + 4 as inputs, stream
  and record, and sends the destination's PGM to its DeckLink 2.
- All tests run in each phase.

## Investigation

- **Prerequisites (done 09.11):** push 35a018d3, CI green. 5867 updated via `POST /api/system/update/apply` to release
  2026-11-09T194123Z (buildStamp equal, Caspar 5c3373ec5). The cluster invite accepted on 5867, so the link is mutual.
  Backups on both boxes: `~/backups/twobox-before-20261109-205021/` (config/ + project JSONs).
- **Live state before the setup:**
  - Main: master, epoch 1, show on (narvil). DeckLink 1/2 `in` (ch 7/8, no signal), 3/4 unassigned. Destinations:
    operator GUI (DP-6), `dst_mw7t9epz_1` "PGM/PRV 1" 3072x1024 → gpu_p1 (DP-2, the LED wall), "to zoom" (uncabled),
    "PGM/PRV 3" 7680x2160 (mapping node). 9 Caspar channels, aligned. Tracking: one camera `cam_1` role `in1`,
    detection off. No looks.
  - Second server: RTX 2080 SUPER 8 GB, only HDMI-0 connected (1920x1080@50), DeckLink 8K Pro ×4. Show NOT shared yet
    (its own `new_project_1`). DeckLink 1/2 unassigned, 3/4 `out` 2160p50 fed by a mapping node. Operator GUI cabled
    to gpu_p2 and gpu_p1. Streaming channel on, no outputs. DeckLink inputs disabled.
- **Gaps predicted from the code (the runs confirm or clear them):**
  1. `src/tracking/detect-service.js:73` — `wanted = !stopped && det.enabled && cams.length > 0`, and the detection
     config is shared show data. Under a shared show BOTH servers would run the detector and hold the tracking duty;
     there is no per-server switch. (T4.2, T4.4)
  2. `src/cluster/cluster-fanout.js:104` translates `route://N` only for destination channels. A look whose source is
     an input that exists only on the second server (its DeckLink 3 / 4) cannot be expressed from the master. (T5.1,
     T5.2)
  3. Channels follow the shared destination list (WO-1017): the second server also renders the uncabled 3072x1024
     pair, "to zoom" and the 7680x2160 pair on an 8 GB GPU. Kept as is; the soak measures the cost. (T8.1)
  4. Whether stream credentials posted on the master (project-scoped, WO-261) reach the follower. (T6.1)

## Phase 1, first run (09.11, release 2026-11-09T194123Z on both) — what it found

Set up and run by an Opus agent from the runbook below. Result: **31 passed, 11 failed, 1 warning, 2 skipped** of 45.
The DeckLink inputs carry no SDI signal on either box, so every source is black: the take checks prove routing (which
channel-layer plays which input), not picture content.

| Checks | Result | Cause |
|---|---|---|
| T0.1–T0.7, T1.1–T1.4, T2.1–T2.3, T2.5, T3.1 (both), T4.1, T4.5, T4.6, T5.0–T5.4, T5.5b, T6.1b, T6.4, T9.1 | PASS | |
| T3.2.peer | WARN | no SDI signal on the second server's inputs (hardware) |
| T2.4, T3.2.main | SKIP | phase 2 only / main has no inputs in phase 1 |
| T6.2, T6.3, T7.1, T8.1 | FAIL | **bug A** — the follower dropped its own stream / record consumers |
| T5.5 | FAIL | **bug B** — a program take pressed on the follower went nowhere |
| T4.2, T4.4 | FAIL | **bug C** (gap 1) — both servers held the tracking duty |
| T4.3, T9.2 | FAIL | setup: the second server had no tracking venv |
| T5.6, part of T8.1 | FAIL | gap 2 — the master answers `403 LOADBG FAILED` for its own copy of the look (open) |
| T6.1 | FAIL | by design: stream credentials are per server (the check was wrong) |

- **Bug A — a follower never starts its own stream or recording.**
  - `src/caspar/amcp-client-transport.js:61-62` asks `shouldBlockLocalPgmAmcpCommand` (`src/replication/amcp-fanout.js`)
    for every line. On a follower it blocks everything addressed to a program channel — also `ADD 7-97 STREAM …` and
    `ADD 7-96 FILE …`, which are that server's own consumers, not air content.
  - The API still answered "started", `rtmp.active: true`, link "connected". Caspar's `INFO 7` had no such port.
  - 5867's journal: 12 lines `skip local PGM AMCP … ADD 7-9[67]` during the run.
- **Bug B — a program take on the follower is lost.**
  - `POST /api/scene/take-look` on a follower answers ok; `src/api/routes-scene-take.js:224-232` then skips every line
    ("follower amcp-fanout: skip local PGM AMCP"). The follower's Godot GUI takes exactly this way
    (`godot/client/features/live/deck_view.gd:273`).
  - The cluster-call path (`look.take` relayed to the master) works (T5.5b).
- **Bug C — tracking on both servers (gap 1 confirmed).** Main ran the detector and logged
  `no surface at /dev/shm/highascg-in1` / `in2`; both servers listed the `tracking` duty.
- **Bug D — the master's air journal outlives its own Caspar.**
  - The catch-up replayed `PLAY 7-23 SHM NAME zoom-gallery` and `MIXER 7-23 OPACITY 0` into the second server's
    workflow PGM. Main's channel 7 had hosted DeckLink 1 before the phase 1 apply; after it, 7 is the destination's PGM.
  - `src/cluster/cluster-air-journal.js` had no way to forget; `src/api/routes-cluster.js:145` keeps one journal per
    node process.
- **Gap 2 — an input only the other server has.**
  - The master lists no Live source for the second server's DeckLink 3 / 4. The looks use the route the second server
    itself lists (`route://11-3`, `route://12-4`); the fan-out sends it unchanged, so the second server plays it.
  - The master also plays its own copy of the destination (previs, thumbnails) and has no channel 11 / 12:
    `403 LOADBG FAILED` for `LOADBG 7-10 route://11-3`, 22 lines in the take block, 44 in the soak.
  - Gap 4 (credentials): `streaming` is volatile in `src/cluster/show-merge.js` (:8, :22) — a target or key posted on the
    master stays there. Posted on the second server, the stream starts (T6.1b). By design; the harness now sets them on
    the output's owner (T6.1).
- **Other findings (not fixed, see Open):**
  - `casparServer.screen_N_decklink_device` is not cleared when a DeckLink port goes from `out` to `in`
    (`conflict_output_device`). It needed `POST /api/settings {"casparServer":{"screen_1_decklink_device":0}}` and
    `POST /api/caspar-config/apply {"force":true}`; a plain apply was a no-op.
  - After the show was shared the two servers rewrote it in turn: the follower GUI's `multiview.canvasWidth` 6144 vs
    3072 (`mv_doc.gd` canvas_size, `multiview_tab.gd` `_sync_canvas_size`), until the second server's Caspar apply. The
    first added destination vanished in that window (`shared-show-ctx.js:27-29`).
  - A new destination reached the second server only after a project autosave wrote `hardwareConfig`.
    `addDestination` defaults `mainScreenIndex` to 0 (the LED wall's); it had to be passed.
  - The second server's apply put the Caspar screen off screen while the operator GUI was still cabled to disconnected
    GPU ports, and that apply restarted nodm there.
  - The master's own `show.in_sync` is false by design (`shared-show.js:318-320`): sync is the master's
    `show.peers.<id>.in_sync` plus the follower's own flag.
- **Measurements (second server, RTX 2080 SUPER):** idle ~96–98 % GPU, ~1013–1055 MiB (Godot ~49 %, Caspar ~48 %);
  in the soak 95–100 %, memory unchanged. Main 44–47 %, ~3070 MiB. API p50 4–5 ms, max 8–14 ms. The stream and record
  consumers never ran (bug A), so their cost was not in these numbers.

## Phase 1, re-run on the fixed build (09.11, release 2026-11-09T204447Z / acf2246a on both)

Run by an Opus agent. Result: **39 passed, 2 failed, 1 warning, 2 skipped** of 44 (T6.1b was merged into T6.1).

- **Now PASS:** T4.2, T4.3, T4.4 (bug C + the venv), T5.5 (bug B), T6.1–T6.4 and T7.1 (bug A), T9.2.
  - The second server tracks with fresh frames on both cameras; main has `tracking: false`, no detector, no surfaces.
  - Caspar on the second server really runs the consumers: `INFO 7` showed port 97 (stream) and port 96 (record)
    whenever the API said active, and neither afterwards. 0 `skip local PGM` lines in its journal for the whole run.
  - A 10 s recording alone: 1920x1080, 50 fps, 462 frames in 9.2 s, audio.
- **T5.6 FAIL — gap 2, unchanged:** 26 lines, all on main: 13 × `AMCP batch: command failed inside BEGIN…COMMIT —
  cmd="LOADBG 7-110 route://11-3 …" reply="403 LOADBG FAILED"` and Caspar's 13 matching `Check syntax.`.
- **T8.1 FAIL — new: the second server loses frames when it streams and records.**

  | Second server | Delivered |
  |---|---|
  | record alone (T7.1) | 50 fps |
  | stream alone | ~43 fps (470–511 of 600 frames in 12 s) |
  | stream + record (soak) | recording 1698 of 2903 frames (58 %); stream ~27 fps, back to ~43 when recording stops |

  - The channel keeps its rate: the screen consumer of channel 7 presented 483 frames in 10 s, 0 dropped.
  - The encoder is not the limit: on black input libx264 reports skip 100 %; 671 frames encoded in 15.5 s, so the
    missing frames never reached it. libx264 only — no NVENC session (`src/streaming/streaming-channel-ffmpeg.js`).
  - Load: GPU 100 % idle and 93–100 % in the soak, memory 1219 → 1862 MiB. CPU with both consumers 78 % user (Caspar
    ~267 % → ~1081 %); the tracking python alone takes ~420–440 %, the four signal-less DeckLink inputs 30–66 % each.
  - Caspar on the second server logged 82 DeckLink lines (`in-sync changed`, `Excessive A/V sync drift detected …
    recreating filters to resync`) only while the consumers ran.
  - Not isolated further (inference: the loss is in Caspar's ffmpeg consumer before the encoder — frame download or
    its queue — on a GPU pinned at 100 %). Phase 2 takes the tracking load off this server: the same checks there
    tell whether the loss follows it.
- **Bug D on the boxes:** no fresh replay; neither main's journal nor its Caspar has a layer 7-23. The stale
  `zoom-gallery` layer from the first run was still on the second server's PGM (its Caspar had not restarted) — cleared
  with `STOP 7-23` + `MIXER 7-23 CLEAR` on the master.
- **Harness, after the re-run:** T6.3 and the soak count the received stream frames against the duration (the 50p
  timebase alone passed 470 of 600); T9.0 clears the throwaway stream target and key.
- Also seen: `scenes.liveSceneIdByMain` on the master stays `[null, null, null, null]` after a take; the stream ADD
  carries `-format mpegts -i -` and Caspar logs `Unused option i=-` (`streaming-channel-ffmpeg.js:104`); main's
  `/api/system/version` shows the dev checkout's old `BUILD_STAMP` (2026-11-03_093850), not the commit it runs.

## Phase 2 (09.11, release 2026-11-09T204447Z on both) — tracking on main; second server: stream, record, PGM on DeckLink 2

Set up and run by an Opus agent; its claims on duties, channels, consumers and leftovers were read back by hand
afterwards. Full run: **41 passed, 2 failed, 2 warnings, 0 skipped** of 45 (`phase2.json` / `.log`).

- **What the move did to the channels** (applied on both, no display-manager restart, both Godot clients kept running):
  - Second server 12 → 10 channels: DeckLink 3 ch 11 → 9 (layer 3), DeckLink 4 ch 12 → 10 (layer 4). PGM 7, PRV 8 and
    the stream / record channel (`program_4`, ch 7) stayed. Channel 7 now carries `decklink` index 2 at 1080p5000
    (port 302) next to the HDMI-0 screen consumer (port 600).
  - Main 9 → 11 channels: DeckLink 1 on ch 9 layer 1, DeckLink 2 on ch 10 layer 2, the 64x36 audio channel 9 → 11.
- **Healed by itself:** the Live sources of ports that stayed inputs, by DeckLink slot at the Caspar reconnect (WO-271,
  `src/config/routing-setup.js:116`): second server `11-3 → 9-3`, `12-4 → 10-4`; main `7-1 → 9-1`, `8-2 → 10-2`, the
  Zoom gallery `7-23 → 9-23`. `streamingChannel` and the record source needed nothing.
- **Did not heal:**
  - The second server kept Live sources "DeckLink 1" `route://9-1` and "DeckLink 2" `route://10-2` for the two ports it
    gave up. They now pointed into the channels of DeckLink 3 / 4. Removed by hand (`removeExtraLiveSource`).
  - The two looks (gap 2, WO-1027). Their sources are bare routes with no slot identity. After the second server's
    Caspar restart the master's catch-up replayed them there (`LOADBG 7-10 route://12-4`, `LOADBG 8-10 route://11-3`
    → 2 × `403 LOADBG FAILED` on the second server). Repointed to `route://9-3` / `route://10-4`.
- **Traps:**
  1. **A project autosave cannot change looks once the live deck holds them.**
     `src/api/routes-data-project-handlers.js:364` → `enrichProjectScenesFromLiveDeck`
     (`src/engine/project-scenes-load.js:119`) overwrites `scenes` from the deck. The autosave answered
     `changed: true` and the looks stayed. Runbook step 8 only worked in phase 1 because the deck was empty. The looks
     were changed over the clients' path, WS `scene_deck_sync` — now `tools/e2e/two-box/set-look-source.js`.
  2. **The tracking duty moves on the connector edit, not on the apply** (WO-1028). Main took the duty the moment its
     DeckLink 1 / 2 were saved as inputs, against the old running layout: `ADD 9-751 SHM in1` landed on the running
     64x36 audio channel, `ADD 10-752 SHM in2` answered `COMMAND_UNKNOWN_DATA` every 5 s until the apply. The second
     server had dropped its detector at once. The gate (fix C) reads the saved channel map, not the running Caspar.
  3. A harness run killed mid-way leaves its recording running (and T9.0 may already have cleared the stream key).

### Results

| Check | Phase 1 re-run | Phase 2 | Evidence / cause |
|---|---|---|---|
| T0, T1 | PASS | PASS | 11 / 10 channels aligned; fan-out forwards exactly `dst_mw9orj4o_1` |
| T2.4 DeckLink 2 out | SKIP | PASS | `INFO 7`: `port_302 decklink index 2`, 1080p5000, embedded audio |
| T3.1 directions | PASS | PASS | main `{1:in, 2:in}`; second server `{1:unassigned, 2:out, 3:in, 4:in}` |
| T3.2 inputs, main | SKIP | WARN | no SDI signal on DeckLink 1 / 2 (hardware: nothing is connected) |
| T3.2 inputs, second server | WARN | WARN | no SDI signal on DeckLink 3 / 4 (hardware) |
| T4 tracking | PASS (second server) | PASS (main) | main: duty on, both cameras ~50 frames/s, never stale; second server: no detector, no shm surfaces |
| T5.0–T5.5b takes | PASS | PASS | second server's PGM shows `route ch9 L3` (Mixer) / `ch10 L4` (PPT); LED take stays on main |
| T5.6 no errors in takes | FAIL (26 × 403 on main) | FAIL, then PASS | one stale look from the setup order, see below; `--only=T5` afterwards 8 / 8 |
| T6.3 stream alone, 12 s | 470 of 600 frames | 589 of 600 | |
| T7.1 record alone, 10 s | 462 frames in 9.2 s | 501 frames in 10.0 s | |
| T8.1 soak, 60 s | FAIL: recording 1698 of 2903 frames | recording 3000 of 3000, stream 49.8 fps; FAIL on log lines only | see below |
| T9 aftermath | PASS | PASS | key cleared, nothing running, aligned, in sync |

- **T5.6:** one `LOADBG 8-10 route://12-4` → 403 on both servers at the first take. Main's restart had put the old
  Mixer / PPT look back on screen (restore-on-screens) before the looks were repointed, and the first take's PGM → PRV
  exchange moved that old look to PRV. It did not recur: 0 such lines in the soak, T5 alone 8 / 8.
- **T8.1** fails only on warning lines in the second server's Caspar log:
  - `Connection lost` / `Connection refused` / `aac … frames left in the queue` — the harness's own receiver quit
    (`secs + 4`) while the stream still ran through the recording's stop and probe. Harness fixed (below).
  - `Unused option i=-` at every stream start — product, fixed (below).
  - `[flv] Failed to update header with correct duration / filesize` at every stream stop — ffmpeg cannot seek back
    into a live RTMP output. Not a fault; filtered in the harness.
  - Soak again after the receiver fix: recording 3001 of 3000 frames, stream 2989 frames in 60.04 s.

### The phase 1 frame loss is gone

Second server, 18 s per run (`framedelivery.json`), channel 7's screen consumer dropped 0 frames in each:

| Run | Phase 1 | Phase 2 | Phase 2 load (second server) |
|---|---|---|---|
| idle | GPU 96–100 % | GPU 71 %, 953 MiB | Caspar 73 % CPU |
| record alone | 50 fps | 900 of 900 frames | GPU 74–75 %, Caspar ~527 % |
| stream alone | ~43 fps | 890 frames in 18.03 s (49.4 fps) | GPU 74–75 %, Caspar ~518 % |
| stream + record | recording 58 % of frames, stream ~27 fps | recording 900 of 900, stream 49.4 fps | GPU 67–71 %, Caspar ~854 % |

- Also gone: the 82 DeckLink `in-sync changed` / `Excessive A/V sync drift` lines (0 since the phase 2 apply).
- **What changed between the two:** the tracking detector left this server (~420–440 % CPU, its two shm surfaces and
  GPU readbacks), and two signal-less DeckLink input channels with it; a DeckLink output was added. So the loss
  follows "tracking + its two inputs on the stream / record server". Which of the two parts carries it is not
  separated (WO-1028).

### Gap 2 in phase 2: silent instead of a 403

Main now has channels 9 / 10 itself (its DeckLink 1 / 2), so its own copy of a Mixer take, `LOADBG 7-10 route://9-3`,
succeeds: main's channel 7 layer 10 plays `route ch9 L3`, a layer that does not exist there (ch 9 has layer 1, the
camera, and layer 23). Empty, so nothing wrong is shown — only because the layer number is the DeckLink slot and the
slots differ. A look using a whole-channel route, or the same slot number on both servers, would show main's tracking
camera in main's copy (inference, not run). WO-1027.

## What was done

- **Harness `tools/e2e/two-box/`** (run on main; reads both servers' APIs, the second one's shell over ssh):

  | File | Role |
  |---|---|
  | `run.js` | CLI: `--phase=1\|2 [--static] [--only=T3,T5.1] [--soak=60] [--keep] [--json=file] [--peer=] [--main-lan=]` |
  | `scenario.js` | what each phase expects (DeckLink directions, tracking box, outputs), look names |
  | `lib.js` | box client (get / post / amcp / sh), report, waitFor |
  | `views.js` | readers over `/api/device-view`, `INFO` |
  | `probes.js` | Caspar layer reader, log window, ffprobe, nvidia-smi, the RTMP receiver (`ffmpeg -listen 1`) |
  | `checks-static.js` | T0–T4, read-only |
  | `checks-active.js` | T5–T9, change what is on air |

- **Checks:**
  - T0 cluster: release, Caspar version, mutual link, master / follower, shared show, same destinations.
  - T1 layout: `configComparison.aligned`, channel modes vs INFO, fan-out forwards exactly the peer-cabled destinations,
    LED wall on main only / workflow destination on the second server only.
  - T2 outputs: LED wall on its GPU output; workflow destination 1920x1080@50 on the second server's GPU output; PRV;
    phase 2 DeckLink 2 out; stream + record outputs cabled from the destination.
  - T3 inputs: DeckLink directions per phase, each input on a host channel + a Live source (WARN without SDI signal).
  - T4 tracking: cameras in1 + in2, detection on, the duty on ONE server, fresh frames, the other server has no
    detector and no shm surfaces, the duty is visible to the other server.
  - T5 takes: Mixer / PPT looks from the master show the second server's DeckLink 3 / 4 on its PGM; PRV stage; LED
    take stays on main; a take pressed on the second server; no errors.
  - T6 stream: credentials on the master, start on the second server, receiver on main gets h264 1080p50 + audio; stop.
  - T7 record: 10 s → 1920x1080, 50 fps, every frame, audio.
  - T8 soak: stream + record + takes for 60 s; recording complete, stream unbroken, no log errors, API < 1 s; GPU load.
  - T9 aftermath: nothing running, layouts aligned, show in sync, duties unchanged, detector still fresh.

- **Fixes for what phase 1 found:**
  - **A — `src/replication/amcp-fanout.js` `shouldBlockLocalPgmAmcpCommand`:** `ADD` / `REMOVE` lines pass on a
    follower. They are this server's own consumers (stream, record, shm, a screen); the leader never sends them
    (`shouldFanOutCommand`). `CG … ADD` starts with `CG`, so it stays blocked.
  - **B — `src/api/routes-scene-take-look.js` `relayToMaster`:** a program take on a follower is handed to the master
    as the cluster call `look.take`, with its options (`mainIdx`, `forceCut`, `transitionOverride`,
    `timersVisibility`), and the answer carries `viaMaster: true` (502 when the master does not answer). Preview takes
    stay local. `src/cluster/cluster-call-actions.js` passes the same options on and marks the hand-on `relayed`, so
    the master runs it locally. Chosen over "allow the follower to play": air stays the master's (one journal, one
    take order).
  - **C — `src/tracking/detect-service.js`:** the detector runs, and the `tracking` duty is held, only where a camera
    role resolves to a channel of this server (the surface manager's new `has(role)`, `src/system/video-surfaces.js`:
    DeckLink input, PGM / PRV or Caspar channel; `simulate` counts as local).
    Checked again on every lease tick, so a layout change starts or stops it without a project change. No per-server
    switch to set: the inputs decide.
  - **D — `src/cluster/cluster-air-journal.js` `reset` + `forgetOnCasparRestart`,** called first in
    `setupAllRouting` (`src/config/routing-setup.js`, boot and every Caspar reconnect) with the Caspar pid: a new pid
    empties the journal, the same pid (a TCP blip, Caspar kept its layers) keeps it.
- **Harness changes after the first run:** sync judged by `show.peers.<id>.in_sync`; the record source read from the
  `record_out` connector; look checks accept both layer banks; T5.3 requires PRV to change with PGM untouched; T5.5b
  (cluster-call relay) added; T6.1 sets the credentials on the output's owner; T6.2 cross-checks Caspar's `INFO`
  consumer port against the API's "active"; the RTMP receiver runs with `-nostdin`; the soak samples the idle GPU first.

- **After phase 2:**
  - `src/streaming/streaming-channel-ffmpeg.js`: the stream arguments no longer start with `-format mpegts -i -`.
    Caspar's consumer keeps the last `-format` (`options[name] = value`, `ffmpeg_consumer.cpp:521`) and has no input
    option, so the prefix did nothing but log `Unused option i=-`. The rest of the line is byte-identical.
  - Harness: the soak's receiver outlives the sender (`secs + 30`) and the stream stops with the recording, not after
    its probe; the log filter drops the flv header lines and lines that are a bare level tag;
    `set-look-source.js` (new) repoints a look's first layer over WS `scene_deck_sync` and reads it back.

## Setup runbook

Every device-view edit is `POST /api/device-view <op>` on the server it concerns; nothing restarts Caspar until
`POST /api/caspar-config/apply` on that server (preview: `GET /api/caspar-config/generate`). Read the answer of each
call; an op that answers an error has changed nothing.

### Phase 1

1. **Share the show on the second server:** `POST http://192.168.0.10:4200/api/cluster/show {"on":true}`. Wait for
   `GET /api/cluster` → the master's `show.peers.<id>.in_sync` and the follower's `show.in_sync`. Its own project goes
   to `projects/_cluster/`.
2. **Second server, free the SDI ports:** remove the edges into `dlsdi_3` / `dlsdi_4` (`{"removeEdge":{"id":…}}`, ids
   from `GET /api/device-view` → `graph.edges`), then DeckLink 1–4 to `in`:
   `{"updateConnector":{"id":"dlsdi_N","patch":{"caspar":{"ioDirection":"in"}}}}`. Inputs must end up enabled
   (`casparServer.decklink_inputs_disabled` off — check `live.decklink.inputs`).
3. **Main, release DeckLink 1 + 2:** `ioDirection: "unassigned"` for `dlsdi_1`, `dlsdi_2`.
4. **The workflow destination, on the master:**
   `{"addDestination":{"type":"pgm_prv","label":"Stream PGM","videoMode":"1080p5000","mainScreenIndex":<next free>}}`
   (without `mainScreenIndex` it gets 0, the LED wall's). It is show data, but it reaches the second server only after a
   project autosave on the master wrote `hardwareConfig` — do step 7 before waiting for it. Leave it uncabled on main.
5. **Second server, cable it to the monitor:** find the `gpu_out` connector whose `externalRef` is the connected output
   (HDMI-0). If the operator GUI is cabled there, move the operator GUI off it first (one feed per sink). Then
   `{"addEdge":{"sourceId":"dst_in_<id>","sinkId":"gpu_pN"}}`. `addEdge` takes no note and a sink takes one feed, so
   PRV stays a channel without an output (T2.3 reports it). Remove the operator GUI's edges to disconnected GPU ports
   too, or the apply places the Caspar screen off screen.
6. **Second server, stream + record outputs** (device-local): `POST /api/settings` with ONLY the keys to change (the
   GET is redacted — never post it back):
   `{"streamingChannel":{"enabled":true}, "streamOutputs":[{"id":"str_1","label":"Stream PGM","enabled":true,"type":"rtmp","name":"Str1","quality":"medium"}], "recordOutputs":[{"id":"rec_1","label":"Rec PGM","enabled":true,"name":"Rec1","source":"program_1","crf":26}]}`
   — the record `source` is `program_<mainScreenIndex + 1>` of the workflow destination (`program_4` here), and
   `streamingChannel` must name its PGM channel. Then cable `dst_in_<id>` → `str_1` and → `rec_1`. A port that was an
   output keeps `casparServer.screen_N_decklink_device`: set it to 0 and apply with `{"force":true}`.
   The inputs become Live sources with `{"addExtraLiveSource":…}` (`route://<channel>-<slot>`).
7. **Tracking cameras, on the master:** `GET /api/project`, set
   `previs.tracking.cameras` to `cam_1` role `in1` + `cam_2` role `in2` (copy cam_1's shape) and
   `previs.tracking.detection.enabled = true`, post back with `POST /api/project/autosave {"project": doc}` (stored
   rev).
8. **Test looks, on the master, same autosave:** three scenes in `scenes.scenes` (shape: any look in
   `projects/mplaner.json`): `2box Mixer` (layer 10 source = the second server's DeckLink 3), `2box PPT` (DeckLink 4),
   both with `mainScope` = the workflow destination's `mainScreenIndex`; `2box LED` (any media or colour source the box
   has) scoped to the LED wall's screen. The master lists no Live source for the other server's inputs (gap 2): the
   looks use the route the second server itself lists (`route://11-3`, `route://12-4`).
   **Only while the live deck has no looks.** Later, the autosave leaves `scenes` as the deck has it: change a look's
   source with `node tools/e2e/two-box/set-look-source.js '{"<scene id>":"route://N-L"}'` on the master.
9. **Apply on both** (`POST /api/caspar-config/apply`), wait for Caspar to answer `VERSION` again, check
   `GET /api/state` → `configComparison.aligned`.
10. `node tools/e2e/two-box/run.js --phase=1 --static`, fix the setup until T0–T3 hold, then the full run with
    `--json=<file>`.

### Phase 2

1. **Second server:** DeckLink 1 → `unassigned`; DeckLink 2 → fed by the destination: `{"addEdge":{"sourceId":"dst_in_<id>","sinkId":"dlsdi_2"}}`
   (marks it `out`); DeckLink 3 + 4 stay `in`; stream + record cables stay.
2. **Main:** DeckLink 1 + 2 → `in`.
3. Cameras stay `in1` + `in2` in the show; the tracking server is now main. **Apply on each server right after its
   edits** — the tracking duty moves on the saved layout, before the apply (trap 2 above).
4. **Second server, after its apply:** remove the Live sources of the ports it gave up
   (`{"removeExtraLiveSource": "route://9-1"}`, `route://10-2`). DeckLink 3 / 4 renumber by themselves (11 → 9, 12 → 10).
5. **Looks, before any take:** `node tools/e2e/two-box/set-look-source.js
   '{"sc_2box_mixer":"route://9-3","sc_2box_ppt":"route://10-4"}'` on the master; then clear what the restart put back
   on the workflow destination, or the first take's PGM → PRV exchange replays the old route once.
6. Run `--phase=2 --static`, then the full run.

**Back to phase 1:** second server `removeEdge e_dst_in_<id>_dlsdi_2`, DeckLink 1 + 2 → `in`,
`POST /api/settings {"casparServer":{"screen_4_decklink_device":0}}` (not cleared by itself), apply with
`{"force":true}`, re-add its DeckLink 1 / 2 Live sources; main DeckLink 1 + 2 → `unassigned`, apply; looks back to
`route://11-3` / `route://12-4` with `set-look-source.js`.

Phase 2 needs the tracking venv + models on the tracking server; phase 1 needed them on the second server
(`tools/tracking-detect/setup-venv.sh`, models rsynced from main to `~/.local/share/highascg/models`, done 09.11).

### Restore

`~/backups/twobox-before-20261109-205021/` on each box (config/ + project JSONs): the state before any of this.
`~/backups/twobox-phase1-20261109-220010/` on each box: the phase 1 setting. The second server's own project is
also in its `projects/_cluster/`. `POST /api/cluster/show {"on":false}` there returns it to its own show.

## What was verified

- **Harness:** `node --check`, eslint (0 errors), max-lines, unwired exports. The phase 1 agent calibrated the probes:
  the look probes separate Mixer / PPT / cleared / wrong-channel states; the RTMP receiver was checked with a lavfi
  1080p50 sender and with no sender.
- **Phase 1, first run:** the table above (`phase1.json` / `phase1.log` kept in the session scratchpad).
- **The fixes, offline:** `tools/smoke/smoke-wo1026-two-box-follower.test.js` (new, curated, 13 tests): follower
  ADD / REMOVE pass while PLAY and `CG … ADD` stay blocked; the take relay (options carried, preview / relayed / master
  stay local, unreachable master → 502); the tracking gate (no local input → no detector and no duty, one input is
  enough, a layout change starts / stops it); the journal (reset, new pid empties, same pid keeps, called first in
  `setupAllRouting`). The detector smokes (WO-616 / 665 / 667 / 675 / 979 / 712) got the `hasSurface` seam; the WO-712
  cluster-call expectation now carries `relayed: true`. The WO-979 role-split sandbox (`tools/e2e/duties-fixture.js`)
  had a tracking server with a camera on `in1` and no input at all — it now has one DeckLink input in its config, as a
  real tracking server does (the first gate run failed 8 of its steps on exactly this).
- **Phase 1 re-run on the fixed build:** the section above (`phase1-rerun.json` / `.log` in the session scratchpad).
  All four fixes hold on the boxes.
- **Phase 2 run:** the section above (`phase2.json`, `phase2-T5.json`, `phase2-T8T9.json`, `framedelivery.json` and
  their logs in the session scratchpad). Read back by hand after the agent: `GET /api/server/duties` (main
  `tracking: true`, second server `false`), `GET /api/tracking/detections` on main (both cameras running, not stale),
  `INFO 7` on the second server (decklink index 2 + screen), `configComparison.aligned` true on both, the follower in
  sync on hash 4b95966d45ed866d, no ffmpeg and no `Rec1_*` file left, both Godot clients on their old pids.
- **Stream arguments:** `tools/smoke/smoke-streaming-channel-ffmpeg.test.js` +1 test (one `-format`, the container;
  no input option; RTMP and MPEG-TS). With the SRT / WO-172 / WO-418 / WO-261 stream smokes: 41 / 41.
  **Not verified yet:** a stream start on the second server with this build (needs the next release there).
- **`set-look-source.js`:** an unknown look id exits 1 and changes nothing; the current values written again answer
  `ok` for both looks and the follower stays in sync.
- **Never measurable here:** picture on any SDI port. Nothing is connected to either DeckLink card, so every input
  check is "the channel is open and listed", and DeckLink 2's output is "the consumer runs in Caspar".

## Open

- **Gap 2 — another server's inputs in a look** → WO-1027.
- **The small findings of both phases** (tracking duty moving before the apply, the stale Live sources, what exactly
  cost the frames in phase 1, `screen_N_decklink_device`, and the rest) → WO-1028.
