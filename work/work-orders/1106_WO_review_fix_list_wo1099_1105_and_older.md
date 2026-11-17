# WO-1106 — Review fix list: bugs, leaks and gaps found in WO-1099 … WO-1105 (and older work orders)

**Area:** testing-ci, web-client, godot-client, engine
**Status: OPEN (17.11.26 — list only; nothing fixed yet)**

Owner, 17.11.26: "do a review of latest changes looking for bugs and leaks and other undesired gaps." → "add all of
those to a fixing list. expand the review to older wos"

## 1. How the list was made

- Part A: commits `2eb3d443..68ef9992` (WO-1099 … WO-1105, 265 files, about 20k lines). Four read-only reviewers, one
  slice each: Game World server, Game World client, Settings ▸ Games (WO-1105), Godot previs / puppets / drape.
- Part B: commits `da2c7b9e..2eb3d443` (13–16.11, WO-1049 … WO-1098). Eight slices; rows are added in §3 as they land.
- The 187 smokes of part A's range all pass (17.11), so every row is something the tests do not exercise.
- **Proof column:** `run` = the reviewer reproduced it with a script on the real code; `read` = confirmed by reading;
  `lead` = also checked against the code by the lead; `plausible` = matches the code, not reproduced.
- Tick a row when it is fixed AND has a test that fails without the fix.

## 2. Part A — WO-1099 … WO-1105

### 2.1 Shows on the wall or in a game (fix first)

