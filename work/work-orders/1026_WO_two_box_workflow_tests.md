# WO-1026 — Two-server workflow on the real boxes: tracking + stream/record on the second server, LED wall on main (test harness + runs)
**Area:** testing-ci, network, video-io, tracking-vr
**Status: IN PROGRESS (09.11 — harness written, 5867 on release 2026-11-09T194123Z and linked; phase 1 and phase 2 runs pending)**

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

## Setup runbook

Every device-view edit is `POST /api/device-view <op>` on the server it concerns; nothing restarts Caspar until
`POST /api/caspar-config/apply` on that server (preview: `GET /api/caspar-config/generate`). Read the answer of each
call; an op that answers an error has changed nothing.

### Phase 1

1. **Share the show on the second server:** `POST http://192.168.0.10:4200/api/cluster/show {"on":true}`. Wait for
   `GET /api/cluster` → `show.in_sync` on both. Its own project goes to `projects/_cluster/`.
2. **Second server, free the SDI ports:** remove the edges into `dlsdi_3` / `dlsdi_4` (`{"removeEdge":{"id":…}}`, ids
   from `GET /api/device-view` → `graph.edges`), then DeckLink 1–4 to `in`:
   `{"updateConnector":{"id":"dlsdi_N","patch":{"caspar":{"ioDirection":"in"}}}}`. Inputs must end up enabled
   (`casparServer.decklink_inputs_disabled` off — check `live.decklink.inputs`).
3. **Main, release DeckLink 1 + 2:** `ioDirection: "unassigned"` for `dlsdi_1`, `dlsdi_2`.
4. **The workflow destination, on the master:**
   `{"addDestination":{"type":"pgm_prv","label":"Stream PGM","videoMode":"1080p5000"}}`. It is show data; wait until the
   second server lists it. Leave it uncabled on main.
5. **Second server, cable it to the monitor:** find the `gpu_out` connector whose `externalRef` is the connected output
   (HDMI-0). If the operator GUI is cabled there, move the operator GUI off it first (one feed per sink). Then
   `{"addEdge":{"sourceId":"dst_in_<id>","sinkId":"gpu_pN"}}`. PRV on the same output is an edge with note
   `{"outputLayer":2}` — only if the sink takes a second feed; otherwise PRV stays a channel without an output (T2.3
   reports which).
6. **Second server, stream + record outputs** (device-local): `POST /api/settings` with ONLY the keys to change (the
   GET is redacted — never post it back):
   `{"streamingChannel":{"enabled":true}, "streamOutputs":[{"id":"str_1","label":"Stream PGM","enabled":true,"type":"rtmp","name":"Str1","quality":"medium"}], "recordOutputs":[{"id":"rec_1","label":"Rec PGM","enabled":true,"name":"Rec1","source":"program_1","crf":26}]}`
   (check `src/api/settings-post.js` for the exact wrapper). Then cable `dst_in_<id>` → `str_1` and → `rec_1`.
7. **Tracking cameras, on the master:** `GET /api/project`, set
   `previs.tracking.cameras` to `cam_1` role `in1` + `cam_2` role `in2` (copy cam_1's shape) and
   `previs.tracking.detection.enabled = true`, post back with `POST /api/project/autosave {"project": doc}` (stored
   rev).
8. **Test looks, on the master, same autosave:** three scenes in `scenes.scenes` (shape: any look in
   `projects/mplaner.json`): `2box Mixer` (layer 10 source = the second server's DeckLink 3), `2box PPT` (DeckLink 4),
   both with `mainScope` = the workflow destination's `mainScreenIndex`; `2box LED` (any media or colour source the box
   has) scoped to the LED wall's screen. How a look names an input that only the other server has is gap 2 — try the
   Live source the master lists for it; if there is none, record that and use the route the second server itself
   lists (`extraLiveSources`).
9. **Apply on both** (`POST /api/caspar-config/apply`), wait for Caspar to answer `VERSION` again, check
   `GET /api/state` → `configComparison.aligned`.
10. `node tools/e2e/two-box/run.js --phase=1 --static`, fix the setup until T0–T3 hold, then the full run with
    `--json=<file>`.

### Phase 2

1. **Second server:** DeckLink 1 → `unassigned`; DeckLink 2 → fed by the destination: `{"addEdge":{"sourceId":"dst_in_<id>","sinkId":"dlsdi_2"}}`
   (marks it `out`); DeckLink 3 + 4 stay `in`; stream + record cables stay.
2. **Main:** DeckLink 1 + 2 → `in`.
3. Cameras stay `in1` + `in2` in the show; the tracking server is now main. Apply on both; run `--phase=2`.

### Restore

`~/backups/twobox-before-20261109-205021/` on each box (config/ + project JSONs). The second server's own project is
also in its `projects/_cluster/`. `POST /api/cluster/show {"on":false}` there returns it to its own show.

## What was verified

- Harness: `node --check`, eslint (0 errors), max-lines, unwired exports. Not yet run against the boxes.
- **Phase 1 run:** pending.
- **Phase 2 run:** pending.
