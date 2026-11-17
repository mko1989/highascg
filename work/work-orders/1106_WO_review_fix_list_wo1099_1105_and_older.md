# WO-1106 — Review fix list: bugs, leaks and gaps found in WO-1099 … WO-1105 (and older work orders)

**Area:** testing-ci, web-client, godot-client, engine
**Status: IN PROGRESS (17.11.26 — 120 rows listed; fixing started with agents; part C review of 10–12.11 running)**

Owner, 17.11.26: "do a review of latest changes looking for bugs and leaks and other undesired gaps." → "add all of
those to a fixing list. expand the review to older wos"

## 1. How the list was made

- Part A: commits `2eb3d443..68ef9992` (WO-1099 … WO-1105, 265 files, about 20k lines). Four read-only reviewers, one
  slice each: Game World server, Game World client, Settings ▸ Games (WO-1105), Godot previs / puppets / drape.
- Part B: commits `da2c7b9e..2eb3d443` (13–16.11, WO-1049 … WO-1098, about 60k lines). Eight read-only reviewers: RC
  server, RC client, Skirmish, Salad, core Node, stage / fixtures / tracking / LTC, Godot client, ISO / release.
- The 187 smokes of part A's range all pass (17.11), so every row is something the tests do not exercise.
- **Proof column:** `run` = the reviewer reproduced it with a script on the real code; `read` = confirmed by reading;
  `lead` = also checked against the code by the lead; `plausible` = matches the code, not reproduced.
- Tick a row when it is fixed AND has a test that fails without the fix.

## 2. Part A — WO-1099 … WO-1105

### 2.1 Shows on the wall or in a game (fix first)

| # | Where | Defect → what happens | Proof | Recommended fix |
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

| # | Where | Defect → what happens | Proof | Recommended fix |
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

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----|
| A22 | `.gitignore`, `.stignore`, `tools/eggs/live-usb/verify-iso-detection-runtime.sh` | `*.converted.glb` and `convert.json` (output of `tools/people/dna_to_glb.py`, Fab-derived) are not ignored and not in the verifier: run in a repo folder, they could be committed or synced. | run (`git check-ignore`), lead | Add to both ignore files and the verifier regex. |

### 2.4 Lower priority

| # | Where | Defect → what happens | Proof | Recommended fix |
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

Eight read-only reviewers on `da2c7b9e..2eb3d443`, code read as it stands at HEAD. Same columns as part A; the Fix
column is the recommended fix.

