# src/api (part 1) — sweep 29.10.2026 (batch 061)

Files: 38 · lines: 6810 · findings: 1 BUG-HIGH, 8 BUG, 3 DEAD, 14 RISK, 23 QUALITY

Method notes (so the owner can judge confidence):
- Auth is applied once, globally, in `router-dispatch.js:55` (`checkHttpAuth`, WO-811), before any route runs. No per-route "missing auth" findings were raised for that reason. Live check: `GET /api/auth/status` → `enforceAuth:false`, and `:4200` listens on `0.0.0.0`, so the box is currently open on the LAN; every "authenticated admin API" caveat below only holds once enforcement is switched on.
- Route shadowing was checked mechanically: the router module was loaded read-only (363 registry routes) and every route's sample path tested against each earlier same-method route's regex. Exactly one shadow exists (router.js:461, below).
- Unused exports are NOT repeated here; they are already ratcheted in `tools/ci/unwired-exports-baseline.json` (WO-367).
- AMCP escaping helpers live in `src/caspar/amcp-utils.js` (`param`, `clipParamForPlay`, CR/LF folding). CG, play/load clip and route strings go through them; the raw-interpolating paths are listed under routes-amcp.js.

## src/api/apply-ui-selection-variables.js
- `OK` — every key set is in `ALL_UI_SELECTION_KEYS`; `setVariable` is throttled and skips unchanged values, so the clear-then-set pattern does not flicker.

## src/api/box-local-request.js
- `OK` — loopback peer + no proxy header + loopback Host/port + loopback Origin; IPv4-mapped `::ffff:127.x` handled; `Origin: null` rejected. Live consumers: system-hardware-gui.js, WO-811/822 smokes.

## src/api/companion-connection-status.js
- `RISK` src/api/companion-connection-status.js:11-23,98-113 — `GET /api/companion/connection-status?host=H&port=P&satelliteHost=…&satellitePort=…` (routes-companion.js:17 passes the raw query) makes the node `fetch('http://H:P/')` (redirects followed) and open a raw TCP socket to `satelliteHost:satellitePort`, then reports connected/status/error. Any caller can use the box as a port scanner / HTTP prober of its LAN or 127.0.0.1 services (error text distinguishes refused/timeout). The probe-with-unsaved-values behaviour is deliberate (Settings "test"), so restrict instead: allow only the saved host, or require non-loopback/private-range hosts and a port allow-list.

## src/api/companion-control-status.js
- `OK` — pure rules + snapshot builder; uses the correct `ctx.amcp.isConnected` property (contrast device-view-caspar-snapshot.js).

## src/api/device-view-apply.js
- `QUALITY` src/api/device-view-apply.js:335 — `ok: casparResult.ok && !errors.length` is `false` whenever `opts.applyCaspar === false` (the apply is skipped, `casparResult.ok` stays `false`). Failing case: `POST /api/device-view {applyPlan:{applyCaspar:false}}` → config persisted, `ok:false`. Latent: grep `applyCaspar` over client/ godot/ src/ tools/ finds no caller that sets it.
- `QUALITY` src/api/device-view-apply.js:149-165 — up to four separate `configManager.save()` calls per apply (casparServer, streamingChannel, recordOutputs, virtualCamera), each a full-file write + `change` emit, and they assign `ctx.config.*` directly instead of using `saveConfig` from device-view-crud-save.js (so no `onDeviceConfigSaved` replication hook runs from this path). One merged save would be atomic and cheaper. Also `changed` (line 145) is a pure alias of `casparServerChanged`.

## src/api/device-view-caspar-snapshot.js
- `BUG` src/api/device-view-caspar-snapshot.js:14 — fallback reads `ctx.amcp.connected`, but `AmcpClient` exposes only the getter `isConnected` (src/caspar/amcp-client.js:41; every bootstrap file uses `appCtx.amcp?.isConnected`). Failing case: `ctx._casparStatus` not yet a boolean (early boot / status object replaced) while the AMCP socket is up → `live.caspar.connected` is `false` in the Device View payload. Fix: `!!ctx.amcp?.isConnected`.

