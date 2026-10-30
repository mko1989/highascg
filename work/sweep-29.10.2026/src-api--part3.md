# src/api — sweep 29.10.2026 (batch 063)

Files: 46 · lines: 6988 · findings: 1 BUG-HIGH, 6 BUG, 5 DEAD, 11 RISK, 11 QUALITY

Method notes. Auth (WO-811) is applied once, globally, in `router-dispatch.js` (`checkHttpAuth`) before any route runs, so there is no per-route auth gap in this batch; on this box `GET /api/auth/status` reports `enforceAuth:false`, i.e. every route below is open on the LAN today. The registry returns on the FIRST matching route (`route-registry.js` dispatch) and a handler that returns `null` ends the search, so I checked each `/*` pattern against later registrations: no shadowing in this batch (`/api/scene/live/preview/clear` is correctly ahead of `/api/scene/*`; `/api/server/duties` ahead of `/api/server/*`). `AmcpClient` has no `send()` (checked by instantiating it with node), which the BUG-HIGH below rests on.

## src/api/routes-pixel-map.js
- `OK` Read in full. `prop(ctx).get/accept/dismiss` are closures (`src/fixtures/pixel-map-proposal.js` returns plain functions), so passing them unbound to `handleProposal` is fine. Every handler returns a status; errors map to 400/500/503.

## src/api/routes-playlist-edit.js
- `OK` Read in full. Bad input answers 400; `control()` forwards a parsed object to `handlePost`, which `parseBody` accepts as-is.

## src/api/routes-playlist-panel.js
- `DEAD` src/api/routes-playlist-panel.js:17,94 `DEFAULT_TIMELESS_SECS` — defined and exported, never read. grep: `grep -rn DEFAULT_TIMELESS_SECS src tools client godot/client` → only the definition and the export line (the real "20" default lives in `engine/playlist-edit.js` `timelessSecsOf`).

## src/api/routes-playlist.js
- `OK` Read in full. (`/api/playlist/control` is registered `requireCaspar:true`, router.js:408, although `update_live`, `set_timeless`, `set_start` need no AMCP; harmless because `ctx.amcp` is only null after shutdown, see the routes-scene.js note.)

## src/api/routes-plugins.js
- `BUG` src/api/routes-plugins.js:60-67 (and :42, :111) — `/api/plugins/:id/(enable|disable|update)` never validates `:id`; `/add` runs `validatePluginInput` (isValidPluginId) but the per-id route does not. Failing case: `POST /api/plugins/zzz/enable` (not in PLUGIN_CATALOG, never added) → `setEntry(config,'zzz',{enabled:true})` is written to `ctx.config.plugins` and persisted (`persistPlugins`) BEFORE `enablePluginNow` runs; `enablePluginNow` then fails with `load_failed` → 409, but `plugins.entries.zzz` stays: it shows up in `GET /api/plugins` as `not-installed` and `loadEnabledPlugins` retries `require('./zzz/register')` on every boot. A `%2F`-bearing id is decoded by `decodeURIComponent` and becomes the `moduleName`, so `module-registry.tryLoad` (`./${name}/register`) can be pointed at any `<dir>/register.js` relative to `src/`. Fix: reject ids failing `isValidPluginId` / absent from store+catalog with 404 before `setEntry`; persist enable only after a successful load.
- `QUALITY` src/api/routes-plugins.js:6-10 — `persistPlugins` returns `configManager.save()`'s result (or `false` with no configManager) and every caller ignores it, so the reply says `ok:true` even when nothing was persisted.

## src/api/routes-preview-nudge.js
- `BUG` src/api/routes-preview-nudge.js:79 — client effect params reach the AMCP wire unescaped. `buildEffectAmcpLines(fx.type, fx.params, cl)` (engine/scene-take-lbg-helpers.js:23-55) interpolates `p.left`, `p.mode`, `p.key` … raw, and `batchSendChunked` joins the lines with `\r\n` without sanitising (`caspar/amcp-batch.js:200`; `amcp-utils.js:12-16` states the repo rule that CR/LF in a param ends the command). Failing case: stage a look on PRV, then `POST /api/preview/mixer-nudge {"mainIndex":0,"sceneId":"<staged id>","layers":[{"layerNumber":10,"effects":[{"type":"crop","params":{"left":"0\r\nCLEAR 1"}}]}]}` → the batch contains `MIXER 2-10 CROP 0` and `CLEAR 1 0 1 1 0 DEFER` as two AMCP commands. `crop` is the only effect built in the default path; `allEffects:true` (sent by routes-scene-preview-push.js:119) widens it to `blend_mode` (`String(p.mode).toUpperCase()`), `chroma_key` (`p.key`), etc. Impact is bounded because `/api/amcp/raw` already gives an authenticated caller raw AMCP, but the same builder serves the take pipeline with stored/synced look data, where no such caller exists. Fix: coerce numeric params with a finite-number check and pass string params through `param()` inside `buildEffectAmcpLines`.