### 3.1 Security and stability of the node process (fix first)

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| B1 | `src/api/routes-modules.js:83`, `src/module-host/module-install.js`, `src/api/routes-tracking-runtime.js` | `security.enforceAuth` is `false` in `defaults-core.js:72` (and on the box), so `POST /api/modules/install {url}` (sha256 optional, enable default) and `POST /api/tracking/runtime/import {from}` let any device on the network download and run code as the server user. | read, lead | Refuse install / enable / uninstall / runtime install + import unless auth is enforced or the request is from loopback; require a sha256 for URL installs. |
| B2 | `src/media/venue-import-job.js:71`, `src/api/routes-venue-import.js:40` | `target()` → `mkdirSync` throws EEXIST inside the busboy `file` listener (upload `x.obj`, then `x.obj/y.png`) → uncaughtException → `process.exit(1)`: one unauthenticated request restarts node (and kills its children). | run, lead | try/catch in the `file` handler → `rejected`. |
| B3 | `src/pixelhue/pixelhue-read.js:40-60,215` | `httpJson` has no `aborted` / `error` / `close` handler on the response: a connection cut mid-body never settles, `pending` stays set, the follow loop and layer list hang until a node restart. | run (same pattern), lead | Reject on `aborted` / `error` / early `close`; hard deadline that clears `pending`. |
| B4 | `src/media/venue-import-job.js:52-63`, `routes-venue-import.js:21,31` | Only a 2 GB per-file cap: no file count, session total or session count limit; staging is under `/tmp` (32 GB tmpfs = RAM here); swept only on the next `session()`; never wiped at boot. | read, lead | Cap files + bytes per session and globally, cap sessions, wipe `STAGE_ROOT` at boot. |
| B5 | `src/stage/venue-sources.js:75`, `venue-convert.js:209,216` | Zips read whole (≤ 2 GB), entries inflated with no uncompressed-size / count check, all textures read at once, worker has no `resourceLimits`: a zip bomb can OOM the worker and node with it. | plausible | Budget on declared uncompressed sizes before inflating; sequential textures; Worker `resourceLimits`. |
| B6 | `src/timecode/ltc-share.js:130` | The audio output label is written unescaped into a quoted string in `~/.asoundrc`: a label with `"` or `}` makes ALSA fail to parse the file → every ALSA client of the user breaks (Caspar audio, LTC, probes). | read, lead | Strip `"` `\` `{` `}` and newlines from the label. |
| B7 | `src/module-host/module-install.js:238-255` | Upgrade unloads and deletes the old copy before the new one is enabled: a broken new version leaves the module down with no copy to go back to (same when the rename fails). | read | Keep `.old-*` until enable succeeds; swap back and reload on failure. |
| B8 | `src/module-host/module-install.js:131-135,208,250` | A `.sha256` sidecar fetched from the same origin is reported as `sha256Verified: true`. | read | Only a caller-supplied hash counts as verified; report `sha256Source`. |
| B9 | `src/module-host/module-fetch.js:61` | Download timeout is socket-idle only: a drip-feed holds the module lock (`loader.serial`) for hours. | read | Overall deadline that destroys the request. |
| B10 | `src/health/keeping-up-service.js:218-228` | `POST /api/health/keeping-up/report` stores any `client` / `key` with arbitrary `target` / `measured`: a phone can raise operator alarms and flood the journal. | read | Coerce to finite numbers; cap live keys per source. |
| B11 | `src/audio/audio-devices.js` `listAlsaCards`, `src/api/routes-screen-timers.js:75` | `execFileSync` (`aplay -l` 8 s, `fc-list` 5 s) on request paths blocks the event loop: a wedged USB card freezes AMCP / OSC / timeline ticks. | plausible | Async `execFile` + cache. |
| B12 | `src/bluetooth/bluetooth-pads.js:73-89` | One status call spawns up to 62 `bluetoothctl` processes; overlapping polls multiply them. | plausible | Share one in-flight promise + short cache. |
| B13 | `src/audio/live-audio-health.js:205-216` | `bridgeDead` repair every 15 s with no backoff when the device cannot be opened: ffmpeg respawn + CLEAR / PLAY + warnings forever. | plausible | Per-slot backoff; log once per reason. |
| B14 | `src/shaderfx/shader-licence.js:94` | Shadertoy title / author keep newlines inside `//` comment lines → GLSL injected, shader fails to compile. | read | Replace `[\r\n]` with spaces. |

### 3.2 Lighting, LTC, importer, tracking

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| B15 | `src/fixtures/desk-feed.js:116` | Per-head grant: a fed head not in the Auto pool gets `indexOf` -1 → `?? 0` → grant 0: its desk channel stays dark whatever the console grants. | read, lead | Not in the pool → shared channel `_applied[0]` (or no grant scaling). |
| B16 | `godot/.../tracking/desk_feed_section.gd:128`, `handover_section.gd:155` | Universe / address SpinBoxes persist per keystroke: typing "200" sends the feed on universe 2, then 20 — a desk's real show universe gets live DMX. The server refusal only covers HighAsCG's own universes. | read, lead | Apply on Enter / focus-out only. |
| B17 | `src/fixtures/desk-feed-layout.js:121-129`, `follow-handover.js` | Self-loop guards miss the visualiser universes and their WO-1078 Art-Net ↔ sACN twins: the box's own feed can show in the visualiser as if the console sent it. | plausible | Add visualised universes + twins to the refusal and `reads` sets. |
| B18 | `src/fixtures/console-match.js:257-269` vs `src/stage/rig-csv.js` | Two MagicQ CSV exports, two rotation conventions (per-angle vs matrix → eulerYXZ): a head with yaw + pitch / roll lands differently depending on the export used. | read | Route `exportCsv` through the rig-csv path. |
| B19 | `src/stage/obj-parse.js:171-173` | `+p[i] \|\| 0` lets Infinity through (`v 1e999 0 0`) → GLB accessor min / max `null` (invalid glTF), report sizes Infinity. | run | `Number.isFinite` per component. |
| B20 | `src/stage/scene-tex.js:41-74`, `venue-import-job.js:140` | Cancel = `worker.terminate()`: the worker's ffmpeg children and their kill timers are orphaned. | plausible | Kill children on a cancel message before terminate, or encode from the main thread. |
| B21 | `tools/ltc/ltc_helper.py:319-327` | `ltc_encoder_get_frame` / `set_frame` / `ltc_frame_set_parity` have no ctypes argtypes: the encoder pointer is truncated to 32 bits — works only while the heap is low; segfault at 29.97 DF / userbits otherwise. | run (latent) | Declare argtypes. |
| B22 | `src/stage/mvr-rig-export.js:52-58` | `invAffine` divides by `det` unguarded: a zero-scale source matrix → NaN in every exported fixture matrix. | read | `\|det\| < 1e-12` → identity or skip. |
| B23 | `src/tracking/runtime-job.js` | Last stdout line without a newline is dropped; `restore()` trusts a bare pid (reused after reboot → stale job "running"). | read | Flush on close; compare process start time. |