## src/api/device-view-crud-mapping.js
- `BUG` src/api/device-view-crud-mapping.js:16-18 — `seq` only increments when the generated id collides (same millisecond, practically never), yet the label is `Pixel Mapping ${seq}`. Failing case: add two pixel-mapping nodes via `{addMappingNode:true}` → both are labelled "Pixel Mapping 1" (the client only ever appends " Copy", client/lib/mapping-node-service.js:252). Fix: number by `g0.devices.filter(d => d.role === 'pixel_mapping').length + 1`, as `handleAddDestination` does for Multiview/Stream/Pixel Map.

## src/api/device-view-crud-save.js
- `OK` — single persistence path incl. replication hook. (The same "persist a patch" helper is re-implemented 4 times in host-live-*.js, see there.)

## src/api/device-view-crud.js
- `BUG` src/api/device-view-crud.js:237-248 — `handleAddEdge` saves `nextGraph` (which contains the connector rewrites from `applyDecklinkOutputOnDestinationEdge`: `ioDirection:'out'`, `outputBinding`, `bindingSource:'cable'`, `bus`, `mainIndex`) but returns and augments `res.graph`, the graph from before that step. The web client does `state.lastPayload.graph = res.graph` (client/components/device-view-cable.js:280,389). Failing case: cable a destination (`dst_in_X`) to a free DeckLink SDI port → persisted sink connector is an output bound to screen N; the reply shows it unchanged, so the port keeps its old direction/binding in the UI until the next full device-view load. Fix: return `graph: nextGraph` and call `augmentGraphWithSources(nextGraph, …)`.
- `OK` for the rest: `width/height` are coerced by `normalizeScreenDestinations` (screen-destinations.js:84-85), so the raw `Math.max(64, j.addDestination.width)` NaN case self-heals.

## src/api/device-view-decklink-wiring.js
- `RISK` src/api/device-view-decklink-wiring.js:218-229 — `try { … syncFollowerDeviceViewToCaspar … } catch { /* optional */ }` swallows every error from the follower sync, then falls through to `applyCasparConfigToDiskAndRestart(ctx)`: a follower whose sync throws restarts its own local Caspar instead of failing. Only reachable with `allowRestart:true` (below), so currently latent.
- `QUALITY` src/api/device-view-decklink-wiring.js:202-229 — the `allowRestart:true` branch (follower sync + Caspar restart) is never taken by production code: grep `allowRestart` over src/ client/ → only the definition and comments; only `tools/smoke/smoke-wo172-device-view-sync.test.js:210` and `smoke-wo303-…test.js:159` pass it (the WO-303 smoke even pins that no graph handler may). Deliberate guard, but ~12 lines of restart logic have no live caller.
- `QUALITY` src/api/device-view-decklink-wiring.js:13 — JSDoc of `clearDecklinkInputSlot` still documents a `ctx` parameter the function does not take.

## src/api/device-view-snapshot.js
- `QUALITY` src/api/device-view-snapshot.js:18 — top-level `const { listPortAudioDevices } = require('../audio/audio-devices')` is unused: `buildLiveSnapshot` re-destructures `{ listPortAudioDevices, listAudioDevices }` at line 353, shadowing it. grep: only those two references in the file.
- `RISK` src/api/device-view-snapshot.js:338 — `await getGpuConnectorInventoryAsync()` is not in a try/catch, while the sibling `getDisplayDetailsAsync()` (line 286) is. Both run xrandr; if the connector probe throws (X down, xrandr missing) `buildLiveSnapshot` rejects and `GET /api/device-view` (and every CRUD call that awaits it: addEdge, updateConnector) returns 502 instead of a snapshot with a `gpu_enum` warning.
- `QUALITY` src/api/device-view-snapshot.js:190 — `if (mode === 'pgm_only' || mode === 'pixelmap') pgmOnlyCount++; if (prvGen != null) generatedPreviewCount++` reads like one conditional; the second `if` is independent. Put on separate lines.
- `QUALITY` src/api/device-view-snapshot.js:270-273 vs 301 — one probe warning is pushed twice under different prefixes (`decklink_enum: <w>` in `resolveDecklinkHwCached`, then `decklink_log: <w>` at line 301 from the same `decklinkHw.warning`); on cache hits only the second appears.

