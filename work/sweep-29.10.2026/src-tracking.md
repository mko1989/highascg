# src/tracking — sweep 29.10.2026 (batch 102)

Files: 27 · lines: 4366 · findings: 0 BUG-HIGH, 3 BUG, 12 DEAD, 6 RISK, 11 QUALITY

Method: every file read in full. Repros (node, mocks, scratch in the session scratchpad, prefix `j49-`): air-rules loop guard, verify-walk with a `null` body, hshm-read with a corrupt header and an EIO, a 3000-case brute-force check of `hungarian.assign` (with and without gate: matches the optimum), a zone-geometry/zone-engine sanity run, and a 4-person scenario through `createAutoDirector` (join, split, pin, lost, home: behaved as documented). Dead-code greps: `grep -rlw <name>` over `client src godot tools scripts index.js` (js/gd/mjs/html/json/sh). `tools/ci/unwired-exports-baseline.json` has no `src/tracking` entry. Smoke tests that read these files as text were counted as live. WO context: WO-616, 675, 707-709, 711-713, 723, 797 (`rg -il` over work/work-orders).

## src/tracking/air-rules.js
- `BUG` src/tracking/air-rules.js:96 — the loop guard is armed for every `look:` action, including `look:<id>@preview`, but a preview stage puts nothing on air (WO-712 R4 defines the guard as "a look that a rule's own `look:` take put on air fires no rules for 3 s"). Failing case (repro run): rules `A → look:B@preview` and `B → companion:1/2/3`; A goes on air (rule 1 stages B on preview, guard armed for B), the operator takes B to program 1 s later → rule 2 never fires (`ran = ['look:B']`). Fix: `if (action.type === 'look' && action.target !== 'preview') guard.set(...)`.

## src/tracking/auto-director.js
- `QUALITY` src/tracking/auto-director.js:312,357,370 — `save()` returns `store.saveSettings`'s true/false and every caller (`slot`, `home`) drops it. A disk that refuses the write (full, read-only home) leaves the POST answering 200 with the new value in memory and the old one on disk after a restart. Fix: answer `bad('could not save settings', 500)` or log a warn when `save()` is false.
- `DEAD` src/tracking/auto-director.js:400 `get file()` — no reader. grep: `grep -rn "\.file\b"` over src/tools finds no use on the director (`trackingAuto.file`, `auto.file`, `director.file`); the smoke tests pass `file` as an option, not read it back. Also `AUTO_MAX` (export, line 406) is referenced only inside this file (`grep -rlw AUTO_MAX client src godot tools scripts` → this file only); drop it from `module.exports`.

## src/tracking/auto-follow.js
- `OK`

## src/tracking/auto-ptz.js
- `OK`

## src/tracking/auto-routes.js
- `DEAD` src/tracking/auto-routes.js:118 export `AUTO_EVENT` — only used inside this file. grep: `grep -rlw AUTO_EVENT client src godot tools scripts index.js` → only auto-routes.js. Drop from exports (keep the const).

## src/tracking/auto-split.js
- `DEAD` src/tracking/auto-split.js:115 export `STAY_M` — used inside this file only. grep: `grep -rlw STAY_M client src godot tools scripts` → only auto-split.js.

## src/tracking/auto-store.js
- `QUALITY` src/tracking/auto-store.js:44 — `Number(s.home?.after_s)`: a file with `"home": {"after_s": null}` gives `Number(null) = 0`, which is finite and is clamped up to `AFTER_S.min` (3 s) instead of falling back to the 10 s default. Only a hand-edited or damaged file triggers it. Fix: test `s.home?.after_s == null` first.

## src/tracking/camera-model.js
- `DEAD` src/tracking/camera-model.js:158 export `invertRadius` — used only by `radial()` in this file. grep: `grep -rlw invertRadius client src godot tools scripts` → only camera-model.js. (`hfovToVfov`, `lensFoldRadius`, `invertDistortion` are used only by the camera-model smoke test, which counts as live.)