### 3.3 Godot operator client

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| B24 | `godot/.../previs/fixtures/console_match_fold.gd:66-84` | WO-1072 reads `fit` / `csv` / `heads` from the Api wrapper instead of `res.data`: on success the status is blank, "Move project to match" / "Take head positions" never enable, Export writes an empty CSV ("0 head positions saved"). The whole feature is dead in the GUI; the test feeds flat dicts. | read, lead | Pass `res.data` (or `{"error": res.error}`); test through the wrapper shape. |
| B25 | `godot/.../previs/previs_stage.gd:267-275` | WO-1067 pad camera: no focus / game gate — a pad used in the retro game window also flies the previs camera. | read, lead | Skip when the window is unfocused or a game session owns the pad. |
| B26 | `godot/client/app/render_pacer.gd:117` | Static func connects a lambda to a `create_timer` timeout, reached from PREDELETE during quit: the exit-134 family. | plausible | Static method Callable `.bind(seq)`; skip when quitting. |
| B27 | `godot/.../visuals/visuals_midi.gd:482` | `with_new_defaults` re-adds `edit` / `clear` / `devpage` / `padbank` defaults on every load: an operator's Unmap comes back after each restart. | read | Defaults revision in `ui.cfg`; add only newer defaults. |
| B28 | `godot/.../tracking/tracking_view.gd:190-195` | Full-frame `get_image()` every 2 s while the ghost is on, also on a hidden tab: periodic hitch. | plausible | Gate on `is_visible_in_tree()`; sample downscaled. |
| B29 | `godot/.../visuals/visuals_midi_library.gd:63-91` | `fill()` re-requests every thumbnail (O(n²) dedupe) and computes all main colours synchronously, no re-entrancy guard: stalls with ~200 clips. | plausible | Cache colour per path, incremental, guard. |
| B30 | `godot/client/app/keeping_up_model.gd:60,81` | `STATUS[lvl]` unclamped; incidents not type-checked: a malformed payload stops the indicator. | read | `clampi`; `is Dictionary` filter. |
| B31 | `ltc_fold.gd:51,233`, `controllers_pane.gd:40`, `runtime_section.gd:67` | Polls (0.25 s / 2 s / 1 s) with no in-flight guard pile up in the 6-slot Api pool; LTC is already pushed over WS. | read | `_busy` per poller; drop the LTC HTTP poll. |
| B32 | `godot/.../visuals/visuals_midi_clips.gd` `bind_pads` | A pad holding a clip in any bank is rebound to `clip:<n>` in all banks: an existing look binding is lost. | read | Bind only pads with no non-clip binding. |
| B33 | `godot/.../tracking/person_avatars.gd` | Held avatars (`_gone`) expire only inside `show_cards()`: when snapshots stop, the figures stand forever. | read | Expire from a timer / on a stale feed. |