## src/api/get-state.js
- `QUALITY` src/api/get-state.js:95 — `loadProjectScenes()` (2 × `readFileSync` + `JSON.parse` of the whole project file, per the comment at 90-92) runs on every `getState()`; `broadcastWsStateSnapshot` (line 166) calls it for every WS `state` push, so the "load once per request" saving applies to HTTP only.

## src/api/host-live-browser.js
- `RISK` src/api/host-live-browser.js:158-160 — `interactBrowserDisplaySource` moves the Firefox window to the operator monitor (`moveBrowserSourceToOperator`) and only then awaits `restartBrowserCaptureBridge`. If the bridge restart throws, the dispatcher answers 502 but the window stays on the operator screen while the capture bridge still tracks the off-screen rect → the on-air feed is empty and `stats.interacting` is true. No rollback via `returnBrowserSourceToOffscreen`.
- `QUALITY` src/api/host-live-browser.js:32-38 — `persistConfigPatch` is copy-pasted verbatim in host-live-browser.js, host-live-decklink.js:10, host-live-ndi.js:12 and host-live-webpage.js:12 (and a fifth variant is `saveConfig` in device-view-crud-save.js). One shared helper would also fix the divergence that none of them run the replication hook.

## src/api/host-live-decklink.js
- `QUALITY` src/api/host-live-decklink.js:57-71 — `playDecklinkInputNow` duplicates the `decklink` action of host-live-layer.js:37-40 (same STOP / MIXER CLEAR / PLAY DECKLINK sequence), but the STOP/CLEAR failure branch is dead logic: `continue` for STOP-404 and the implicit fall-through both ignore the error, and unlike host-live-layer it never reports them in an `errors` array. Route it through `handleHostLiveLayer`.

## src/api/host-live-layer.js
- `OK` — channel/layer/device via `posInt`, route via strict `ROUTE_RE`; no free-text reaches AMCP.

## src/api/host-live-ndi.js
- `OK` — `normalizeNdiSourceName` throws on empty name (ndi-playback.js:10) so the 400 path works; stored `ndiName` is later quoted by the AMCP layer.

## src/api/host-live-webpage.js
- `QUALITY` src/api/host-live-webpage.js:25-28 — `patchWebpageHostUrl` accepts any string while the sibling `patchBrowserDisplaySource` (host-live-browser.js:46) rejects non-http(s). Not exploitable (`resolveWebpagePlayTarget` treats a non-http string as a template basename, host-live-sources.js:159-161) but inconsistent: `file:///etc/x` silently becomes template "x".
- `QUALITY` src/api/host-live-webpage.js:5 — `require('../api/host-operator-fullscreen')` from inside `src/api/`; should be `./host-operator-fullscreen`.

## src/api/host-operator-fullscreen.js
- `RISK` src/api/host-operator-fullscreen.js:192-199 — the three commands (`PLAY`, `MIXER … FILL`, `MIXER … COMMIT`) run in sequence with no cleanup; if FILL/COMMIT throws after PLAY succeeded, the route is live on the operator channel but `_hostOperatorFullscreen` is never set and no broadcast happens, so the toggle's `activeForSource` is false and the next "toggle" re-PLAYs instead of clearing. Wrap in try/catch and `CLEAR` on failure.