## src/api/routes-private-sync.js
- `QUALITY` src/api/routes-private-sync.js:14-19 — the `catch → 400 'Invalid JSON'` is unreachable: `parseBody` never throws (returns `{}` on bad JSON, response.js:9-17), so a malformed body falls through to the "Use dryRun… or confirm" message. Use `parseBodyStrict`.

## src/api/routes-project-assets.js
- `OK` Read in full. Used by the Godot hardware reconcile (`GET /api/project/missing-assets`).

## src/api/routes-project-hardware.js
- `OK` Read in full. (`handlePost(p, ctx)` takes no body by design; routes-project.js `handlePost` calls it that way. Live `GET /api/project/hardware-check` answers correctly.)

## src/api/routes-project.js
- `BUG` src/api/routes-project.js:44 — `handleReconcile` reads `layer.value`, but look layers carry the clip at `layer.source.value` (what its own `layerHasContent` filter tests, engine/scene-transition.js:124-126; live data from `GET /api/scene/live` shows `"source":{"type":"media","value":"KV LOOP 2.mov"}` and no top-level `value`; `grep -rn "layer\.value\b" src` → this line only). Failing case: a live look whose media is missing on the server → `val` is always `''` → nothing lands in `usedMedia/usedTemplates` → `POST /api/project/reconcile` always returns `isClean:true` with empty lists, and the Sync modal (`client/components/sync-modal.js:62`) tells the operator everything is present. Fix: use `layer.source?.value` (and `source.type === 'template'` to split media/templates instead of the extension heuristic).
- `RISK` src/api/routes-project.js:175-236 — `POST /api/project/apply-bundle` is destructive with no confirmation token (compare private-sync's `confirm: 'PRIVATE_SYNC'`). `{"state":{}}` passes the `typeof === 'object'` test and removes EVERY persistence key (line 186) before anything is validated or written (non-atomic: a crash mid-loop leaves a partial store); a JSON `null` payload throws at `payload.state` → 502; with `config` it saves and `process.exit(0)` after 1 s (line 222) even if `configManager.save` reported failure; Caspar is restarted unconditionally (line 231) whether or not anything Caspar-related changed. On an on-air box one stray POST wipes state and restarts playout.
- `RISK` src/api/routes-project.js:252-273 — `GET /api/project/bundle` returns the raw `ctx.config` plus `persistence.getAll()` (about 400 KB here) without the redaction `GET /api/settings` applies. No secret was found in this box's bundle today (key-name scan of the live response: only `*_decklink_keyer`), but `security.apiToken`, stream keys or GDTF credentials would travel in it, unauthenticated while `enforceAuth` is false.
- `RISK` src/api/routes-project.js:95-125 — `handleSyncPush` calls `runSceneTakeLbg` per live channel directly, not through `chainSceneTakeWork` / `ctx._sceneTakeChainByChannel`, so it can interleave with a queued `/api/scene/take` on the same channel (the race routes-scene-shared.js:36-57 exists to prevent); it also replays PRV channels' entries (the live map holds PRV recalls too) as program-style takes.
- `QUALITY` src/api/routes-project.js:137-150 — `handleManifestDiff` does `for (const item of incomingManifest)` / `item.path.includes` without type checks: `{"mediaManifest":{}}` or a numeric `path` throws a TypeError → 502 instead of 400.

## src/api/routes-replication-get.js
- `DEAD` src/api/routes-replication-get.js:214-226 `/api/replication/export/playhead` — byte-identical duplicate of `/api/replication/playhead-export` (:227-239). grep: `grep -rn "export/playhead" client godot/client src tools scripts` → no caller; only `docs/wiki/api/contract/http.md`. The in-repo peer (`src/replication/playhead-sync.js`) calls `playhead-export`. Keep one.
- `OK` otherwise. Read in full; every token-gated export route answers 401, errors 500.

## src/api/routes-replication-post.js
- `QUALITY` src/api/routes-replication-post.js:25-30 — the `try/catch → 400 'Invalid JSON'` is unreachable (`parseBody` never throws); a malformed body silently becomes `{}`.
- `DEAD` src/api/routes-replication-post.js:108 `/validate-caspar-parity`, :137 `/reload-local-machine`, :221 `/pair-credentials` — no in-repo caller. grep: `grep -rn "replication/pair-credentials\|replication/validate-caspar-parity\|replication/reload-local-machine" client godot/client src tools scripts` → docs only (`docs/wiki/api/contract/http.md`, `docs/reference/hot-backup-replication.md`). They are documented API surface, so "operator curl only", not safe to delete blindly.

## src/api/routes-replication-shared.js
- `RISK` src/api/routes-replication-shared.js:13 — `token === repl.peer.token` is a plain string compare for the pair secret; `server/auth.js` already has `secureCompare` (timingSafeEqual). Remote timing attack is impractical, but the shared secret is the only gate on `/api/replication/project`, `/timelines` and the `export/*` routes when `enforceAuth` is off.

## src/api/routes-replication.js
- `DEAD` src/api/routes-replication.js:3,7 `replicationPairConfigured` re-export — grep: `grep -rn "routes-replication'" src tools` → only router.js, which uses `handleGet/handlePost`; nobody imports `replicationPairConfigured` from this module (routes-replication-get.js imports it from `config/replication-config` directly).

## src/api/routes-scene-border.js
- `OK` Read in full.

## src/api/routes-scene-countdown.js
- `OK` Read in full.

## src/api/routes-scene-global-border.js
- `OK` Read in full. `persistProject` is synchronous; the read-modify-write window across the AMCP awaits is the documented last-write-wins (WO-329B).

## src/api/routes-scene-layer-scrub.js
- `OK` Read in full.

## src/api/routes-scene-layer-tools.js
- `OK` Read in full.

## src/api/routes-scene-look-preset.js
- `OK` Read in full. `Promise.all` over takes is safe: an item that throws only rejects the request, the take-group barrier times out (take-sync-barrier.js `timeoutMs`).

## src/api/routes-scene-lower-third.js
- `OK` Read in full. (`call()` ignores the status of `/api/lower-thirds/*`, but those handlers swallow AMCP errors and always answer 200, so nothing is lost.)

## src/api/routes-scene-new-layer.js
- `RISK` src/api/routes-scene-new-layer.js:95-96 — the WO-816 `layerNumber` is accepted as any positive integer (`Number.isInteger(want) && want > 0`) with no check against `LOOK_LAYER_MIN..LOOK_LAYER_MAX` (10–99, engine/look-layer-ranges.js), whereas `/api/scene/take` (routes-scene-take.js:114-128) and the nudge (routes-preview-nudge.js) both enforce the band. `POST /api/scene/new-layer {"sceneId":…,"source":{"value":"a.mov"},"layerNumber":5}` returns a layer numbered 5 (an audio-bus layer); the take later rejects it with 400, so the damage is a stored un-takeable look. Reject out-of-band numbers here with 400.

## src/api/routes-scene-new-look.js
- `OK` Read in full.

## src/api/routes-scene-preview-pip.js
- `OK` Read in full.

## src/api/routes-scene-preview-push.js
- `QUALITY` src/api/routes-scene-preview-push.js:24 — `NUDGE_MAX_LAYERS = 12` is a second copy of routes-preview-nudge.js:48 (which exports it); import it so the two limits cannot drift.

## src/api/routes-scene-preview.js
- `QUALITY` src/api/routes-scene-preview.js:100-123 — when the PRV AMCP clear throws, the live-map entry is still deleted and the reply is `ok:true, cleared:true` (only `clearedAmcp:false` hints at it): server state says PRV is empty while layers may still be on the PRV channel. Self-heals on the next nudge (`staged:false` → full take), so no failing on-air case shown.

## src/api/routes-scene-shared.js
- `OK` Read in full.

## src/api/routes-scene-take-audio-only.js
- `OK` Read in full.

## src/api/routes-scene-take-look.js
- `OK` Read in full.

## src/api/routes-scene-take.js
- `RISK` src/api/routes-scene-take.js:309 — `liveSceneState.clearChannel?.(bus1)` is not awaited, while the file's own WO-341 comment (:208) says live-scene-state writes run inside `runSerialized` (a promise-queue, utils/async-serial-queue.js) and un-awaited writes made `broadcastSceneLive` read the previous map. The exchange promise resolves right after, and the broadcast at :406 can run before a write queued behind other pending writes; a rejection of that write would also be an unhandled rejection. Await it (routes-scene-preview.js:118 and routes-scene-global-border.js already do).
- `QUALITY` src/api/routes-scene-take.js:168 — `const bus2 = null` is never reassigned; `bus2 == null` (:241) is always true and `bus2=${…}` in the log line is always `n/a`. Leftover from a removed two-bus design.

## src/api/routes-scene.js
- `QUALITY` src/api/routes-scene.js:19-60 — the `if (!ctx.amcp) return null` guards are unreachable: router.js:474 registers `POST /api/scene/*` with `requireCaspar:true`, so the registry answers 503 before the handler runs. The reverse also holds: the pure-compute endpoints (`new-layer`, `new-look`, `layer-fit`, `lower-third` resolve, `countdown`, `border-lines`, `border-preset-crossfade`, `live/preview` register) sit behind the same Caspar gate although their handlers need no AMCP (only `live/preview/clear` got its own `requireCaspar:false` line, router.js:472). In practice `ctx.amcp` is set at boot (`index.js:282`) and nulled only at shutdown, so the gate almost never trips.

## src/api/routes-screen-timers.js
- `BUG` src/api/routes-screen-timers.js:295-298 — `POST /api/timers/cmd` records the command BEFORE checking the timer is assigned, and `recordTimerCmd`/`recordTimerPause` create a record for an unknown id and persist it (engine/screen-timers.js:310-380). Failing case: `POST /api/timers/cmd {"timerId":"nope","cmd":"start"}` → 400 "Timer nope not assigned to any screens", but `GET /api/timers/list` now contains a persisted phantom `nope` record (`lastCmd:'start'`, no screens). Fix: look the record up first and return before recording.
- `QUALITY` src/api/routes-screen-timers.js:131-139,171-181,236-246 — assign/unassign/visible fire-and-forget the AMCP (`.catch` only logs) after mutating the registry and answer `ok:true`; and `handlePost` maps every `ok:false` (including AMCP failures in `cmd`) to 400 instead of 502. The operator sees success on a timer that never reached the screen.

## src/api/routes-screens.js
- `BUG` src/api/routes-screens.js:79 — `screenIdx` has no upper bound and the legacy-array fallback pads with `while (screenLabels.length <= screenIdx) screenLabels.push('')`. Failing case: `POST /api/screens/label {"screenIdx":2000000000,"label":"x"}` with no destination owning that index → the loop allocates until the Node heap is exhausted (measured with the same loop: 20 million pushes = 507 MB in 0.3 s, so the process dies near ~150 M entries) → the playout controller crashes; a value like 5000000 instead persists a 5 M-entry array into the config file. Fix: reject `screenIdx` above the screen count (`getChannelMap(cfg).screenCount`, max 4) with 400.

## src/api/routes-server-duties.js
- `OK` Read in full.

## src/api/routes-settings.js
- `DEAD` src/api/routes-settings.js:18-22 + router.js:294 `GET /api/hardware/displays` — no caller. grep: `grep -rn "hardware/displays" client godot/client src tools scripts` → router.js and routes-settings.js only; the rest is docs (`docs/wiki/api/system-settings-hardware.md`, `contract/http.md`). `modeline-preview` beside it is live (client/components/device-view-actions.js:81). Documented contract route, so the owner decides.

## src/api/routes-shader-live.js
- `QUALITY` src/api/routes-shader-live.js:36-40 — `chains` (the per-shader op queue) gets an entry for every id passed to `serialized()`, including ids from `/api/shader-live/shaders/<anything>/<op>` and `push {shaderId}` that fail `S.open` / match no instance, and never deletes entries: unbounded Map growth for junk ids (a few bytes each, low risk). Validate with `store.isValidShaderId` first or delete the entry when the chain settles.

## src/api/routes-shader-stack.js
- `BUG-HIGH` src/api/routes-shader-stack.js:73,77 — `ctx.amcp.send(...)` does not exist. `AmcpClient` (src/caspar/amcp-client.js + `amcp-client-commands.js`) exposes `raw`, `loadbg`, `play`, `batchSend`…, not `send`; `new AmcpClient({config:{}}).send` is `undefined`, and `grep -rn "amcp\.send(" src` → only these two lines. Failing case: the Shader Live "clear from stack" button (client/components/shader-live-stack.js:68, godot/client/features/live/shader_live_stack.gd:78) posts `{clear:true}` → default transition MIX 12 frames → line 73 throws `ctx.amcp.send is not a function` → caught → 500; the layer stays on air and `liveSceneState` is not updated, so the stack row still shows the shader. With a CUT/duration 0 it dies at line 77 instead. The WO-379 smoke (`tools/smoke/smoke-wo379-shader-store-and-stack-clear.test.js`) has no `send`/fake-amcp reference, so it did not catch it. Fix: `ctx.amcp.raw(...)`.
- `RISK` src/api/routes-shader-stack.js:58-63 — `transition.type` is only upper-cased and later concatenated raw into `LOADBG … ${opts.transition} ${duration} …` (caspar/amcp-command-plan.js:53), so `"type":"MIX\r\nCLEAR 1"` injects a command (same class as the nudge finding; bounded by `/api/amcp/raw` existing). Whitelist `CUT|MIX|PUSH|WIPE|SLIDE|STING`.

## src/api/routes-shaders.js
- `OK` Read in full. Ids are validated in `shader-store` (`isValidShaderId`, `^sh-[a-z0-9][a-z0-9-]{0,62}$`) before any path join, so `decodeURIComponent(m[1])` cannot traverse; the Shadertoy id is regex-restricted before the outbound fetch.

## src/api/routes-shm-sources.js
- `OK` Read in full. Header read is bounded (128 bytes); ring names are regex-limited.

## src/api/routes-sources.js
- `OK` Read in full.

## src/api/routes-stage-mvr.js
- `RISK` src/api/routes-stage-mvr.js:28-48 — `readUpload` resolves only from busboy `error`/`close`. If the client drops the connection mid-upload nothing forwards the request's `aborted`/`error` to `bb` (`req.pipe` does not propagate errors), so the promise may never settle, the handler never answers and the already buffered `parts` (up to the 300 MB limit) stay referenced. Not reproduced (needs a POST); add `req.on('aborted'/'error')` → resolve `{error}`.
- `OK` otherwise. Ids are `[0-9a-f]{12}` (GET) or re-validated by `mvr-store.fileOf` (DELETE, `ID.test`), so no traversal.

## src/api/routes-state.js
- `RISK` src/api/routes-state.js:56-72 — the first `GET /api/state` after boot starts up to 120 `ffprobe` processes with `Promise.all` and no concurrency limit, in the process that drives playout; the WO-497 fix only stopped repeats. Cap at 3-4 concurrent probes.
- `OK` otherwise. `/api/help/*` goes through `param()` (CR/LF stripped).

## src/api/routes-streaming-channel-log.js
- `OK` Read in full.

## src/api/routes-streaming-channel-record.js
- `RISK` src/api/routes-streaming-channel-record.js:39-50 — the "already recording" check, `allocateRecordConsumerIndex` and the session write are separated by `await resolveCasparMediaDir` / `await amcp.basic.add`, and the session is only stored after the ADD succeeds. A double-click (two POSTs) passes the check twice, both get the same consumer index, the second `ADD … FILE` replaces the first consumer (first file cut short) while only the second is tracked. Mark the session `starting` synchronously before the first await.

## src/api/routes-streaming-channel-rtmp.js
- `BUG` src/api/routes-streaming-channel-rtmp.js:111 — `logWarn: (msg, ctx) => pushRtmpLog(ctx, 'warn', msg, ctx)` shadows the outer `ctx` with the callback's second argument. `buildAudioDownmixFilterChain` calls it as `logWarn(msg, { pair, channels })` (streaming/streaming-channel-ffmpeg.js:47), so `pushRtmpLog` receives `{pair, channels}` as the app context: the warning is written to that throwaway object's `_streamingChannelLogs`, `_wsBroadcast` is undefined so nothing is broadcast, and only the buffered-logger line survives. Failing case: `audioSourcePair:"7+8"` on a 4ch bus → the "falling back to 1+2" warning never reaches the stream-status log ring the UI shows. Fix: `logWarn: (msg, extra) => pushRtmpLog(ctx, 'warn', msg, extra)`.
- `RISK` src/api/routes-streaming-channel-rtmp.js:73,174 — `streamingChannelRtmp.active` is set only after the first `await ctx.amcp.raw(ADD … STREAM)` returns, so two concurrent starts both pass the guard and issue two `ADD ch-97 STREAM`; same class as the record finding.

## src/api/routes-streaming-channel-shared.js
- `QUALITY` src/api/routes-streaming-channel-shared.js:174-196 — the WO-172 T172.5 JSDoc (`@param source`, "returns 'stereo'…") sits directly above the WO-297 JSDoc and so documents `cabledAudioOutputLayoutForMain`, not `resolveSourceProgramAudioLayout` (:239) which it describes. Move it down.