| # | Where | Defect → what happens | Proof | Fix |
|---|-------|-----------------------|-------|-----|
| A1 | `modules/game-world/client/visitor-logic.js:91`, `visitors.js` (fade / 30 s drop / unknown-`w` ignore) | The hub sends nothing for an unchanged entity; the client reads silence as "gone", fades the visitor and drops it after 30 s, then ignores later `e` updates. Cars on a countdown grid or in a lobby > 30 s vanish and never return. | run, lead | Silence = unchanged: never fade or drop on quiet; `gone` is the only removal (keep the fade for `veg` only). |
| A2 | `modules/stage-salad/server/salad-shots.js:135`, `client/flight.js:174` | `xw.contact(...)` has no collider id `w` (flight keeps only `lastTag`), so the hub finds no target: rules R1 / R6 (vegetable hits car / soldier) never fire in production. Smokes pass `w` by hand. | run, lead | Save `f.lastW = touched.col.w`, pass `w`; add a Salad smoke asserting `q.w`. |
| A3 | `modules/toy-skirmish/server/sk-bots.js:243` (gate only in `sk-room.js:458`) | Skirmish bots ignore `stunUntil`: they keep walking and firing while the causer is paid the bonus. | read, lead | Bots skip move + shoot while stunned (or gate in `combat.fire`). |
| A4 | the three `client/world-join.js`; `game-world/client/visitors.js` `patches()` | No reset on `welcome` after a reconnect: stale visitors stay, a stale slick patch slows that spot for good (`until` ignored), `wq` is not re-sent (quality falls back to cap 12). | read + run (patch) | On `welcome`: ingest `wst off`, dispose, re-send `wq`; filter `patches()` by `until > serverNow`. |
| A5 | `modules/game-world/server/world-hub.js:143`; the games' `sendTo` | A send skipped for backpressure (> 256 KB) is recorded as delivered: a dropped `add` = invisible car, dropped `gone` = frozen ghost, dropped `wst` = all `wv` ignored. | read | `sendTo` returns whether it sent; commit `sent` / `wst` only on true. |
| A6 | `src/games/games-hosting.js:240-268` | "PAUSE EVERYTHING" is not sticky without the Game World module: a session opened afterwards runs live and the button reads "PAUSE EVERYTHING" again. | run | Keep the no-world safe flag in the hosting service; apply it on session open; report `global.safe` from it. |
| A7 | `src/games/games-join.js:126-168` | Automatic join address: link-local 169.254.x, docker / virbr bridges count as "lan" and sort first → QR leads nowhere, no warning. | run | A "local-only" kind ranked after LAN, with a warning. |
| A8 | `modules/game-world/client/world-spectate.js:343-356`, `world-logic.js:176` | Spectator reads `house` / `scene` only from `hello`: the wall stays lit when the operator dims. `board` has no `paused`: the strip shows raw "paused" and the clock keeps counting. | read | Put house + scene in `board` (or re-send `hello`); map phase `paused`. |
| A9 | `godot/client/features/previs/house_lights.gd:33-40` | `house_last` is saved, never loaded: after a restart the toggle goes to 100 %. The test only reads the cfg file. | read, lead | Load `last` in `shared()`; make the test build `shared()` from the path. |
| A10 | `godot/client/features/settings/games_pane.gd:62` | House slider posts only on `drag_ended`: wheel / arrow keys move it, nothing is sent. | plausible, lead | Post from `value_changed`, debounced, still gated by `_quiet`. |
| A11 | `modules/toy-skirmish/client/world-join.js:31,78` | Knock-back slides about 0.18 u, contract says 1.2 u (the soldier's braking eats the impulse). | run | Apply as its own displacement over 0.3 s through the grid clamp. |
| A12 | `godot/client/features/previs/tracking/human_own.gd:63` | Own puppet: only the first `.glb` / `.fbx` loads; the help says export body + head FBX → headless puppet reported "ok". | read, lead | Merge every model file by bone name, or document "one combined file". |
| A13 | `human_body.gd:52`, `human_own.gd:95`, `help/own-test-puppet.md:52,90` | Failed / loaded own templates are cached with no invalidation: the help's "delete convert.json / the GLB to retry" does nothing until a client restart. | read | Re-check on folder mtime change, or fix the help text. |

### 2.2 Leaks and long-run growth

| # | Where | Defect → what happens | Proof | Fix |
|---|-------|-----------------------|-------|-----|
| A14 | `modules/game-world/client/visitors.js:97` | Effect pushed out by the 4-effect cap is disposed but not removed from the scene: orphan groups pile up per visitor (20 stuns → 16 orphans). | run, lead | `old.obj?.removeFromParent()` before `dispose()`. |
| A15 | `modules/game-world/server/world-ws.js:40` | No `bufferedAmount` cap, no ping timeout: a client that never reads grows node's heap without bound; 20 such sockets hold every spectator slot. Public while a game runs. | read, lead | Drop / terminate over 256 KB; ping-pong liveness, about 30 s. |
| A16 | `modules/game-world/server/world-hub.js:372` | `quality` map: one entry per socket that ever sent `wq`, pruned only through `views` (5000 sockets → 5000 entries). | run, lead | Keep the cap in `views` only, or sweep keys not in `views` each tick. |
| A17 | `world-referee.js:82,86`, `world-referee-tick.js:346` | `immUntil`, `rcBoostAt`, `stepAt` never pruned (log maps only when the key is touched again). | read | Sweep in `tick.run`, or reset on `hub.stop()`. |
| A18 | `world-ws.js:46`, `world-hub.js:244` | World sockets stay open and public, and the 10 Hz tick runs on, after the last game stops (contract: public only while a game runs). Rejected sockets are not counted toward the cap while closing. | read | Close world sockets with `off` / 4403 when no game is enabled. |
| A19 | `src/games/register.js:19-20` | Module list cache 500 ms < tick 1000 ms: every second the module dirs and manifests are re-read from disk, sync, forever, even with no game module. | read, lead | Cache longer than the tick, invalidate on enable / disable. |
| A20 | `godot/client/features/previs/house_lights.gd:174-183`; older `previs_quality.gd:251` | The exit-134 pattern again: a static func connects a lambda to the shared singleton's `changed`, never disconnected; one more connection per `control()` call. | plausible, lead | Non-lambda Callable, or disconnect on the box's `tree_exiting`. |
| A21 | `modules/game-world/client/visitors.js:266-276` | `breakHandle` drops the old handle without `disposeClip` (≤ 2 clip copies per visitor). | read | `disposeClip(old.obj)`. |

### 2.3 Distribution

| # | Where | Defect → what happens | Proof | Fix |
|---|-------|-----------------------|-------|-----|
| A22 | `.gitignore`, `.stignore`, `tools/eggs/live-usb/verify-iso-detection-runtime.sh` | `*.converted.glb` and `convert.json` (output of `tools/people/dna_to_glb.py`, Fab-derived) are not ignored and not in the verifier: run in a repo folder, they could be committed or synced. | run (`git check-ignore`), lead | Add to both ignore files and the verifier regex. |

### 2.4 Lower priority

| # | Where | Defect → what happens | Proof | Fix |
|---|-------|-----------------------|-------|-----|
| A23 | `src/games/games-hosting.js:278,311` → `rc-room-bots.js:88,144` | `bots.level` not validated: `"level":"constructor"` → 200, then `add()` throws; RC bots answer 500 until a valid level is posted (route needs auth). | run | Require `level` in the game's `levels`; `Object.hasOwn(LEVELS, lvl)` in RC. |
| A24 | `modules/toy-skirmish/server/sk-world.js:166` | R4 (shot sparks a car) uses the client-claimed muzzle `msg.p`, not the server position. | read | Use the shooter's server `pos`. |
| A25 | `world-hub.js:115-130`, `world-referee-tick.js:447` | Events and bonuses go out even when the target game's `apply()` refused the effect. | read | Gate event + bonus on `apply()` returning true. |
| A26 | `client/components/settings-modal-logic.js:58`, `src/api/settings-post.js:164` | A web settings save re-posts its stale `games` section and reverts a change made in the Godot pane. | plausible | Send `games` from the web only when edited there. |
| A27 | `godot/client/features/settings/games_row.gd:132-154` | The UI never sends `null`: a per-game default cannot be reset to "the game's own"; "on" cannot be picked explicitly. | read | A "game's own" item that patches `null`. |
| A28 | `games_pane.gd:186-193` | Rows of uninstalled game modules stay (frozen state, buttons 404). | read | Free rows whose id left `order`. |
| A29 | `games_qr.gd:76-82` | "Send to preview" writes freed nodes if the dialog closes during the await. | plausible | `is_instance_valid` after the await. |
| A30 | `src/games/games-hosting.js:221,311` | `h.bots.body()` / `h.main.body()` called outside `call()`: a throwing adapter turns a successful open into a 500. | read | Wrap; treat a throw as a refusal. |
| A31 | `src/games/games-join.js` vs each game's `joinUrls` | `games.joinAddress` changes only the Settings QR; the games' own host pages still show the first LAN address. | read | Hand the pick to the games, or say so in the pane. |
| A32 | the three `client/world-join.js` (`queue.length < 64`) | While the renderer loads, the queue drops the newest messages (incl. `add` / `gone`) after about 6.4 s. | plausible | On overflow clear and restart from the next `wst`. |
| A33 | `modules/game-world/client/props.js:52,59` | A model that failed / timed out once (8 s) stays a grey stand-in for the page's life. | read | Accept a late success, or retry on the next `wst`. |
| A34 | `modules/game-world/client/world-host.js:106-110` | A Presenter-safe click during a house POST is dropped silently (shared `busy`). | read | Separate in-flight flag for house posts. |
| A35 | `modules/rc-game/client/bot-brain.js` | Cross-game slick patches (R2) never affect bots (contract: bots take part like players). | read | Hand `patches()` to the bot step. |
| A36 | `modules/stage-salad/client/world-join.js:194` | Airborne visitor cars get their shadow on the hall floor (constant `floorY`). | read | Per-floor lookup. |
| A37 | `modules/game-world/client/world.js:25`, `world-spectate.js:299` | One failed import of the kit shows a fatal card with no retry (unattended wall page). | read | Retry the boot with a back-off. |
| A38 | `human_own_dna.gd:33-40,59` | A crashed DNA converter stays a zombie; `/proc/<pid>` liveness says "converting" for the session and refuses a restart. | plausible | `OS.is_process_running(pid)` (reaps). |
| A39 | `person_avatars.gd` → `Own.template` | Own-model import (FBX / GLB, LODs up to 1 M triangles, retarget bake) runs on the main thread inside the tracking snapshot handler: the on-air GUI freezes for seconds. | plausible | WorkerThreadPool; keep the pebble meanwhile. |
| A40 | `human_own.gd:155-158` | Every `BoneAttachment3D` is freed with its children: rigid eyes / glasses / hats vanish. | plausible | Keep attachments that hold meshes. |
| A41 | `human_own.gd:164-171` | `puppet.json` "moves" not validated: `own:other` → null skeleton → script errors. | read | Accept only `Body.BODIES`. |
| A42 | `stage_objects.gd:88` vs `src/stage/drape-geometry.js:27` | Drape colour: GD accepts `#fff` / `#rrggbbaa`, JS only `#rrggbb` → black in MVR export and games (API / hand edits only). | read | One canonical form. |
| A43 | `drape_ui.gd:37` → `stage_panel._edit` | Colour-picker drag rebuilds the pleat mesh, re-scans the stage and persists the project on every tick. | read | Material albedo only while dragging; upsert on release. |
| A44 | `human_own.gd` `slug_of()` / `list()` | A folder name with no ASCII letters yields the item `own:`, which the server rejects (400). | read | Skip empty slugs or hash. |
| A45 | `godot/client/tests/test_human_own_wo1103.gd` | Leaves `wo1103_own/`, `wo1103_tex/` in the live operator user dir (present on the box 17.11). | lead | `_rm_tree` before and after. |
| A46 | `tools/people/dna_to_glb.py` | A failed write leaves `<out>.tmp` (up to the full GLB) in the puppet folder. | read | Remove in the failure path. |

## 3. Part B — WO-1049 … WO-1098

_Review running 17.11 (rc-game server, rc-game client, toy-skirmish, stage-salad, core Node, stage / fixtures /
tracking / LTC, Godot client, ISO / release / templates). Rows land here._

## 4. Not verified

- Nothing in this list was reproduced on the glass; `run` rows were reproduced offline on the real modules.
- A10, A20, A29, A38–A40 depend on Godot behaviour that was read, not run.