## src/api/media-catalog.js
- `BUG` src/api/media-catalog.js:81-104 (+ get-state.js:68, media-snapshot-cinf.js:31) — `_mediaProbeTried` / `_mediaProbeCache` are never invalidated (grep over src/: only media-catalog.js, scene-native-fill.js and the readers touch them; nothing deletes entries on ingest/overwrite/delete/refresh), and the readers spread `…probed` AFTER `…parsed` CINF, so ffprobe data beats fresh CINF. Failing case: replace `clip.mov` (same id) with a different-length / different-resolution file (ingest upload, version restore, HAP re-encode) → `/api/media` and `getState().media` keep the OLD `durationMs`, resolution, fps, codec until the node restarts. Fix: key the cache on `id + size + mtime` or drop the entry when the media list changes / a file is written.
- `QUALITY` src/api/media-catalog.js:31 — `ctx.state?.getState?.()` deep-clones media/templates/channels/osc on every call (state-manager.js:410-419 documents this as the 43-49 ms `/api/state` stall and added `getStateShared()` for it). `getRawMediaCatalog` runs per `/api/media` and (via media-index.js) per take; use `getStateShared()` since the result is only read.

## src/api/media-index.js
- `RISK` src/api/media-index.js:12-15 — any exception in `getRawMediaCatalog` (e.g. `scanMediaRecursiveForBrowser` fs error, already swallowed inside, or a bad `ctx.state`) yields an EMPTY index, so `missingMediaInScene` then reports every clip of the scene as missing and the take reply warns for all of them. A failed lookup should return "unknown" (no `missingMedia` field), not "everything missing".

## src/api/operator-helper-icon.js
- `OK` — path safety verified: bare theme names must match `[A-Za-z0-9][A-Za-z0-9._+-]*` with no `..`; absolute `Icon=` values are normalised and must sit under the icon roots; the action only selects a catalog entry. (Up to ~290 `statSync` per uncached icon, acceptable.)

## src/api/response.js
- `RISK` src/api/response.js:9-18 — `parseBody` returns `{}` for malformed JSON, and 161 `parseBody(` call sites in src/api rely on it (only 8 use `parseBodyStrict`). For routes whose fields default to a destructive value this turns a client bug into an action; see routes-amcp.js `/api/clear`. Default new/mutating routes to `parseBodyStrict` (400 on bad JSON).

## src/api/route-registry.js
- `RISK` src/api/route-registry.js:71 — the `requireCaspar` gate is `!ctx.amcp`, but `appCtx.amcp` is assigned once at boot (index.js:282) and only nulled at shutdown (bootstrap/shutdown.js:103). With Caspar down it is still a live `AmcpClient`, so the 503 "Caspar not connected" never fires; the call proceeds and `_send` rejects with `Not connected` (src/caspar/amcp-client-transport.js:185), which router-dispatch turns into a 502. Every `{requireCaspar:true}` registration in router.js (≈60) is effectively `false`. Use `ctx.amcp?.isConnected` (and decide per route whether offline-mode counts).

## src/api/router-dispatch.js
- `QUALITY` src/api/router-dispatch.js:97-99,135-138 — every exception from a handler becomes HTTP 502 (Bad Gateway) with the raw message, including plain TypeErrors and validation failures raised as `throw`. 5xx-for-client-error hides real server faults from monitoring and makes retries ambiguous; use 400 for validation errors and 500 for bugs, 502 only for upstream (Caspar/peer) failures.
- `OK` for auth ordering: `checkHttpAuth` runs before `/api/selection`, show-timers, shm, modules and plugins, i.e. before every handler.