## src/tracking/detect-model.js
- `DEAD` src/tracking/detect-model.js:165 export `DETECTION_DEFAULTS` — used inside this file only. grep: `grep -rlw DETECTION_DEFAULTS client src godot tools scripts` → only detect-model.js.

## src/tracking/detect-pin.js
- `DEAD` src/tracking/detect-pin.js:314 export `ANCHOR_STALE_MS` — used inside this file only. grep: `grep -rlw ANCHOR_STALE_MS client src godot tools scripts` → only detect-pin.js.

## src/tracking/detect-service.js
- `RISK` src/tracking/detect-service.js:183-198 `halt()` — sends `SIGTERM` once and forgets the child (`child = null` straight away), with no `SIGKILL` escalation. If the Python sidecar hangs in a stuck ONNX session or a blocked shm read, a project change that re-enables detection calls `start()` and spawns a second sidecar while the first is still alive, both leasing the same surfaces and holding CPU/GPU. Not reproduced (no spawning allowed). Fix: keep the old proc until `exit`, `setTimeout(() => proc.kill('SIGKILL'), 3000).unref()`.
- `DEAD` src/tracking/detect-service.js:65,257 `rev` — a counter bumped at lines 105 and 210 and exposed as `get rev()`, but never read. grep: `grep -rn "\.rev\b" src tools client godot` finds `hub.rev`, `pin.rev`, `this.rev` only; no `detect.rev` / `svc.rev` / `_detect.rev` anywhere (register.js uses `hub.rev:pin.rev` for its change test). Remove the counter and the getter.

## src/tracking/fixtures-watch.js
- `OK`

## src/tracking/fusion.js
- `QUALITY` src/tracking/fusion.js:42 `dist2` — returns the Euclidean distance (`Math.hypot`), not a squared distance. The name suggests the opposite and invites a wrong `sqrt` or a wrong gate comparison on the next edit. Rename `dist`.

## src/tracking/hshm-read.js
- `RISK` src/tracking/hshm-read.js:62 — `Buffer.alloc(stride * height)` takes both values straight from the shm header with no upper bound, and `readSync` errors other than the open are not caught. Repro (mock fs, run): a header with `height = stride = 0xffffff00` and a valid seq → throws `ERR_OUT_OF_RANGE` out of `readLatestFrame`; an `EIO` from `readSync` also escapes. The caller `src/system/video-feed-encoder.js:152` runs it inside a bare `setInterval` tick with no try/catch, and `src/bootstrap/process-guards.js:21` turns an uncaught exception into `process.exit(1)`. Needs a corrupt or hostile `/dev/shm/highascg-*` file, so RISK rather than BUG. Fix: cap `width/height` (e.g. ≤ 16384, `stride*height ≤ 256 MB`) and wrap the body in try/catch returning `{ state: 'invalid', error }`.
- `QUALITY` src/tracking/hshm-read.js:60-61 — a file truncated below the slot offset makes `readFully` fail and the result is `'lapped'` (a retry-me state) instead of `'invalid'`; a stuck, truncated surface looks like a busy writer forever.

## src/tracking/hungarian.js
- `OK` (3000 random matrices up to 5×5, with Infinity cells and random gates, compared with a brute-force optimum: identical pair count and cost every time)

## src/tracking/marker-hub.js
- `DEAD` src/tracking/marker-hub.js:101 exports `MAX_REACH_M`, `MAX_ID` — used inside this file only. grep: `grep -rlw "MAX_REACH_M\|MAX_ID" client src godot tools scripts` → only marker-hub.js (`MARKER_STALE_AFTER_MS` is used by register.js and is fine).
- `QUALITY` src/tracking/marker-hub.js:97 `staleKey()` — builds the full sorted `list()` (one view object per marker) every 33 ms tick just to join the stale ids, and `zone-service.js:91` does the same at 10 Hz. Harmless with a handful of markers, but there is no cap on markers (ids 1..65535 through the API) and the cost is O(n log n) per tick. Fix: iterate `this.markers` once, collect stale ids, sort only that small set.