### 3.4 All three games: a dropped player

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| B34 | `toy-skirmish/server/sk-room.js:91,191-215`; `stage-salad/server/salad-room.js:209-234` | A socket that drops mid-game stays in `players` (disconnected); the cap counts connected humans only and every join makes a new player. Skirmish: 2000 join → close cycles = 2003 entries, 234 KB per state broadcast. Salad: 20 cycles fill every seat with ghosts for the round; a reconnecting phone gets `full` (final) and loses its score. | run, lead | Resume token in `welcome` (a rejoin takes its old entry back); a joiner may replace a ghost; hard cap on `players.size`. |
| B35 | `rc-game/client/session.js:34-69`, `loop.js:163`; `toy-skirmish/client/session.js:240-333`, `combat.js:17` | Clients ignore `connected:false`: the frozen car / soldier stays drawn; RC cars collide with it and the director can follow it; Skirmish shots stop at the ghost so enemies behind it cannot be hit. | read + run (buffer), lead | In `syncRemotes` hide + exclude a remote with `connected === false`. |
| B36 | `rc-room.js:119-130,417`; `sk-room.js:160`; `salad-room.js:176-188` | Joined spectators are never timed out and there is no ws ping: half-open phones (or 20 silent sockets from one device) hold every spectator seat. No per-address socket cap. | run (sk, salad) | Silence timeout for spectators; ping / pong; per-address cap. |

### 3.5 RC game

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| B37 | `rc-game/server/rc-game.js:76-80`, `rc-room-bots.js:343` | `refreshScene()` re-applies an unchanged scene on every `/scene` GET; `bots.setScene` clears the worlds → every bot jumps to the grid and its laps stop counting whenever a phone joins or reloads. | run, lead | Apply only when `out.rev` changed. |
| B38 | `rc-game/server/rc-video.js:240-244` | `{t:'video'}` runs `sync()` at once, from any socket: on / off flapping restarts the wall-picture worker + ffmpeg ~20×/s. | run + read, lead | Act on change only, ≤ 1/s per socket; hold the lease a few seconds after the last subscriber. |
| B39 | `rc-game/server/rc-room.js:204,320` | All racers gone during the countdown → phase `race` forever; `track` / `laps` / `start` / `bots` answer 409 until Stop. | run, lead | `checkAllFinished()` on entering `race` and on drop / kick in countdown. |
| B40 | `rc-game/server/rc-scene.js:419-430` | One bake queued per rev seen: four edits during a 27 s bake = four full bakes in a row on the main thread. | run | Skip a build whose rev is no longer current. |
| B41 | `rc-room.js:417-419` | Every `ready` broadcasts state even when unchanged (30 sockets × 40/s = 1200 state builds/s) → real phones exceed the send buffer and lose `w` / `results`. | read | Broadcast only on a change. |
| B42 | `rc-game/client/loop.js:47-61`, `input.js:225` | `input.read()` clears the item press every frame; it is used only in the 60 Hz step: on 120 / 90 Hz phones half / a third of presses do nothing. | run, lead | Keep a pending `use` until a step consumes it. |
| B43 | `rc-game/client/interp.js:129-146`, `net.js:132` | `ClockSync` keeps pre-sleep samples across a reconnect: server time is off by the sleep length for ~5 s (car frozen past GO, wrong boxes / rockets). | run (mechanism) | Reset samples on socket open. |
| B44 | `rc-game/client/bot-brain.js:226` | `step()` starts with `out.length = 0`, discarding the `hit` queued by `onMessage('fx')`: bots never report a pulse hit, no `spin` one-shot. | run, lead | Clear `out` after returning it. |
| B45 | `rc-game/client/host.js:193-258` | `refresh()` has no in-flight guard: during a bake every 2 s tick starts another multi-MB `/scene` fetch; a stale answer can flip buttons back. | read | In-flight guard; refetch only on a rev change. |
| B46 | `rc-game/client/session.js:93`, `loop.js:203`, `item-play.js:370` | A mid-race rejoin (`racing:false` on the server) still counts laps locally, shows a position and gets the catch-up bonus. | read | Take `racing` from the player's own state entry. |
| B47 | `rc-game/client/game.js:314-325` | A spectator page refused as full shows the player's "race is full" card; Watch reloads, Try again does nothing. | read | Spectator branch that reconnects. |
| B48 | `rc-game/client/game.js:87` | `pagehide` disposes the stage fx unconditionally: back from the bfcache, lights and wall pictures are gone for good. | plausible, lead | Dispose only when `!e.persisted`. |
| B49 | `rc-game/client/head-follow.js:114-123` | An unbound head re-traverses the whole venue scene every second for the page's life. | read | Stop after a few attempts; bind after a scene load. |
| B50 | `rc-game/client/tunnel-cut.js:31` | The floor exception reads `normal`, the baked GLB has none: floor faces inside a tunnel volume may be cut. | plausible | Height band or `dFdx` / `dFdy` normal. |
| B51 | `rc-room-bots.js:234-236` | Bot brain is `import()`ed at a fixed URL: after a module upgrade server bots run the old physics until a node restart. | read | Version / mtime query on the URL. |
| B52 | `rc-game.js:114-135`, `rc-scene.js:326` | Disable keeps the last bake (~10 MB) in memory although the header says "holds nothing". | read | Clear `ready` / `memo` on disable. |
| B53 | `rc-game.js:53-54,72` | Public `/state` lists the box's 100.64/10 VPN address to guests. | read | Drop CGNAT addresses from the public `joinUrls`. |