## src/api/router.js
- `DEAD` src/api/router.js:461 — `POST /api/led-test-card/*` (`requireCaspar:true`) is shadowed by `POST /api/led-test-card/:op` registered earlier at router.js:167 (confirmed with a mechanical shadow check of all 363 routes; this is the only shadow), and its handler `routesLedTestCard.handlePost` returns `null` for anything but the bare `/api/led-test-card` (routes-led-test-card.js:41), which is served by the legacy fallback in router-dispatch.js. grep of client/ godot/client for `led-test-card` finds only `/settings`, `/master`, `/channel`. Remove the line.
- `QUALITY` src/api/router.js:378 — `GET /api/cg-thumb/*` does not pass `If-None-Match` (compare router.js:385 for `/api/thumbnail/*`, which does). routes-cg-thumb.js:31 only honours `query.etag/ifNoneMatch`, which no client sends, so the 304 branch is unreachable and every `max-age=60` revalidation re-sends the PNG.
- `QUALITY` src/api/router.js:422,451,487-490 — several statements per line joined by `;` (`routes.post(...); require('./routes-pgm-layer').register(routes)`, four `register()` calls on one line with trailing WO comments). The file sits at exactly 500 lines (CI limit), which is why; move the `register()` calls into one `registerLateRoutes(routes)` helper.

## src/api/routes-about.js
- `OK` — static credits + package.json/COPYRIGHT read; smoke-pinned (WO-616).

## src/api/routes-amcp.js
- `BUG` src/api/routes-amcp.js:74-80,241-248 — `channel` defaults to `1` and, with `parseBody` mapping malformed/empty JSON to `{}`, `POST /api/clear` with body `{` (or no body) takes the "layer omitted" branch and runs `clearCasparChannel(amcp, 1, ctx)`: PGM channel 1 is blanked on air. The same default-to-channel-1 applies to stop/pause/resume. Fix: require an explicit integer `channel` (400 otherwise) for destructive verbs, and use `parseBodyStrict`.
- `RISK` src/api/routes-amcp.js:254-297 — `/api/call` (`fn`, `params`), `/api/add` (`consumer`, `params`), `/api/set` (`variable`, `value`), `/api/log/level`, `/api/lock` hand strings to `amcp.basic.*` (amcp-basic.js:130-148,197-202) which interpolate them unescaped, unlike clip/CG/route strings that go through `param()` (CR/LF folded, quotes escaped). An embedded `\r\n` in `value` or `fn` ends the AMCP line and starts a new command (tcp-client.js:134 only appends CRLF). Not a privilege escalation (`/api/amcp/raw`, `/api/kill`, `/api/restart` are open to the same caller) but it makes client bugs and malformed values execute extra commands; reject control characters at the route.
- `RISK` src/api/routes-amcp.js:132-135 — `raw-batch` sends lines one by one and calls `playbackTracker.recordAmcpLines` only after the loop; if line k fails, lines 1..k-1 are already executed in Caspar but never recorded, so the playback matrix drifts. Record each line (or the successful prefix) in a `finally`.

## src/api/routes-artnet.js
- `DEAD` src/api/routes-artnet.js:8 `handleGetArtnetInput` / `GET /api/artnet/input` — no caller: grep `/api/artnet/input` over client/ godot/client/ src/ tools/ scripts/ test/ → only the route comment and docs (docs/wiki/api/contract/http.md:16 pins it as a contract entry). Documented as "client debugging"; keep only if the contract wants it.

## src/api/routes-audio-cross-screen.js
- `OK` — validation delegated to the single shared client/lib module; `sources` capped at 200; AMCP composed only via host-live-layer (strict route regex).

## src/api/routes-audio-mixer.js
- `OK` — 400 on non-boolean `muted`, channel/layer validated, strips keyed through `isMixerKey`; the 503 for missing `ctx.amcp` is also unreachable in practice (see route-registry.js), harmless here.

## src/api/routes-audio-monitor-pair.js
- `OK` — `pair` validated against `MONITOR_PAIRS`; `applyMonitorPair` always returns a `status`.