## src/tracking/pose3d.js
- `DEAD` src/tracking/pose3d.js:120 export `NK` — used inside this file only. grep: `grep -rlw NK client src godot tools scripts` → only pose3d.js.

## src/tracking/presenter-intake.html
- `BUG` src/tracking/presenter-intake.html:41 — the consent line the presenter agrees to says the photo "is deleted when the server restarts". The code does not do that: `presenters.js:80-89` `load()` re-reads `roster.json` (photos, names, mic, face and body features) after a server restart, `register.js:471` comments "reloads the /tmp roster after a server restart", WO-675 line 84 states "Reloaded after a server restart" and `tools/smoke/smoke-wo675-presenters.test.js:69` pins it. Only a reboot (tmpfs `/tmp`) or the operator's DELETE removes the data (WO-675 D2 says exactly that). Failing case: a tech takes the photo after telling the presenter it goes at the next server restart, `systemctl restart highascg` → the photo is still in `/tmp/highascg-presenters` and the presenter is back on the roster. Fix: change the text to "It is removed when the operator clears the roster or the box reboots." (no smoke test pins the current wording: grep for "deleted when" over tools/godot/client is empty.)

## src/tracking/presenter-match.js
- `DEAD` src/tracking/presenter-match.js:111 exports `FACE_VETO`, `EVIDENCE_TTL_MS` — used inside this file only. grep: `grep -rlw "FACE_VETO\|EVIDENCE_TTL_MS" client src godot tools scripts` → only presenter-match.js.

## src/tracking/presenter-routes.js
- `QUALITY` src/tracking/presenter-routes.js:82 — `DELETE /api/tracking/presenters/<id>` for an unknown id answers 404 with the body `{ ok: true }`; the status and the body disagree and a client that reads the body concludes success. Fix: `{ ok: false, error: 'no such presenter' }` on the 404 branch.

## src/tracking/presenters.js
- `RISK` src/tracking/presenters.js:124 — `embed(photoPath(id)).then(...)` has no `.catch`. The default `defaultEmbed` always resolves, so today nothing escapes, but an injected `deps.embed` that rejects, or a throw inside the callback (e.g. `unit()` on a malformed feature), is an unhandled rejection, and the roster entry then stays `face_status: 'pending'` forever. Fix: `.catch((e) => { p.face_status = 'unavailable'; p.body_status = 'unavailable'; changed() })`.
- `QUALITY` src/tracking/presenters.js:232 `photo()` — `fs.readFileSync(photoPath(id))` throws ENOENT when the roster still lists the id but the jpg is gone (hand-cleaned `/tmp`, failed write); the module registry turns it into a 500 `module "tracking" failed`. Fix: try/catch → `null` (the route already maps null to 404).
- `DEAD` src/tracking/presenters.js:276 export `SUGGEST_MIN` — used inside this file only (it is just `KINDS.face.min`). grep: `grep -rlw SUGGEST_MIN client src godot tools scripts` → only presenters.js.