(RC's `LEVELS[a.level]` prototype-key hole is row A23.)

### 3.6 Stage Skirmish

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| B54 | `toy-skirmish/client/session.js:294`, `arena-view.js` `setTaken` | Clients never clear a pickup's `until` when the server resets pickups (start / lobby / stop): it shows as gone and cannot be picked while bots grab it. | read | Reset every pickup, then apply `state.pk`. |
| B55 | `toy-skirmish/server/sk-room.js:231` | Speed clamp = 6 u/s × (time since the last accepted move + 0.1 s), unbounded, no wall check: 9 s of silence then one move = 48 u through a block. | run, lead | Cap the window at ~250 ms; refuse targets failing the grid check. |
| B56 | `toy-skirmish/client/game.js:188-233` | `/scene` fetched once; `sceneRev` ignored by the game page: after an operator previs edit the server's arenas, spawns and pickups differ from what clients draw. | read | Refetch + rebuild when `state.sceneRev` changes. |
| B57 | `sk-bots.js:270`, `sk-combat.js:181-224`, `sk-spot.js:323` | Damage lands during pause and results (a bot rocket hit for 90 while paused); the spotlight keeps moving through a pause. | run | `hit` / `boom` require `canAct()`; clear rockets when not acting; shift `spot.movesAt` on resume. |
| B58 | `sk-combat.js:162` | Fire interval is per weapon: a modified client fires every held weapon in the same millisecond. | read | Also a global gap (the 250 ms raise time). |
| B59 | `toy-skirmish/client/combat.js:110` | Own shot spread from `Math.random()`, everyone else from the server seed (cosmetic). | read | Client proposes the seed, server echoes. |

### 3.7 Stage Salad

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| B60 | `stage-salad/server/salad-room.js:260-277` | `endRound` leaves flights live: a vegetable in the air at the buzzer scores after `results` was sent — board and HUD disagree, the announced winner can be wrong. | run, lead | `shots.clear()` after the final tick (or send results after the last landing). |
| B61 | `stage-salad/client/slingshot-model.js:203`, `avatar-react.js:117-190`, `projectiles.js:306` | three.js geometries / materials not disposed (slingshots rebuilt on every roster change, umbrella / stars / hat per avatar, overflowed burst bits): GPU memory grows over a show. | read | Dispose what each object owns, or share geometries in module caches. |
| B62 | `stage-salad/client/game.js:116,304-313` | Sound defaults ON and the AudioContext is created at load (suspended on Chrome / iOS, never resumed): "SND ON" but silent until toggled twice, nodes queue up. WO says off by default. | read + plausible, lead | Default muted, or `resume()` on the first gesture. |
| B63 | `stage-salad/client/flight.js:75-80,137`, `venue.js:121` | Non-finite inputs: NaN velocity → `simulate()` never ends; a NaN collider / a 2-entry screen `p` makes every flight land at once (not reachable from phones today). | run | End the flight when not finite; `contact()` null on NaN; require finite 3-entry `p`. |
| B64 | `stage-salad/client/host.js:116,141,210`, `salad-room.js:343` | Host: a "Pause — presenter safe" tap during another POST is dropped silently; the note says "flights finish" but the server clears them without `end`. | read | `safe` bypasses the busy guard; send `end` or fix the note. |

### 3.8 ISO / release / licences

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| B65 | `tools/release/collect-licenses-stack.sh:11` (from `tools/eggs/live-usb/build-highascg-egg.sh`) | The collector uses `$HOME`; the ISO build runs under sudo (HOME=/root), so Companion's licence, the libretro core copyrights and GPL-3 text are never written and SOURCES.md says "not installed" for Companion / cores / WayVR while they ship. WayVR has no `REDIST_REQUIRED` row. The tree check fails only after the whole eggs produce. | read + host state, lead (line 11) | Default to the playout user's home (`SUDO_USER` / `/home/casparcg`); WayVR row; run the licence tree check before the produce. |
| B66 | `collect-licenses-stack.sh:135` (SOURCES.md `@HIGHASCG_COMMIT@`) | The AGPL source link is `git rev-parse HEAD` with no pushed / clean check: an ISO built from an unpushed or dirty tree points at a commit that is not on GitHub. | read | Fail / warn when HEAD is not on a remote branch or the tree is dirty. |
| B67 | `template/shaders/LICENSES/manifest.json`, shader list UI | 169 of 183 shipped shaders are NonCommercial (CC BY-NC-SA 3.0 / 4.0, CC BY-NC). The FragCoord importer gates NC (`allowNonCommercial`), the shipped Shadertoy library shows no NC marker. Showing them at a paid show is commercial use. | read | **Owner decision:** mark NC in the list and warn before PGM, or move the NC set to an opt-in download. |
| B68 | `src/shaderfx/shader-licence.js:139-143` `isRetiredShader` | Any attribution header un-retires every retired id, including the removed-for-IP ones (sh-mario, sh-balatro, the "all rights reserved" one): a re-import re-exports it into the tracked `template/shaders/`. | plausible | `removed` ids are blocked for good; only `optIn` ids can come back. |
| B69 | `tools/ci/check-npm-licenses.js:160,235` | Dev dependencies are skipped but the CI release packs `node_modules` with them: 12 `lightningcss*` packages (MPL-2.0) ship un-noticed. "Notice required" packages are printed, never checked against THIRD_PARTY_NOTICES. | run | `npm ci --omit=dev` before packing (or gate dev deps); assert every notice-required name is in THIRD_PARTY_NOTICES. |
| B70 | `penguins-eggs-exclude-highascg-embed-server.list:467-471`, `…-fragment.list`, `verify-iso-redistribution.sh` | WO-1076 module excludes exist only in the embed-server list, with no verifier needle; the embed=0 fragment excludes neither `highascg/modules` nor `.highascg/modules*`. | read | Add the needle; mirror the lines into the fragment list. |
| B71 | `docs/reference/vendor/*.pdf` (two PixelHue manuals), `docs/guides/stick/images/flash_step*.png` | Third-party files tracked in the public repo with no licence entry; WO-1095's payload gate has no follow-up WO. | read, lead (PDFs present) | Drop the PDFs (or get permission + a notice); one WO for the leftovers and the payload gate. |
| B72 | `~/highascg/lib/libportaudio.so.2` (ships in the ISO) | PortAudio (MIT) ships without its licence text (not in the collector, the tree or THIRD_PARTY_NOTICES). | run (exclude-match) | Add the MIT text to THIRD_PARTY_NOTICES and the collector. |
| B73 | `tools/eggs/live-usb/verify-iso-detection-runtime.sh:23` | `detection_runtime_check` does not notice an empty `unsquashfs -l` listing: reports "absent" (covered today only by the redistribution check running beside it). | read | `bad` on an empty listing. |
| B74 | `work/work-orders/1096_*.md` §1E, §5; `tools/eggs/.../redistribution.list:43` | The WO says "the dpkg status is excluded" — it ships whole (phantom desktopvideo / magicq / nomachine / zoom / shutter-encoder records); the excluded dracut conffile would not be recreated by `dpkg -i`. | read | Correct the WO text; strip the records or keep relying on payload gates. |

## 4. Not verified

- Nothing in this list was reproduced on the glass; `run` rows were reproduced offline on the real modules.
- A10, A20, A29, A38–A40 depend on Godot behaviour that was read, not run.