## src/api/routes-audio.js
- `BUG` src/api/routes-audio.js:224-233 — `POST /api/audio/default-device` does `parseInt(b.card)` / `parseInt(b.device)` and never checks `Number.isFinite`. Failing case: `{"card":"x","device":0}` → `setDefaultAlsaDevice(NaN, 0)` writes `defaults.pcm.card NaN` / `defaults.ctl.card NaN` to `~/.asoundrc` (audio-devices.js:222,231), breaking ALSA default-device resolution for the user until fixed by hand. Fix: 400 unless both are integers ≥ 0.
- `BUG` src/api/routes-audio.js:349-353 — `/api/audio/solo` plays `layer0 + i` for every entry of `solos`/`keys` with no cap at `soloLayerCount` (default 8, max 16, audio-preview.js:27), but later clears only `layer0 .. maxLayers` (337-340, 355-359). Failing case: 9 soloed strips on a default setup → layer 9 of the monitor channel gets a `route://` PLAY outside the reserved range; clearing solos (`solos:[]`) or soloing fewer never `CLEAR`s it, so that source stays audible on the headphones. Fix: `solos.slice(0, ap.soloLayerCount)` (and report truncation) or clear up to a fixed upper bound.
- `DEAD` src/api/routes-audio.js:205-214 — `POST /api/audio/route` always answers 501 ("not exposed via AMCP in this build"). grep `/api/audio/route` over client/ godot/client/ src/ tools/ → no caller; only docs list it. The router.js:236 registration and this branch can go (update docs/wiki/api/contract/http.md:36).
- `RISK` src/api/routes-audio.js:182-198 — `/api/audio/volume` forwards `volume`, `duration`, `channel`, `layer` unvalidated to `mixerVolume`/`mixerMastervolume`, which interpolate `String(volume)` and `duration` raw (amcp-mixer.js:234-238,243-246): `{"volume":"1\r\nKILL"}` injects an AMCP line (same note as routes-amcp.js). It also stores `setGain(ctx, key, undefined)` as 0 when a keyed call omits `volume` (mixer-state.js:69), silently zeroing the strip's saved gain.
- `QUALITY` src/api/routes-audio.js:282-288 — `pgm_N` resolves via `map.programCh(n)`, which falls back to `programChannels[0]` for an out-of-range N (routing-map.js:359,421), so `source:"pgm_9"` on a 2-screen box answers 200 and monitors PGM 1 instead of 400 "Invalid source".

## src/api/routes-auth.js
- `BUG` src/api/routes-auth.js:22 (root cause src/server/auth.js `parseCookies`, `decodeURIComponent` without try/catch) — a malformed `highascg_session` cookie makes `GET /api/auth/status` throw. Verified live (read-only): `curl -H 'Cookie: highascg_session=%E0%A4%A' /api/auth/status` → `502 {"error":"URI malformed"}`, even with enforcement off. With enforcement on, `checkHttpAuth` (router-dispatch.js:55, outside any try) throws the same way for ANY route, so a garbage cookie returns 502 instead of 401 and the sign-in redirect (line 57) is never reached. Fix: try/catch in `parseCookies` (treat as absent).
- `RISK` src/api/routes-auth.js:52-60 — `POST /api/auth/login` is public and has no attempt throttling or lockout; the shared "password" may be human-chosen (accepted as `token` or `password`). Combined with `Max-Age=30d` and the cookie value being the password itself (auth.js `sessionCookieHeader(expected)`), logout (line 70) only clears the browser's copy and cannot revoke a copied cookie.

