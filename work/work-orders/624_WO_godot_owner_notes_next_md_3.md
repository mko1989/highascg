**Status: DONE (2026-10-20, E1/E2/E3 box-verified through the API and the Godot GUI; offline suite + Godot suite green) — E1 Live sources become windows in the Standard compose preview (server `POST /api/operator-gui/cell`, `/cell/remove`); E2 pick the tracked person by clicking their box (server `POST /api/tracking/detect/pick`); E3 calibrate follow lights from the camera view (server `/api/tracking/follow/calibrate`, = [WO-616](./616_WO_previs_tracking_openfollow_cameras.md) T13 manual slice). Owner QA: E2 interpretation, E3 on a real head. Follow-ups: web compose tiles → server cells ([WO-598](./598_WO_client_contract_and_thin_client.md)), automatic beam-spot detection (WO-616 T13b). Parent: [WO-593](./593_WO_godot_client_port_epic.md).**

# WO-624 — Godot: owner's next.md notes (round 3)

Owner, 20.10 (`next.md`, after WO-623):

- **E1** *"i cant seem to add a decklink or prv/pgm source into the standard live view. i should be able to add each
  source from live tab to be a window in the compose/live preview standard."*
- **E2** *"in the camera previs i can't see an option to pick as a tracking object."*
- **E3** *"dont see an option to calibrate lights."*

Standing rule (WO-623 D): anything that happens in Caspar is composed in node, so every action is an API endpoint.

## Investigation

**E1.** The Godot Standard preview (`godot/client/features/live/compose_tiles.gd`, before 5a0d05f1) drew the server's
operator cells and moved / resized them (`_gui_input`, `_post` → `POST /api/operator-gui/layout`), but had no
`_can_drop_data` / `_drop_data` — nothing could be added. The web did it in the browser: `addSourceTileFromDrop`
(`client/components/operator-compose-tiles.js:266`) checked `sourceTileRejection` (`operator-compose-tiles-state.js:165`)
and kept the tiles in **localStorage** (`:116`), reporting them as `mvcell` cells. A Godot port of that would break the
D rule (the client composing Caspar routes) and would not be shared between clients. On the box the compose channel is
ch 3 while the channel map's `operatorGuiCh` is null, so a guard that only reads the map would allow `route://3` into
itself (found by a test in this WO; `resolveOperatorGuiChannel` is the authority).

**E2.** The replace pin (`src/tracking/detect-pin.js`) chose by itself: the sticky track, else nearest the last centre,
else **the largest box** (`sizeOf`, `:86–89` before b62a0823). A smaller or farther person could never be followed and
the camera view had no click on a person box (`previs_tab.gd` only grabbed markers).

**E3.** The follow patch (`follow_section.gd`) has the fixture pose as hand-typed fields only (X / Y / Z / yaw). WO-616
T13 ("camera-assisted fixture calibration: spot detection + pose solve; manual click fallback") was not started. The
follow engine (`src/fixtures/follow-engine.js`) had no way to park a head at a chosen angle. `project.fixtures` is a
client-owned slice (CLIENT_OWNED_SLICES) — the server cannot write it, so a server solve must hand the pose back.

Geometry (follow-ik.js frame): beam(p, −t) = beam(p + 180, t), so a tilt inversion is just another yaw and is not
identifiable from beam directions; a pan inversion mirrors the sweep and is. A hung head is a floor head upside down —
the hang is not identifiable either, so it stays the operator's input.

## What was done

