# WO-1106 — Review fix list: bugs, leaks and gaps found in WO-1099 … WO-1105 (and older work orders)

**Area:** testing-ci, web-client, godot-client, engine
**Status: IN PROGRESS (17.11.26 — 165 rows; about 140 fixed and committed with tests, about 10 partial, 15 open, offline suite 7311 / 0, Godot 29698 / 0; open rows in §7; nothing checked on the glass, node not restarted)**

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

## 4. Part C — 10–12.11 (about WO-1010 … WO-1050)

Four read-only reviewers on `f1b11bb5..da2c7b9e` (about 57k lines), code read at HEAD: linked servers, core Node
(Zoom, window grab, engine, config), Godot client in two halves.

### 4.1 Godot client — Visuals, MIDI, presenters

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| C1 | `godot/.../visuals/visuals_mixer.gd:199` | In A/B mode the strobe is read from `deck()` = the bank being EDITED (PRV), not the one on air: a strobe preset prepared in preview strobes the whole program output; a strobe on the on-air bank does nothing. | read, lead | Weight both decks by the crossfader (`a.strobe·(1−x) + b.strobe·x`); non-DJ mode keeps `deck()`. |
| C2 | `godot/.../visuals/visuals_midi.gd:126-138` (`_bank`, WO-1048) | APC Generic mode sends no track-select note, so only the first CC of the 8-knob bank resend is primed; the other 7 step their parameters (the owner's original bug, for 7 of 8 knobs). The test feeds a note + one knob. | read, lead | Remember the last channel per knob; prime when that knob's channel changes; test with 8 CCs and no note. |
| C3 | `godot/.../tracking/presenters_section.gd:95,120,244-264` (WO-1036) | Capture rows rebuild whenever detections change (~15 Hz) and drop the typed name unless the LineEdit has focus: "tick consent first" → tick → Save → "type the name first". A rebuild during the Save await touches a freed node. | read | Keep typed name / mic per capture id (or update labels in place); `is_instance_valid` after the await. |
| C4 | `presenters_section.gd:18,236,284` | `_photos` texture cache never shrinks; each capture adds full-resolution textures decoded on the main thread. | plausible | Drop keys not referenced after each render; downscale to the thumb size. |
| C5 | `godot/.../visuals/visuals_dj.gd:187`, `visuals_midi_clips.gd:70` (WO-1047) | Clicking Edit A / B does not disarm Sel's armed new slot (only the MIDI path does): the next pad adds a layer on the other bank, which may be on air. | read | Clear `midi.clips.new_slot` inside `dj.focus`. |
| C6 | `presenters_section.gd:215-224` | "Take pictures" has no in-flight guard: a double click replaces the first run's pictures under the same ids. | read | Disable the button until the await returns. |

### 4.2 Zoom, window grab, engine, PixelHue

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| C7 | `tools/window-grab/window_fit.h:146-155` | The "picture went away" branch can never run (`cand_hits` only grows on a valid detection): a Zoom source keeps a stale crop after the share stops, until the window is re-mapped. | run, lead | Count consecutive invalid detections; clear `cur` at 3. |
| C8 | `src/zoom/zoom-audio.js:203-228,330` | The 2 s link tick has no in-flight guard and no backoff: a PipeWire daemon that cannot start is respawned every 2 s forever, ticks overlap, pw-cat / ffmpeg pairs pile up. | read, lead | Skip a tick while one runs; exponential backoff; stop after N failures with one log line. |
| C9 | `src/zoom/zoom-session.js:167-196` | `ensureGrab` has no per-source lock: two overlapping calls each start a `window_grab`; one is orphaned and both write the same ring. A `quit()` during the await is undone. | read | One promise chain per source. |
| C10 | `src/engine/restore-on-screens.js:310-376` | `restoreOnConnect` can run twice when Caspar reconnects during a restore: looks taken twice (a visible double take). | plausible | Claim the snapshot at the start / share one restore promise. |
| C11 | `src/pixelhue/studio-bridge.js:75-111` | Concurrent calls each POST `/api/connect`; every connect invalidates the previous session → bursts of logins and 409s when the pane opens. | plausible | One in-flight connect promise per host. |
| C12 | `src/zoom/zoom-grab.js:30` | `ensureBinary` builds `window_grab` with `execFileSync` (120 s) on the `POST /api/zoom/source` path: the first assign after an update freezes the whole server for the C++ build. | read, lead | Async `execFile`, or build at install / startup. |
| C13 | `src/zoom/zoom-ui.js` `state()`, `autoJoin:185`, `cameraOnceInside:203` | AT-SPI dump has no in-flight dedupe (overlapping python per client); each launch stacks another 15-minute camera loop. | plausible | Share the dump promise; one join / camera loop at a time. |
| C14 | `src/zoom/zoom-audio.js:155,175` | pw-cat / ffmpeg children have no `error` listener: a missing binary = uncaught exception in node. | read | `child.on('error', …)`. |
| C15 | `src/engine/air-snapshot.js:178-190` | A timed-out `waitRestored` leaves its callback in `waiters` forever (one per un-restored Apply). | read | Remove it in the timeout handler. |
| C16 | `src/pixelhue/pixelhue-look-drive.js:133-135` | Read-back `ok()` reads `l.window` on a layer removed during the drive → TypeError → "look not driven" although the writes went through. | read | `if (!l) return false`. |

### 4.3 Linked servers (cluster)

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| C17 | `src/cluster/cluster-peers.js:52-98` (`getJson`, `requestJson`) | Peer answers are buffered with no size cap and only an idle timeout: any device answering `:4200` during a scan (or sitting on a peer's old DHCP address) can stream an endless body → node runs out of memory. | read | Byte cap (1 MB ping / status, 8 MB else) + an overall deadline. |
| C18 | `src/cluster/cluster-master.js:148` (`accept`) | `heard` is refreshed by any validly signed claim before a freshness check: re-POSTing the master's own claim (readable with auth off) keeps "master alive" true after it dies — failover never fires, followers keep gating PGM. | read | Refresh `heard` only on an adopted newer claim / a strictly rising ts per signer. |
| C19 | `src/cluster/dest-route.js:175-180`, `look-relay.js:32-36` | Follower waits 1 s for the master, then takes locally — and still executes the master's forwarded call: a take that runs > 1 s on the master lands twice on the follower's screen. | plausible | opId from the follower; drop a forwarded press already run locally. |
| C20 | `src/cluster/cluster-media-link.js:106-110` (`sleep`) | Each 500 ms poll adds an `abort` listener that is never removed: ~14,400 dead listeners over a 2 h copy. | run | Remove the listener when the timer resolves. |
| C21 | `src/cluster/dest-actions.js:108-120` (`lateBy`) | The per-sender lateness baseline only goes down: after the sender's clock steps back, every `dest.*` press from it is refused `DEST_EXPIRED` for up to 10 min. | plausible | Reset the baseline on repeated over-age presses / a non-consecutive ts. |
| C22 | `src/cluster/cluster-peers.js:319-327`, `src/api/routes-cluster.js:~331` | `poll()` has no in-flight guard and also runs on every `GET /api/cluster`: overlapping polls re-enter hooks that have no busy guard. | plausible | One in-flight poll promise. |
| C23 | `src/cluster/cluster-hello.js:59,100` | The hello replay floor is memory-only: after a restart an old signed hello re-addresses a peer to its old IP for ~5 s. | read | Persist the floor in the call-floor store. |
| C24 | `src/cluster/call-replay-guard.js:30,69` | `MAX_SENDERS` 64 is shared by four namespaces: with 16 peers an extra key evicts a live sender's persisted floor. | read | Size per namespace; evict only unlinked fingerprints. |
| C25 | `src/cluster/destination-ownership.js:64,97,186` | `ownView()` (device graph + channel map) is rebuilt and peer keys re-hashed on every AMCP line a follower sends. | plausible | Cache per config revision / poll tick. |
| C26 | `src/cluster/cluster-media-link.js:69-72` | A queued waiter that wakes on abort does not wake the next one. | plausible | Hand the slot on before returning. |
| C27 | `src/cluster/cluster-call.js` (v1), `cluster-media.js` `acceptSshKey` v1 | v1 signed calls still use a ±60 s clock window (project rule: no clock windows in signed messages): a captured `dest.*` / `look.take` replays after a restart inside the window. | read | Refuse v1 once the peer advertises v2; set a removal date. |
| C28 | `src/cluster/cluster-air-journal.js` | Layer keys are dropped only on a Caspar restart: layers used once are replayed forever. | read | Drop a key when its last entry is cleared. |
| C29 | `src/api/routes-cluster.js` (with B1) | With `enforceAuth` off (the default) `master/set`, `peers` add / delete, `media-spread` and `apply` are open to the venue Wi-Fi: a phone can link a rogue peer or make itself master. | read | Same gate as B1 (auth on, or loopback, or a signed peer call). |

### 4.4 Godot client — PixelHue tab, Devices, config, handover

| # | Where | Defect → what happens | Proof | Recommended fix |
|---|-------|-----------------------|-------|-----------------|
| C30 | `godot/.../pixelhue/programming_panel.gd:332-341` | `command()` checks `busy`, awaits the geometry queue, and only then sets `busy`: a double click on Take (or Take then Cut) right after a layer drag sends both — with Swap on, PGM flips back. | read, lead | Set `busy` before the await (or re-check after it). |
| C31 | `godot/.../pixelhue/pixelhue_tab.gd:65-81` (+ C11) | The 5 s availability poll has no in-flight guard: with the switcher off, ~3 of the 6 Api slots stay busy and Studio's queue grows; out-of-order answers flip the tab shown / hidden. | read | `_polling` guard + back-off. |
| C32 | `godot/client/core/server_address_model.gd:47-56`, `app/connection_menu.gd:51-70` | After a handover, "Server address…" saves the new address but relaunches with the kept `--server=` handover arg: the client cannot be moved. | read | Strip the handover args when the operator picks an address. |
| C33 | `godot/.../devices/channels_cabled_flow.gd:40-85`, `cluster_panel.gd:375` | The "Channels only where cabled" switch loads its state once from this box but writes through the edited peer's api: it shows one server's state and changes another. | read | Reload on `target_changed`; pin the api at build time. |
| C34 | `godot/.../pixelhue/outputs_panel.gd:57-63`, `outputs_advanced.gd:44-53` | `refresh()` on every tab change discards staged output edits (Inputs and Screens keep theirs). | read | Same pending check as Inputs; only Discard forces a re-read. |
| C35 | `godot/.../live/pixelhue_layers_list.gd:35-48` | 3 s poll with no in-flight guard: a switcher that drops mid-show ties up 3–4 of the 6 Api slots for the whole GUI. | read | `_busy` guard; stop polling after N failures. |
| C36 | `godot/client/app/config_pane.gd:280-297` | A failed "Apply edited config" reloads and throws away the operator's hand-edited casparcg.config text; toggling the pane also discards edits without asking. | read | Keep the text and edit mode on failure. |
| C37 | `godot/.../pixelhue/inputs_panel.gd:93-103`, `device_panel.gd:63-74` | A read in flight overwrites what was typed while it loaded. | read | Re-check pending after the await, or disable rows while reading. |
| C38 | `godot/.../pixelhue/device_panel.gd:60-80`, `screens_panel.gd:65-96` | Writes are silently dropped while a refresh reads (shared `_busy`): Restart / Blackout / Freeze pressed right after the tab opens sends nothing. Backup controls keep a value after a failed write. | read | Separate flags or queue the write; say so on failure. |
| C39 | `godot/.../pixelhue/programming_panel.gd:161-173` | A `_load()` answer is adopted with no staleness check: an older read landing after a Take puts the pre-Take layers back. | read | Epoch / revision snapshot; drop a stale answer. |
| C40 | `godot/.../pixelhue/programming_tools.gd:58,156-161` | X / Y / W / H stream per keystroke: typing 1920 moves an on-air layer through 1, 19, 192. Studio's own UI does the same. | read | Commit on Enter / focus-out for PGM layers; check limits first. |
| C41 | `godot/.../pixelhue/pixelhue_tab.gd:81`, `src/pixelhue/studio-bridge.js:76` | "Connected" is cached until the host changes; nothing reconnects after a switcher restart / power cycle. | read + plausible | Reconnect on an auth error / failed page read. |
| C42 | `godot/.../pixelhue/programming_gallery.gd:217-226`, `mvr_panel.gd:134-140` | A failed first read is cached: backgrounds / logos / device layouts stay missing for the client's life. All thumbnails are fetched at once through the 6-slot pool. | read | Cache only on success; 1–2 thumbnails at a time. |
| C43 | `godot/.../pixelhue/inputs_advanced_view.gd:137-145` | `a.polarity` read after `_set_busy(true)`: a missing key errors and leaves every control disabled until restart. | plausible | Build the body first; `get("polarity", 1)`. |
| C44 | `godot/client/app/handover_watch.gd:68-115`, `core/platform.gd:8-11` | Probes create an HTTPRequest each, overlap every 2 s, and a slow answer can overwrite a newer one. "On-box" = loopback origin only: an on-box client started with the box's LAN IP counts as remote and would follow to a linked server (owner rule: it never follows). | read + plausible | One in-flight probe per origin with a sequence check; treat any local address as on-box. |
| C45 | `media_ops.gd:158`, `programming_effects.gd:92`, `outputs_panel.gd:124`, `devices/pixelhue_panel.gd:113`, `media_needs_flow.gd` | Small ones: the remote-file drop guard can never fire; opacity slider sends only on drag end; the 95 s capacity write can be queued twice; a refused "Looks drive the switcher" stays ticked; confirm may use stale needs. | read | As in each line. |

## 5. What was done (17.11.26)

Fix agents (Opus, one Sonnet follow-up) each owned a set of folders; the lead checked every slice against its smokes,
wired the new tests into `tools/ci/offline-test-files-3.js` and committed. Each fixed row has a test that fails on the
old code unless noted. Commits, in order:

| Commit | Slice | Rows |
|--------|-------|------|
| `f21e0a6f` | Game World client | A1, A4 (kit), A8 (client), A14, A21, A33, A34, A37 |
| `5415a1b7` | Game World server | A5 (hub), A8 (server), A15, A16, A17, A18, A25 |
| `d4568d68` | Stage Salad | A2, A4, A5, A32, A36, B34 (partial), B36, B60, B61, B62, B63, B64 |
| `b4732053` | RC client | A4, A32, A35 (client half), B35, B42–B50 |
| `3b4f90b3` | Stage Skirmish | A3, A4, A5, A11, A24, A32, B34 (cap), B35, B36, B54–B59 |
| `bb9f68eb` | core Node | B1, B2, B3, B4, B7–B14, B68 |
| `9285f7d1` | RC server | A5, A23, A32, B36, B37–B41, B51 (partial), B52, B53 |
| `4277dee7` | ISO / licences | B65, B66, B69, B70, B72, B73, B74 (text) |
| `3185fe79` | Settings ▸ Games server | A6, A7, A19, A23, A26, A30, B1 for the module switch |
| `1c10236c` | games follow-up | per-address socket cap made an option, off by default; B51 without the resolve hook |
| `9665505b` | ignore lines, converter | A22, A46 |
| `3393220d` | stage / fixtures / LTC | B5, B6, B15, B17–B23 |
| `4e4a124f` | Zoom / window grab / engine | C7–C16 |
| `453b4c35` | linked servers | C17, C18, C20, C22, C23, C24, C26, C28 |
| `a6785411` | Settings ▸ Games pane | A10, A27, A28, A29, A31 (note only) |
| `0e27ac84` | previs / puppets | A9, A12 (refusal), A13, A20, A38, A40–A45, B25 |
| `6eeee1e0` | Godot client | B16, B24, B26, B27, B30, B31, B33, C1–C6, B28 / B29 (partial) |
| `9084126e` | PixelHue tab / Devices / config / handover | C30–C39, C42, C43, C44 (probes), C45 (opacity, capacity) |

Lead decisions that differ from a row's recommended fix, and why:
- **B1** — "from the box" uses the existing `checkBoxLocalRequest` (stricter than a bare loopback test). A remote Godot
  client cannot install / enable / disable / uninstall modules while API auth is off.
- **B36** — the per-address socket cap is an option, off by default: a NAT'd guest Wi-Fi puts every phone on one
  address. The silent-spectator timeout is on. No ws-level ping was added (the pages ping every 2 s already).
- **B51** — a process-wide `module.registerHooks` resolve hook was written and removed again: only the entry files are
  re-imported; restart node after upgrading the RC module.
- **B4** — the staging folder is wiped on the first session after a start, not at module load (an agent's bare
  `require` of the file emptied the live staging folder once, 17.11).
- **B18** — both MagicQ exports print the WO-765 rotation and the shorter of two equal spellings (a floor head with
  yaw −180: `0,180,180` → `180,0,0`). Same physical rotation; not re-imported into MagicQ.
- **B62** — Salad always loads muted (the remembered "sound on" is dropped). **B64** — the host note was corrected.
- **B55** — Skirmish's move window is 0.25 s: a phone that stalls for a second is pulled back further than before.
- **B65** — the ISO build now checks the licence texts on the host right after the collector and stops there.
- **A12** — a puppet folder with more than one model file is refused; the help says one file per character.

Found while fixing: `godot/client/app/config_pane.gd` set a `CodeEdit`-only property on a `TextEdit` (commit
765919a6) — the logs window's casparcg.config pane threw in `_init`. Fixed with C36.

## 6. Verified

- Offline suite `npm run test:ci`: **7318 tests, 7311 pass, 0 fail, 7 skipped** (17.11, before the Godot commits); with
  everything in: 7328 tests, 7320 pass, **1 fail** (the load-sensitive keeping-up smoke, row D6; 8 of 8 alone), 4 skipped.
  `check-require-integrity` fails only on `projects/*sync-conflict*` files, as before. Lint 0 errors; format check, 500-line check, unwired-exports
  and `check-wos` pass.
- Godot `run-client.sh --test`: **29698 passed, 0 failed**; `--check`: boot OK (no script errors). First run with the
  four unrun GDScript slices was 29676 / 7 failed: all in new tests (scripts naming autoloads compiled before the
  runner has them; a Range emits `value_changed` only inside the tree) plus the `config_pane` bug above.
- All 321 linked-server smokes pass with C17–C28 in.
- The real Hilton hall (WO-1098) imports to the same 8,912,748-byte GLB under the new worker heap limit (peak 415 MB).

## 7. Still open

| # | State | What is left |
|---|-------|--------------|
| B67 | owner decision | 169 of 183 shipped shaders are NonCommercial: mark + warn before PGM, or move to an opt-in download. |
| B71 | owner decision | Two PixelHue manuals tracked in the public repo; stick-guide screenshots. |
| B32 | owner decision | Clip pads vs look pads: binding only free pads leaves the library fill 28 of 40 pads per bank (WO-1070 test pins today's behaviour). |
| C19, C21, C27, C29 | not started | Follower double take, lateness baseline after a clock step, v1 signed calls, auth on the cluster routes — need a design call or the two-box harness. C25 (ownView cache) is performance only. |
| C40, C41 | not started | Per-keystroke layer geometry (Studio does the same); reconnect after a switcher restart (needs the switcher). |
| B34 | partial | No resume token: a reconnecting phone is a new player with 0 points (Salad: can take a ghost's seat; Skirmish: ≤ 10 ghosts kept). |
| A35 | partial | Bots take slick patches on the client side; the RC server has no list of live patches to hand them. |
| A39 | skipped | Own-puppet import still on the main thread. |
| B28, B29 | partial | The 2 s GPU readback still runs while the tracking view is visible; the MIDI library still re-requests every thumbnail. |
| B50 | unrendered | Tunnel floor by derivative normal: shader text only, not compiled on a GPU. |
| C18 | edge | Master clock stepping back + a follower that can only hear pushes → a failover against a live master. |
| C44 | half | An on-box client started with the box's LAN address counts as remote (today nothing passes `--server` on the box). |
| C45 | leftovers | Remote-file drop guard, "Looks drive the switcher" tick, stale needs on confirm. |
| new D1 | not started | Seven more previs SpinBoxes apply per keystroke (`zones_section`, `follow_section`, `detect_section`, `tracking_page`, `ptz_section`, `stage_panel`, `dmx_monitor_window`): check which write to the server (RULES.md input rule). |
| new D2 | not started | `test_demo_engine` clip-player branch never ran headless (now gated on a non-headless display): the demo clip player has no test. |
| new D3 | not started | `cluster-relay.js rawRequest` has no overall deadline; `zoom-session.js rebind()` uses a grab after an await unchecked; `src/utils/lan-ipv4.js` still ranks docker0 / 169.254.x first for the games' own join URLs. |
| new D4 | owner | Per-box DeckLink install will not recreate the excluded dracut conffile (`--force-confmiss`) — B74 follow-up. |
| new D6 | flaky | `smoke-wo1088-keeping-up-service` "nothing moved → no broadcast" failed once in three full offline runs on the box (2 broadcasts instead of 1) and passes 8 of 8 alone: `sampleOnce()` reads the real machine's state, which moves under the load of the parallel suite. |
| new D5 | CI | The verify job checks production npm licences only; dev dependencies are checked at release time. |

## 8. Not verified

- Nothing was checked on the glass, on phones, on a switcher, a lighting desk or the second box: every proof is an offline smoke, the Godot unit suite or the headless boot check.
- The node service was not restarted: no server-side fix is live on the box yet. The web client was rebuilt (`npm run build:client`) but no browser was reloaded.
- The `window_grab` binary was not rebuilt (C7); it rebuilds at the next Zoom source assign.
- The ISO changes were not run under sudo and no ISO was built.