## src/api/routes-caspar-config.js
- `BUG-HIGH` src/api/routes-caspar-config.js:316-328 (+56-63, 148) — arbitrary file write. `POST /api/caspar-config/apply` accepts `path` (→ `casparServer.configPath`, absolute paths unrestricted) and `xml` (any string, written verbatim: `enforceScreenConsumerPolicy("ssh-ed25519 AAAA…")` returns it unchanged, verified with node). `atomicWriteFile` then writes `<path>.tmp` and renames it over the target as the node user, and the path is persisted into config (line 166). Failing case: `{"path":"/home/casparcg/.ssh/authorized_keys","xml":"ssh-ed25519 AAAA… attacker"}` → the key file is replaced → shell access to the box; or `~/.bashrc`, a systemd user unit, `run.sh`. Step 1 of `applyFullServerConfig` (the write) runs before any gate (full-config-apply.js:102). Today `enforceAuth:false` and the server listens on 0.0.0.0:4200, so this is reachable by anyone on the LAN; even with auth on it should not be an arbitrary-path write. Fix: ignore body `path` or require it to resolve under the Caspar config directory, and only accept `.config` basenames; same check for `casparServer.configPath` coming through `/api/settings`.
- `RISK` src/api/routes-caspar-config.js:184-212 — no mutual exclusion around the whole apply: `casparXmlWriteChain` serialises only the file write, not `applyFullServerConfig` (write → apply-layout → nodm/xrandr → Caspar restart). Two overlapping `POST /api/caspar-config/apply` (double click, two clients) run two full restarts concurrently, and the first one to finish `delete ctx._fullApplyInProgress` while the second is still running, re-enabling the AMCP watchdog (caspar-amcp-watchdog.js:75) mid-restart. Add an in-flight promise and return 409 for the second call.
- `QUALITY` src/api/routes-caspar-config.js:300-320 — body `casparServer`, `audioRouting` and `path` are merged into live `ctx.config` BEFORE the write is attempted. Failing case: apply with an unwritable `path` → 403 reply, but `ctx.config.casparServer.configPath` stays at the bad path in memory (and `resolveCasparConfigWritePath` keeps using it) until some other save overwrites `ctx.config`. Build the next config on a copy and commit only after the write succeeds.
- `QUALITY` src/api/routes-caspar-config.js:65-70 — an orphaned JSDoc block (`Write generated casparcg.config XML…`) sits above the unrelated mutex comment instead of above `writeCasparConfigToDisk`; and line 174 `catch (_) {}` swallows a failed config save after a successful write with no log.

## src/api/routes-cg-thumb.js
- `RISK` src/api/routes-cg-thumb.js:51-84 — `POST /api/cg-thumb/render` hashes the whole request (`cgData`, `width`, `height`, template id; cg-look-thumb-cache.js:48-58) and writes one PNG per distinct hash to `data/cg-look-thumbs`; the viewport is fixed (cg-look-thumb-render.js:355) so `width/height` are pure cache-key noise, and there is no eviction anywhere (grep prune/evict/unlink in the cache module: none). A client looping with a changing `cgData` field fills the disk and spawns a headless render each time. Normalise width/height to the render size, cap `cgData` size, and prune by count/age.
- `QUALITY` src/api/routes-cg-thumb.js:54-62 — `try { parseBody(body) } catch` is dead: `parseBody` never throws (response.js:9-18).
- `QUALITY` src/api/routes-cg-thumb.js:31 — ETag/304 branch unreachable from browsers, see router.js:378.

## src/api/routes-cg.js
- `OK` — template, data, label and method go through `param()` in amcp-cg.js; unknown verbs 400.

## src/api/routes-client-prefs.js
- `QUALITY` src/api/routes-client-prefs.js:58 — `value === undefined ? null` means a POST that merely forgets `value` is treated as "remove this pref" (200 `{ok:true}`) instead of 400; header comment says only an explicit `null` removes.

## src/api/routes-cluster.js
- `QUALITY` src/api/routes-cluster.js:275-279 — `GET /api/cluster` awaits `c.poll()` (a network round-trip to every linked server, with their timeouts) on every call, and the first call also constructs and starts the whole cluster service as a side effect of a GET. The WS `cluster:peers` push already carries the snapshot; the GET could return the cached snapshot and let the poller refresh.
- `OK` for the rest — signed endpoints (`/cluster/call`, `/cluster/ssh-key`, `/cluster/master`) verify the device-key signature in the handler (cluster-media.js:32-46, cluster-call.js); `/api/cluster/call` is the only public path (auth.js `isPublicApiPath`); no shadowing of any `/api/cluster/*` route.
