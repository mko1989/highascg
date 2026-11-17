# WO-1115 — Client at 4–7 fps while the previs follows a desk running an effect: the fixtures push sends only the changed heads

**Area:** lighting, godot-client, tracking-vr
**Status: DONE (17.11.26 — smoke + unit test; on the box 37–50 fps with the same desk effect, was 4–7)**

Owner 17.11: "the client is again suffering at 7fps."

## Investigation

- F3 overlay on the box: Frame 160 ms, Render cpu 2.8 ms / gpu 4.5 ms, 2967 draw calls, the client at 103 % of one
  core — not the renderer (WO-1110), script time.
- Toggled over the API, reading `GET /api/health/keeping-up` after each: `fixtures.dmx.visualise` off → 50 / 50 fps;
  the new scenography layers hidden as well → 50; visualise on again → 4. The cost is following the desk.
- `GET /api/tracking/fixtures` twice 0.2 s apart with MagicQ running its cue: 304 863 bytes, 252 fixtures, 5946 beams;
  50 fixtures / 406 beams differed. `src/tracking/fixtures-watch.js` sent the whole snapshot on every changed 33 ms
  tick, and `godot/client/features/previs/fixtures/fixtures_3d.gd` apply() parsed it and set every beam again.

## What was done

- `src/tracking/fixtures-watch.js`: per watcher the fixtures it has (id → JSON). First send = the whole rig; after
  that only the fixtures whose JSON changed, marked `delta: true`; a changed id set sends the whole rig again; a
  backed-up socket skips and gets the sum in its next delta.
- Client: `fixtures_3d_model.gd` `merged(last, data)` keeps the complete state (re-applied after a rebuild / haze /
  beams toggle); `fixtures_3d.gd` apply() works on what arrived.

## What was verified

- `tools/smoke/smoke-wo797-fixtures-watch.test.js` 6 pass (new delta case); client unit suite 30098 passed, 0 failed;
  `--check` boot OK; eslint, line limit OK.
- Box (node + client restarted), MagicQ still changing 50 heads per 0.2 s: 39, 37, 50 / 50 fps on three reads 10 s apart.

## Not verified

- A cue that changes every head on every tick (all 5946 beams) still costs the full apply; not measured.
