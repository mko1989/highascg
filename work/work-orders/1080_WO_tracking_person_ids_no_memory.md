# WO-1080 — tracking: new person ids all the time, no memory, detections not held

**Area:** tracking-vr
**Status: IN PROGRESS (15.11.26 — fix replayed against a live recording and committed; NOT live: show on, node and the sidecar were not restarted)**

Owner 15.11 (on show): "it seems to create new persons ids all the time without any 'memory' where it tries matching
the already found person to the one that is on stage rn. this is mostly a problem because it doesn't keep/hold the
person detect long enough, it's jittery."

## Investigation (read-only, show on)

- One tracking camera (`cam_1`, role in3, 14.9 detection steps/s, yolo26n on CPU). With fewer than two solved cameras
  the followers (pin, Auto) get the per-camera tracker's ids (`register.js` pinTick → `_detect.persons()`), not the
  fusion's world ids. So the place that decides identity is the sidecar's ByteTrack (`tools/tracking-detect/bytetrack.py`).
- Recording: 90 s of `GET /api/tracking/detections` sampled every 60 ms (1306 detection steps). Result:
  - two people were tracked the whole 90 s under one id each (scores 0.6–0.8);
  - **27 further ids** were made for what is 1–3 more people: weak detections (median score 0.11–0.25, half of them
    alive under 2 s). 19 of the 27 were born within 0.5 m of where an earlier id had died, 0.6–28 s before.
  - by the time of the recording the ids had reached tid 827 / world 842, 1 h 30 after the node restart.
- Why: a track not matched for `allowance + coast` (about 0.6 s at "Keep lost" 500 ms) was deleted
  (`bytetrack.py` `self.tracks = [… now - t.last_seen <= max_lost_s]`). The next detection at the same place was a new
  track with the next id. A new track was reported from its first frame, so a two-frame blip was a "person" for 0.6 s.
- "Keep lost" (`grace_ms`, Previs → Tracking → Detection) already sets the hold time; the project has 500 ms. Raising
  it had two faults that the replay showed: a coasting track kept its full last speed (a held person slides away), and
  with 2 s a coasting box next to a standing person out-ranked that person's own track in the greedy match — one of
  the two stable people lost their id after 28 s.

## What was done

`tools/tracking-detect/bytetrack.py` (the lifecycle now differs from OpenFollow's; header says so):
- **Memory.** A track past its coast window is parked ("remembered") at its last measured box with no velocity for
  `memory_ms` and is not reported. A high detection that no live track took is offered to the parked tracks first
  (same IoU gate / centre-distance rescue); a match revives the track under its old id.
- **Confirmation.** A track is reported after 3 matches (`MIN_HITS`; matches survive a stay in memory). About 130 ms
  later for a new person; a blip never shows, a person who keeps flickering does.
- **Order.** Tracks measured in the last step match first, then coasting ones, then (low band) the rest, then memory.
- **Coasting.** A lost track keeps 85 % of its velocity per step, so a long "Keep lost" holds the person near where
  they were lost.

Setting `memory_ms` (default 30 000, 0 = off, max 10 min): `src/tracking/detect-model.js`, sent by
`detect-service.js`, sidecar default, GUI field **Remember** under "Keep lost" (`detect_section.gd`, `detect_model.gd`).

Not changed: the world fusion (`fusion.js`, used with two or more solved cameras) still drops a track after 1 s; it
inherits stable per-camera ids through its sticky box keys.

## Verified

- Replay of the recording through `CameraDetector.step` (scratch `replay.py`; the boxes matched in each step stand in
  for the raw detections):

  | code | Keep lost | ids in 90 s | the two stable people |
  |---|---|---|---|
  | old | 500 ms | 29 | 1 id each |
  | old | 2 s | 21 | one lost their id at 28 s |
  | new | 500 ms | 8 | 1 id each |
  | new | 2 s | 8 | 1 id each |

- `tools/tracking-detect/test_bytetrack.py` (7 cases, sidecar venv) and
  `tools/smoke/smoke-wo1080-tracking-memory.test.js` (4 tests, curated list); the other sidecar self-tests and the
  WO-616 / 665 / 675 smokes pass; Godot `--check` OK, `--test` 28489 passed, 0 failed.
- NOT verified live: the running sidecar still has the old tracker. It loads on the next node restart (or sidecar
  respawn). Then: record 90 s again and compare the id count; look at the GUI field.

## Open

- After it is live, try "Keep lost" 1500–2000 ms on the real stage for the jitter.
- Memory matches by place only; two people who swap places while both undetected would swap ids. Appearance
  matching (the WO-675 body features) is the next step if that shows up.