**E1 (5a0d05f1).**
- `src/system/operator-gui-source-cells.js` (new): the web drop rules server side. A drop names a Sources item
  `{type, value, label, resolution}` and a canvas point. Only `route://` sources are accepted, never a multiview output
  or the compose channel (the map's, plus `resolveOperatorGuiChannel().ch`). PGM / PRV routes become the main's own
  `pgm` / `prv` cell (409 "PGM 1 is already on the preview."); anything else becomes an `mvcell` 30 % of the canvas
  wide at the source aspect, centred on the drop and clamped (x = 0 stays 0). The new set is applied like a client
  report (`applyOperatorGuiLayout`: route PLAY + FILL, persisted, broadcast) together with the last report's media
  cells, so a running media preview is not stopped. `/cell/remove` refuses the last window (an empty set is never
  persisted).
- `src/api/routes-operator-gui.js`, `src/api/router.js`: the two routes; the layout POST notes the media cells.
- Godot: `compose_tiles.gd` accepts `route://` drags from the Sources Live tab (`compose_tile_math.droppable`) and POSTs
  the drop. Each window gets a ✕ (`close_rect`) that POSTs the remove. Server errors flash in the image.

**E2 (b62a0823).**
- `DetectPin.request(key, now)`: a pick wins over the automatic rule while that person is present (incl. coasting
  within the grace), then stays sticky. It waits across the client's switch into Replace and expires after
  `PICK_TTL_MS` 10 s.
- `POST /api/tracking/detect/pick {key}` (`register.js pick`): 400 bad key, 404 if the person is not detected now
  (world persons when 2+ cameras are solved, else camera persons), 503 without detection. Replies with the marker,
  `waiting_for_replace` and `marker_missing`.
- Godot: in Previs → Camera → Detect, a press that grabs no marker picks the person under it
  (`detect_model.person_at`: detection-enabled, this camera, not stale, box contains the click, nearest box centre
  wins — "smallest box" picked the wrong one of two overlapping people in the GUI test). `detect_section.pick_person`
  switches the pin to Replace if needed and says "Marker 1 follows P41." or why not.

**E3 (110de4ef).**
- `src/fixtures/calibrate-solve.js` (pure): `solveFixturePose(pairs, {hang})`.
  - Seeding: a 5° yaw sweep; for each yaw, the position nearest all backward rays (3×3 least squares).
  - Refinement: Levenberg–Marquardt over (x, y, z, yaw) on beam − unit(point − position), run from the best 6 seeds.
  - Both pan senses are solved; the mirrored one must win by 2× to report `flip_pan`.
  - Returns rms / max angular error, the per-point errors and the floor spread. It warns when the points lie on a line
    (spread < 0.3 m) or the fit is poor (> 2° RMS).
  - Needs 3 pairs.
- `follow-engine.js`: `hold(id, pan, tilt)` / `release(id)` / `aimOf(id)`.
  - A held head reports state `calibrating` and wins over its marker.
  - The hold is clamped to the ranges and dropped by a re-patch without the fixture or after 10 min without a refresh
    (a vanished client never leaves a head parked).
- `src/fixtures/calibrate-session.js`: one session per fixture behind
  `POST /api/tracking/follow/calibrate {action: start|jog|point|undo|end, id, …}` (GET lists sessions).
  - `point` pairs the current jog with a marker's position; a stale marker still counts, since it stands where it was
    dropped.
  - Each pair records the Invert pan state it was taken under and is re-read mirrored after a flip, so Apply-with-flip
    keeps the session consistent.
- Godot `calibrate_section.gd`: Follow → fixture → "Calibrate position…".
  - Controls: Pan / Tilt spin boxes (0.1° arrows) with ±1 / ±5 nudges; "Add point at <selected marker>"; Undo point.
  - Shows the fit summary and an "Art-Net output is off" warning.
  - **Apply pose** re-reads the server session first: the cached reply can be older than points another client added.
    It writes x / y / z / yaw (and toggles Invert pan on `flip_pan`) into `project.fixtures` through the follow section.
  - **Done** ends the session.
  - Pure helpers `follow_model.apply_solve` / `calib_summary`.

Spot detection (finding the beam in the camera image automatically) is not done — the marker drop is T13's "manual
click fallback". Pan / tilt zero offsets are not modelled (yaw absorbs a pan offset; a tilt offset is not).

## What was VERIFIED

**E1** — smoke `smoke-wo624-operator-gui-source-cells.test.js` 6/6 (incl. box-like map `operatorGuiCh` null; handler
end to end with fake persistence / AMCP: only the new window PLAYed, media layer re-filled, broadcast, remove stops
the layer). Godot `test_source_drop_and_close_zone`. Box, GUI: DeckLink 1 dropped → live picture in a new window;
DeckLink 2 → `PLAY 3-12 route://5` + FILL (black: no signal on that input); Program 1 dropped → flash "PGM 1 is already
on the preview."; ✕ → STOP / CLEAR. API: remove prv_1 → re-add from route://2 → last-window 409 → `route://3` 400
"compose output itself". Layout restored identical to the pre-test snapshot; config/ md5 identical.

**E2** — smoke `smoke-wo624-tracking-pick.test.js` 5/5 (mutation of the pick branch → 3 fail). Godot
`test_person_at_click` (incl. overlapping boxes). Box: API 400 / 404, pick `w:7` moved Marker 1 from `w:6` to `w:7`.
GUI (Previs → Camera → Camera 2 → Detect, two cameras fused): click on person #22 (world 41) at 2336,778 → Marker 1
moved off `w38` onto `w41`; the Inspector read "Marker 1 follows P41." (screenshot). config/ md5 identical.

**E3** — smoke `smoke-wo624-fixture-calibrate.test.js` 8/8: truss head (3, 5, 7, yaw 30) recovered within 0.1 m / 1°
from 5 spots with ±0.2° jog error; floor head; 3 spots enough (0.3 m); mirrored pan → `flip_pan`; < 3 → `need`;
collinear → warning; session over the real `FollowEngine` + `MarkerHub` (start → `calibrating`, jogs reach the aim,
solve, Invert pan flip re-reads the pairs, relative jog, undo, end → `following`); 404 / 409 / 400, range clamp, TTL
expiry. Mutations (hold branch off; flip detection off) → 2 fail. Godot `test_calibration_solve_applies_pose_and_pan_flip`.
Box (fixture 1 → 127.0.0.1:6455 test port, output master off — untouched):
- API: a simulated head at (2, −6, 5.5, yaw 15) → 4 points → solve exactly (2, −6, 5.5, 15); engine state
  `calibrating` at the jogged angles; unknown fixture 404; missing marker 404.
- GUI: the open session was picked up after a relaunch; "+1.0" moved the engine pan 7.87 → 8.87; **Apply pose** wrote
  X 2 / Y −6 / Z 5.5 / Yaw 15 into the fields, the project autosave and the camera-view beam origin.
- Stale-cache path: after the API swapped the session's points for a (1, −1, 6, yaw 10) head, Apply wrote (1, −1, 6, 10),
  not the cached solve.
- Restore: owner pose (0, 0, 6, yaw 0) re-solved and applied through the GUI — `project.fixtures` byte-identical to the
  pre-test snapshot. Done → session gone, engine `following` at the pre-test aim (−2.4° / −65.74°). Temporary marker 2
  deleted. config/ md5 identical.

Owner QA: E2 — is "click the person's box in Detect mode" the pick you meant? E3 — a real head with output on (jog
direction, spot landing, fit RMS on a real rig).

Gates: offline suite 2816 pass / 1 fail (pre-existing `smoke-wo577-shader-controls` "junk label Value", unrelated);
`wo537` "a plain play() after a pause…" is flaky by 1 ms (12005 vs 12004, passes alone 3/3) — not touched here.
Godot 15946 passed; `--check` boot OK; line limit and prettier clean.