## src/tracking/register.js
- `RISK` src/tracking/register.js:436-446 — the one 33 ms `setInterval` runs `pinTick, tick, followTick, fixturesTick, zonesTick, detectTick, presentersTick, autoWs.tick, autoPtz.tick` with no try/catch, and `src/bootstrap/process-guards.js:21` makes any uncaught exception `process.exit(1)`. One throw in any of them (a malformed project slice reaching `fusion`/`pose3d`/`auto.step`, a cluster `exchangeOf(ctx).offer` fault) therefore takes the whole playout server down within 33 ms; with the systemd restart that is an on-air outage. No concrete throwing input found in this batch (the pure parts are guarded), so RISK. Fix: wrap each tick call in a small `safe(name, fn)` that logs once per second and continues.
- `RISK` src/tracking/register.js:299-312 `locate()` — for a `camera:tid` key it reads `_detect.frames()`, which by design returns the latest frame of each solved camera with no age check (fusion judges freshness itself, detect-service.js:281), whereas `persons()` has the `STALE_MS` guard. Failing case: a presenter is bound to `cam1:5`, the sidecar dies or the camera feed stops → the last frame stays in `latest`, `locate` keeps returning the frozen floor point and `presenters.drive` calls `hub.set` every tick, so the presenter's marker never goes stale (the comment on `locate` says "lost: the marker goes stale") and the follow engine keeps treating the frozen position as live. Only for a non-fused (single solved camera) rig; the `w:` branch is age-checked by fusion. Fix: skip `f` when `now - f.at > STALE_MS` (pass `at` through `frames()`, it is already there).
- `QUALITY` src/tracking/register.js:491-493 — `onShutdown` deletes `ctx.trackingHub`, `ctx.fixtureService` and `ctx.presenters` but not `ctx.trackingAuto` (set at line 434), so after the module is disabled the cluster call path (`cluster-call-actions.js:44`) and the `auto:home` zone action still drive a director whose follow service is stopped. Also: the file is 499 of 500 lines, so the next change needs a split first (the WO-708 verify-walk and auto-ptz moves already came from this limit).

## src/tracking/verify-walk.js
- `BUG` src/tracking/verify-walk.js:161 — `handle()` does `JSON.parse(body)` and then `data.action`; a body of `null` parses fine and `null.action` throws. Repro (run): `new VerifyWalk().handle('POST', 'null', 1)` → `TypeError: Cannot read properties of null (reading 'action')`. Via HTTP, `POST /api/tracking/verify` with body `null` answers 500 `module "tracking" failed: …` instead of 400 (other routes in this module check `typeof data === 'object'`, e.g. auto-routes.js:75). `[]` and `5` correctly get 400. Fix: `if (!data || typeof data !== 'object' || Array.isArray(data)) return 400`.

## src/tracking/zone-actions.js
- `QUALITY` src/tracking/zone-actions.js:62 — the Companion press uses `fetch` with no `AbortSignal.timeout`. A Companion host that is down but not refusing (cable pulled, packet drop) leaves the promise pending for the OS connect timeout (minutes) and the `recent` log entry stuck at `ok: null`; for `presenter` actions (`runPresenter` awaits actions in order) it also blocks the presenter's following actions. Fix: `signal: AbortSignal.timeout(3000)`.

## src/tracking/zone-engine.js
- `QUALITY` src/tracking/zone-engine.js:46 — the vertex filter is `Number.isFinite(Number(x))`, so `null` (and `true`, `''`) pass as 0. Repro (run): `normalizeZones({enabled:true,list:[{vertices:[[null,5],[1,1],[2,2]]}]})` → first vertex `[0,5]`. A damaged project can silently turn a zone into a different shape instead of dropping the vertex. Fix: `typeof x === 'number' && Number.isFinite(x)`.

## src/tracking/zone-geometry.js
- `OK` (square shrink checked for both windings, repro run)

## src/tracking/zone-service.js
- `RISK` src/tracking/zone-service.js:39-44 — `runPresenter` is an `async` function and `ctx.presenters.actionsFor` (presenters.js:210) can throw (e.g. `list.map` on a roster entry with a missing `on_enter` array, which `load()` copies from `roster.json` without checking), and `Promise.resolve(run).then(...)` has no `.catch`. The result is an unhandled rejection (logged by process-guards only) and a `recent` entry that stays `ok: null` forever. Fix: add `.catch((e) => ({ ok: false, detail: String(e?.message || e) }))` before `.then`.
- `QUALITY` src/tracking/zone-service.js:40-43 — a transition on a zone with a blank action slot (allowed, and the common default: "the zone still tracks occupancy") goes through `runAction(null)` → `{ ok: true, detail: 'none' }` and logs `[zones] <name> <kind> … → none` at info level on every entry and exit. Skip the log when `action` is null.
- `DEAD` src/tracking/zone-service.js:117 export `EVAL_MS` — used inside this file only. grep: `grep -rlw EVAL_MS client src godot tools scripts` → only zone-service.js.
