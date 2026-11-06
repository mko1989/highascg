# WO-981 — take / project / autosave path latency and cost (optimization sweep 07.11)

**Area:** engine
**Status: DONE (07.11.26, micro-bench on a copy of a_s.json + 6 PRV takes on the live box; offline suite 5452 tests / 5447 pass / 0 fail / 5 skipped; box node NOT restarted — the autosave changes load on the next restart)**

## Investigation

Bench harness (scratchpad, not in repo): `wo981/bench-persist.js`, `bench-load.js`, `bench-prep.js`; run with `NODE_TEST_CONTEXT=1`
+ `HIGHASCG_PROJECTS_DIR` + `HIGHASCG_STATE_FILE` in the scratchpad so the live `projects/` and `.highascg-state.json` are never touched.
Project a_s: 77.6 KB (scenes 25 KB, hardwareConfig 15 KB), 19 looks, rev 436. Autosave from Godot: 3 s debounce, single-flight
(`godot/client/core/project_sync.gd`) = at most 20 POSTs/min while editing, nothing while idle.

### Q1 — look take to PRV (ch3), `POST /api/scene/take-look {target:"preview"}`, 6 takes on the live box
HTTP total 136–186 ms (first sample 255 ms cold). Breakdown of three timestamped takes (curl ns start vs journal):
| stage | ms | note |
|---|---|---|
| request → `[scene-take] preview-only path` | ~22 | pure compute of the prep is ~1 ms (bench: getChannelMap 0.03, withProgramResolutions 0.07, buildServerIncomingScene 0.005, `withScreenGlobalBorderForChannel` 0.85 = one `loadFullProject`); the rest is HTTP/router/event-loop queueing |
| Phase A (jobs + LOADBG) | 5–10 (outliers 47, 64 when a layer exits) | `phaseA-done=` in the WO-814 timing line |
| prebuffer sleep | **80 fixed** | `scene-take-lbg-amcp-pipeline.js:~282` `prebufferMs` (180 with fade preroll, 600 for shaders) — a `setTimeout`, not work |
| PLAY batch ack | 2–50 | `play-acked=87…146` total from take start |
| after play-acked (setChannel + `broadcastSceneLive` + teardown) | ~30 | |
So the server's own compute in a PRV take is ~2 ms; ~60 % of the wall time is the deliberate 80 ms prebuffer. Nothing in the plan/diff/payload is worth optimizing.

### Q2 — autosave / project write (`persistProject`, 1000 iterations, a_s copy)
Before: edit p50 2.87 ms / p95 3.97; unchanged echo p50 1.64 / p95 2.46. Profile: `canonicalJson` (replacer that rebuilt + key-sorted every object via
`Object.fromEntries`) is the top self-time; it runs 4x per changed persist (`projectContentEquals` + `showContentEquals`, both sides) and 2x per echo.
Per changed persist: 3 `readProjectFile` parses on the handler path (handler `existing`, `preserveProjectCredentials`, `storedProject`), 2 pretty
stringifies of the same payload (main file + `_autosave` copy), 1 pretty stringify of the whole state file (~140 KB, `web_project` is an IMMEDIATE_KEY, 25 ms coalesce).
Sync fs in the request path: yes (read x3, write+rename x2, state file write) — all together < 3 ms, i.e. not a stall at this project size (largest stored project is 122 KB).
Writes/min while editing: <= 20 autosaves -> 40 project-file writes + <= 20 state-file writes.
`findmnt` (execFileSync in `isVolumeMountedSync`) measured 1 ms; only runs on the volume push, which exists on the box.

### Q3 — project load
Not measured live (a load re-stages PGM looks — on-air risk). Offline: `readProjectFile` 0.25 ms, `loadFullProject` (file + autosave + parse) 0.78 ms. Journal of a real
load (06.11 00:20): handler -> `activated` 12 ms; the rest is async fire-and-forget (look-thumb warm 40 ms, AMCP restage INFO/REMOVE, bridge push at +480 ms). Disk parse does not dominate.

### Undo snapshots
Client-side (Godot `project_undo_model.gd`, whole-document canon strings, max 100 steps x ~77 KB = ~8 MB resident at the cap; WO-904 already moved canon off-thread). Out of this lane (798 owns godot/client).

## What was done
- `src/engine/project-scenes.js`: `canonicalJson` hand-rolled (`canonicalKeys` / `canonicalPart`), byte-identical to the replacer version (integer-like keys first in numeric order, then code-unit sort; `toJSON`, undefined/function skipping, NaN -> null, number/boolean fast path, unescaped-key fast path).
- `persistProject`: reads the stored project once (was twice, back to back, nothing writes between) and passes the already-serialized main-file text to the `_autosave` write.
- `src/engine/project-store.js`: `writeProjectFile` returns the text it wrote; `writeAutosaveFile(slug, project, serialized?)` reuses it (falls back to its own serialization when not given — other callers unchanged).
- Test `tools/smoke/smoke-wo981-canonical-json.test.js` (curated in `tools/ci/offline-test-files-3.js`): equals the old implementation on edge cases and on every file in `projects/` + `projects/_autosave/`, cyclic input still throws, main file and autosave copy have identical bytes.

## What was VERIFIED
- Bench after (same harness, 1000 it.): edit p50 **2.87 -> 2.22 ms** (p95 3.97 -> 3.40), echo p50 **1.64 -> 1.30 ms**. ~22 % — modest because the fixed costs are file IO.
- Offline suite 5452 tests, 5447 pass, 0 fail, 5 skipped. max-lines 0 over; eslint clean on touched files; prettier (tools/ci) clean; check-unwired-exports no new orphans.
- Take latency measured on PRV only (6 takes, ch3). No take on PGM, no project load, node not restarted (running process still has the old code until its next restart).
- NOT proven: the running box's autosave after restart (identical-bytes test + 5447 green tests cover the equivalence).

## Proposals NOT built
1. **Prebuffer 80 ms on a preview-only (bankless, cut) take** — it is 60 % of PRV take latency; PRV staging has no crossfade to protect, a 0–20 ms wait may suffice, but it is an AMCP timing change (LOADBG decode headroom) — needs a glass A/B on PRV. A pure `HIGHASCG_PREVIEW_PREBUFFER_MS` knob would make it testable.
2. `withScreenGlobalBorderForChannel` re-reads the whole project from disk on every take (0.85 ms warm; WO-reported 14 ms parse under load elsewhere). Using the live deck would change what a take sees right after an edit (disk lags 750 ms) — decide semantics first.
3. Pass the handler's `existing` into `persistProject` (opts) to drop the third parse; needs care because `stampProjectHardware` mutates around it.
4. `persistence` state file mirrors `web_project` (77 KB, pretty) on every autosave; `HIGHASCG_PERSISTENCE_PRETTY=0` would cut the state write ~30 % but costs readable state — owner call.
