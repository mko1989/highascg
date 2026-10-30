# src/config (part 2) — sweep 29.10.2026 (batch 078)

Files: 42 · lines: 6875 · findings: 0 BUG-HIGH, 9 BUG, 9 DEAD, 13 RISK, 23 QUALITY (12 files OK)

Method: every file read in full; every `BUG` below was reproduced by calling the real module under `NODE_TEST_CONTEXT=1` (read-only, no config write, no AMCP). Dead-code claims were grepped over `src client index.js godot scripts tools` (`grep -rnw`, no `rg` on the box); "smoke-only" means the only other reference is under `tools/smoke/`.

## src/config/device-graph-destination-wiring.js
- `RISK` src/config/device-graph-destination-wiring.js:182-185 — every multiview destination `n` falls back to the single global `merged.multiview_decklink_device` (`merged[multiview_n_decklink_device] || merged.multiview_decklink_device`). Nothing in `src` ever writes a `multiview_N_decklink_device` key (grep: only the global is written, `build-caspar-generator-config-decklink.js:185-225`, `device-view-apply.js:112`, `device-view-crud.js:357`). Case: two multiview destinations, MV1 cabled to SDI 3 (global = 3), MV2 GPU-only → MV2 gets `hasDeck = true` and profile `screen_decklink`, so the generator is told to open DeckLink 3 twice. `config-generator-consumer-attach.js:72` has the same fallback, so this is a design gap rather than a one-file slip. Fix: only fall back to the global for `n === 1`.

## src/config/device-graph-edges.js
- `OK`

## src/config/device-graph-output-mapping.js
- `OK` (the header comment at :65-78 says host-channel destinations are "never persisted into screenDestinations"; they are — see the `screen-destinations.js` BUG at :175 — but the fallback branch handles both cases correctly).

## src/config/device-graph-suggest.js
- `BUG` src/config/device-graph-suggest.js:138 / :151 — DeckLink connector ids are built from the *slot / screen number* (`dlsdi_${slot}`) but de-duplicated by *device index* (`seenDecklinkIndices`). Input slot N and output screen N therefore collide whenever they sit on different devices. Failing case: `live.decklink = { detected:true, inputs:[{slot:2,device:2}], screenOutputs:[{screen:2,device:3}] }` → `suggestConnectorsAndDevicesFromLive` returns two connectors, both `id:'dlsdi_2'` (`externalRef` '2' and '3', both labelled "SDI 2"). `mergeHardwareSync` then collapses them in its `byId` Map, silently dropping one SDI port (and any cable on it). Fix: derive the id from the device index, or de-dup on `id` as well.
- `QUALITY` src/config/device-graph-suggest.js:5 — `slug` is imported from `device-graph-constants` and never called (only `so.slug` / `ro.slug` properties exist). Also the `kind` parameter of `addDecklinkPort` (:116) is never read.

## src/config/device-graph.js
- `OK` (pure facade; all exports referenced).

## src/config/device-snapshot.js
- `RISK` src/config/device-snapshot.js:150-153 vs :223-228 and :27-36 — export and dry-run diff only look at the screen slice of `casparServer` (`pickCasparServerSnapshotSlice`: `screen_count`, `transitionModel`, `screen_1..4_*`), but apply merges *every* key of `settingsPatches.casparServer` (`{ ...defaults.casparServer, ...next.casparServer, ...sp.casparServer }`). Case: `POST /api/device-snapshot` with `payload.settingsPatches.casparServer = { ip:'10.0.0.9', configPath:'/x' }` → `diffTopLevelKeys` reports nothing for casparServer, `listSectionsTouched` says "(screen-related)", yet the live Caspar host/config path is overwritten. Fix: run `pickCasparServerSnapshotSlice(sp.casparServer)` before merging.
- `QUALITY` src/config/device-snapshot.js:79-85 — `Buffer.from(b64, 'base64')` never throws on bad input (it decodes what it can), so the `catch` / "invalid base64 in visual.data" branch is unreachable; garbage passes validation. It also allocates up to 16 MiB just to measure size (length can be computed from the string).
- `QUALITY` src/config/device-snapshot.js:11-13 — a `config/` module requires `../api/routes-caspar-config` and `../api/settings-os` (inverted layering; pulls the API route graph into config load).
- `DEAD` src/config/device-snapshot.js:284-291 — exports `MAX_VISUAL_DECODED_BYTES`, `validateVisualBase64`, `pickCasparServerSnapshotSlice` are used only inside the file. grep: `grep -rnw "validateVisualBase64\|pickCasparServerSnapshotSlice\|MAX_VISUAL_DECODED_BYTES" src client tools index.js` → only this file. (Unexport, low value.)

## src/config/editor-defaults.js
- `OK` (defaults identical to `defaults.editorDefaults`, verified by `JSON.stringify` equality).

## src/config/extra-live-source-enrich.js
- `RISK` src/config/extra-live-source-enrich.js:49-79 `findPublisherLayerFromProject(ctx, channel, layer)` — ignores both `ctx` and `channel`; it returns the first scene in the project that has *any* layer with `layerNumber === layer`. Case: two looks, both with a layer 2, different fills; a `routeType:'layer'` source `route://5-2` fed by the second look gets its `fill`/`resolution` from the first look. Wrong thumbnail resolution label; no crash.
- `QUALITY` src/config/extra-live-source-enrich.js:52 / :83-84 / :150 / :173 — `enrichExtraLiveSources` runs per item on `GET /api/state`. Each `routeType:'layer'` item without a fill calls `loadFullProject()` (synchronous project-file + autosave-file reads and possible `migrateLegacySingleProject`), and every item calls `buildChannelMap(ctx)` (full `getChannelMap`) in `pickChannelResolution`, the DeckLink branch calls it a second time. N items → N full channel-map builds and N project reads per poll. Fix: build the channel map and project once in `enrichExtraLiveSources` and pass them down.
- `QUALITY` src/config/extra-live-source-enrich.js:10 — `parseRouteChannelLayer` is the third copy of the same `route://N[-L]` parser (`host-live-sources.js:121 parseRouteValue`, `live-source-route-heal.js:430 parseRouteValue`), with different layer defaults (`null` here, `HOST_LAYER` in host-live-sources).
- `DEAD` src/config/extra-live-source-enrich.js:190 `resolveLiveSourcePrintTarget` — smoke-only. grep: `grep -rnw resolveLiveSourcePrintTarget src client godot tools` → definition, export and `tools/smoke/smoke-extra-live-source-decklink.test.js` only (client/assets/map-data.json is generated). No production caller.

## src/config/factory-defaults-manifest.js
- `OK` (single consumer `tools/eggs/live-usb/write-iso-default-config.js`; constants consumed by the verifier via `node -e`).

## src/config/factory-starter.js
- `OK` (`buildFactoryModularConfig` deep-clones defaults; the other exports are used by `tools/runtime/clean-slate-reset.js` and `tools/eggs/live-usb/write-iso-default-config.js`).

## src/config/host-live-sources-browser-runtime.js
- `OK`

## src/config/host-live-sources-caspar.js
- `QUALITY` src/config/host-live-sources-caspar.js:4 — `isHostLiveSource` imported, never used.

## src/config/host-live-sources-migrate.js
- `BUG` src/config/host-live-sources-migrate.js:73-97 (`migrateExtraLiveSourcesList`, loop at :79-107) — every legacy NDI / webpage source is normalised against the *unchanged* `config`, so `suggestNextHostChannel(config)` returns the same free channel for each of them. Failing case: `extraLiveSources:[{type:'ndi',value:'ndi://a/x'},{type:'ndi',value:'ndi://b/y'}]` (no `hostChannel`), one PGM destination → `migrateHostLiveSourcesConfig` returns `[{sourceId:'ndi_a_x',hostChannel:3,value:'route://3-1'},{sourceId:'ndi_b_y',hostChannel:3,value:'route://3-1'}]`. Two sources share Caspar channel 3 (the generator emits one channel block, the second PLAY clobbers the first). Runs at config load for v0 configs (`config-manager.js:380`) and on every `GET /api/state` view (`get-state.js:103`, display only). Fix: after each normalisation, rebuild a working config whose `extraLiveSources` includes the already-migrated entries before calling `suggestNextHostChannel` for the next.

## src/config/host-live-sources-setup.js
- `RISK` src/config/host-live-sources-setup.js:64 — success is decided by `failed.some(f => f.sourceId === entry.sourceId)`. Two entries with the same `sourceId` (or both `undefined`) make a good source count as failed because the other one failed; `normalizeNdiHostSource` derives `sourceId` from the display name only (`ndi_${slugSourceId(display)}`, 48 chars, punctuation-folded), so two NDI sources whose names differ only in punctuation share an id. Fix: track failure per loop iteration (boolean), not by id.
- `QUALITY` src/config/host-live-sources-setup.js:70 vs :75 vs :36 — `self.log(...)` is called unguarded at :70 while the following block guards with `typeof self.log === 'function'` and the monitor-skip branch uses `self.log?.(`.

## src/config/host-live-sources.js
- `BUG` src/config/host-live-sources.js:356-358 — `amcpCommandsForHostLiveSource` builds `PLAY ${ch}-${layer} [HTML] ${playArg} LOOP` by raw interpolation; it does not use the repo's `param()` / CR-LF stripping (`src/caspar/amcp-utils.js:12-22`), and `amcp.raw()` does not sanitise either (`amcp-client-commands.js:109`). Failing cases (run on the real module): (a) `templateOrUrl:'my page.html'` → `PLAY 5-1 [HTML] my page LOOP` (Caspar tokenises `page` as a parameter; wrong template/URL); (b) `templateOrUrl:'http://x.test/a\r\nRESTART\r\nPLAY 1-1 foo'` → the string is emitted as three AMCP lines, including `RESTART`. (b) needs an authenticated API caller, who can already use `/api/amcp/raw-batch`, so it is not an escalation, but (a) is an everyday failure. Fix: `[HTML] ${param(playArg)}` and strip CR/LF at `resolveWebpagePlayTarget`.
- `QUALITY` src/config/host-live-sources.js:4 — `getModeDimensions` imported, never used.

## src/config/live-audio-input.js
- `DEAD` src/config/live-audio-input.js:362 `listLiveAudioPgmProtectedLayers` — smoke-only. grep: `grep -rnw listLiveAudioPgmProtectedLayers src client index.js scripts` → definition and export; 6 hits under `tools/smoke/`. Its JSDoc (:360) also promises a `screen` field that is never returned.
- `QUALITY` src/config/live-audio-input.js:24-25 — both branches return `` `alsa://${s}` ``; the `hw:`/`plughw:`/`default` test is dead logic.
- `QUALITY` src/config/live-audio-input.js:14 vs routing-map.js:296 — the ALSA host layer 10 is defined twice (`LIVE_AUDIO_LAYER_BASE` and `LIVE_AUDIO_INPUT_LAYER`); and the `listConfiguredLiveAudioSlots` return JSDoc (:258) omits the `channel` field that all callers read.

## src/config/live-source-route-heal.js
- `QUALITY` src/config/live-source-route-heal.js:532-534 — `if (knownRouteChannels(map).has(parsed.channel)) return null; return null`: both paths return null, so `knownRouteChannels` (exported, used nowhere else: `grep -rnw knownRouteChannels src tools client` → this file only) has no effect.

## src/config/machine-identity.js
- `QUALITY` src/config/machine-identity.js:6-25 — doc says "Prefer replication.selfId, then general.machineId, then hostname", but the code returns the hardware-identity hostname first (`getHardwareIdentity` always yields a hostname), so the `replication.selfId` / `general.machineId` branches are unreachable on a real box. The smoke test `tools/smoke/smoke-private-volume-sync.js:15` (`getMachineId prefers replication.selfId`) pins the old order; it is not in `tools/ci/offline-test-files.js`, so CI does not notice that it would fail. Decide which order is intended and fix doc or code plus test.

## src/config/monitor-bus.js
- `OK`

## src/config/multiview-helpers.js
- `OK`

## src/config/ndi-playback.js
- `BUG` src/config/ndi-playback.js:66 / :69-70 — `buildNdiHostPlayCommands` interpolates the NDI name into the `PLAY` line without stripping CR/LF (`escapeAmcpQuotedString` only escapes `\` and `"`). Failing case: `ndiName:'ndi://m/"S"\r\nKILL'` → `["PLAY 6-1 ndi://m/\"S\"\r\nKILL","MIXER 6 COMMIT"]` (two AMCP commands in one `raw()` line). Same trust level as the `host-live-sources.js` finding; fix by folding CR/LF to a space before building the line.

## src/config/network-settings.js
- `QUALITY` src/config/network-settings.js:56 — second `isValidIpv4` implementation (this one rejects leading zeros, `screen-destinations.js:24` accepts `001.002.003.004`). One shared helper would remove the divergence.

## src/config/output-source-name.js
- `OK`

## src/config/pixel-mapping-config.js
- `QUALITY` src/config/pixel-mapping-config.js:138 — `if (feed?.kind !== 'program') continue` is the last statement of the loop body (no-op); the preceding comment at :137 describes behaviour that lives elsewhere.

## src/config/portaudio-output.js
- `OK`

## src/config/program-audio-layouts.js
- `DEAD` src/config/program-audio-layouts.js:108-111 `resolveCabledLayoutsByMain` — `@deprecated` alias with no caller. grep: `grep -rnw resolveCabledLayoutsByMain src client tools index.js` → definition and export only.
- `QUALITY` src/config/program-audio-layouts.js:29 — `edges.find((e) => String(e.sinkId) === id)` throws on a `null` edge element (the sibling code guards with `e?.`).

## src/config/project-fps.js
- `RISK` src/config/project-fps.js:74-77 — `videoModeMatchesProjectFps` uses a 0.06 Hz tolerance, which lumps 23.98/24, 29.97/30 and 59.94/60. `applyProjectFpsToInheritedOutputs` (:113) therefore treats a deliberately chosen `1080p2400` as "still inherits" when the project goes 23.98 → 25 and rewrites it (and `screenDestinations[].width/height/fps`). Only matters for boxes that mix 24 and 23.98 on purpose.

## src/config/replication-config.js
- `QUALITY` src/config/replication-config.js:101 (and :99-110) — hard-coded fallbacks disagree with `defaults-replication.js`: `sampleIntervalMs` falls back to `2000` when the stored value is `0`/garbage, but the default is `5000` (defaults-replication.js:36); likewise `peer.port`/`connectTimeoutMs` fall back to literals. A broken value and an absent value therefore yield different results. Use `dps.*` in the `||` fallback too.

## src/config/routing-map.js
- `BUG` src/config/routing-map.js:470-483 `resolveStreamingChannelRouteForRole` — still carries its own copy of the `program_N` / `preview_N` regexes and does not know WO-378's `channel_<N>` vocabulary (`resolveStreamOutputCasparChannel` at :174 does). Failing cases (run): `streamingChannel:{enabled:true, videoSource:'channel_5', dedicatedOutputChannel:true}` → `getChannelMap(...).streamingCh` is allocated but `resolveStreamingChannelRouteForRole(cfg,'video')` returns `route://1` (program 1); `videoSource:'preview_1'` on a `pgm_only` screen → returns `route://null`. `setupAllRouting` (routing-setup.js:209-216) then PLAYs `route://1` on the dedicated streaming channel, so a stream cabled from a host channel (`applyStreamRecordMappingsFromGraph` writes exactly `channel_<N>`) streams program 1. `streaming-channel-status.js:44-45` reports the same wrong route. Fix: call `resolveOutputSourceToChannel` and return null (not `route://null`) when it fails.
- `DEAD` src/config/routing-map.js:205 `switcherBusMode = false` — constant. The 3-channel branch (:230-244), both `previewCh` switcher blocks (:363-369, :425-431), `playbackChannels`/`transitionModel` ternaries (:437, :444) and the whole `activeBuses` parameter are unreachable. grep: no caller can set it (`getChannelMap(cfg, ctx.switcherOutputBusByChannel)` passes a map that is only ever filled by the equally dead block in routing-setup.js:150-168).
- `QUALITY` src/config/routing-map.js:357-373 vs :421-435 — `previewCh` closure is duplicated verbatim (`mapSoFar` and `result`); `programCh` likewise. Unused locals: `inputsEnabled` (:197, the result recomputes the expression at :417), final `nextCh = hostMerge.nextCh` (:405).
- `QUALITY` src/config/routing-map.js:19-30 — the JSDoc for `isMainBusDestinationMode` sits above `inferGraphMainUsage` with an unrelated comment and `require` in between.
- `QUALITY` src/config/routing-map.js:56 — `routingDestinationsFromConfig(config)` is re-run (and every destination re-normalised) inside the edge loop of `inferGraphMainUsage`; `getChannelMap` is called from many hot paths (see extra-live-source-enrich). Hoist out of the loop and consider caching per config object.

## src/config/routing-setup-decklink-inputs.js
- `RISK` src/config/routing-setup-decklink-inputs.js:30-34 — the "input vs output device" conflict set only contains `screen_N_decklink_device` and the global `multiview_decklink_device`. DeckLink devices claimed as key outputs (`screen_N_decklink_key_device`, `multiview_decklink_key_device`) or as pixel-map tile devices (`screen_N_decklink_tiles[].device`) are not included, although `screen-layout-guard.js` and `decklink-config-validate.js` know about them. Case: input slot 2 on device 2 while `screen_1_decklink_key_device = 2` → `PLAY 5-2 DECKLINK 2` is attempted and fails 404 every 20 s ("source powered off / not cabled" message, wrong diagnosis). It also reads `self.config` (app config), not the graph-derived merged config the generator uses, so graph-only outputs are invisible here.

## src/config/routing-setup-live-inputs.js
- `QUALITY` src/config/routing-setup-live-inputs.js:137 — log says "routed ${slots.length} input(s) to PGM channel(s)", but `slots` counts every configured slot including those with no `pgmChannels`; use the number of distinct slots in `routes`.

## src/config/routing-setup.js
- `DEAD` src/config/routing-setup.js:52 `setupMultiview` — no caller. grep: `grep -rnw setupMultiview src client index.js tools` → definition, this module's export and the `routing.js` re-export (which itself has no consumer); multiview apply goes through `engine/multiview-reapply`.
- `DEAD` src/config/routing-setup.js:150-168 — `if (map.switcherBusMode && self.amcp)` can never be true (see routing-map.js:205); the block and its `findSelfRouteViolation` import (:17) are dead.
- `QUALITY` src/config/routing-setup.js:219 / :360-364 — `setupMappingChannels` is an empty async function that is called once and exported.

## src/config/routing.js
- `DEAD` src/config/routing.js:21-45 — of 27 re-exports only `getChannelMap`, `resolveMainScreenCount`, `readCasparSetting`, `resolveDecklinkInputDeviceIndex`, `resolveStreamingChannelRoute(ForRole)`, `setupAllRouting`, `setupInputsChannel` have consumers (`grep -rn "config/routing')" src index.js tools` plus name greps). Dead: `routeToLayer` (defined here, no caller anywhere), `getRouteString`, `setupLiveAudioInputs`, `setupV4l2Inputs`, `setupLiveAudioPgmRoutes`, `setupAudioPreviewBus`, `setupPreviewChannel`, `setupMultiview`, `normalizeAudioPreview`, `resolveAudioPreviewChannel`, `listConfiguredLiveAudioSlots`, `resolveLiveAudioRouteString`, `normalizeAlsaCaptureUri`, `ensureLiveAudioRouting`, `ensureV4l2InputRouting`, `listConfiguredV4l2Slots` (all callers import `routing-setup` / the source module directly). The facade also eagerly loads `audio-preview`, `live-audio-input`, `capture/v4l2-input-config` for nothing.

## src/config/rtmp-output.js
- `RISK` src/config/rtmp-output.js:45-55 — `buildRtmpFfmpegConsumersForChannel` writes the full ingest URL including the stream key (`getEffectiveRtmpDestinationUrl`) into `<args>` of the generated `casparcg.config`. The key therefore sits in plaintext in a file that is also copied into project bundles / ISO templates / stick restores (see `screen-consumer-policy.js` header). Not verified whether `GET /api/caspar-config/*` or config-compare redacts `<args>`; WO-261 moved the *new* stream outputs' credentials out of config, this legacy `rtmp.destinations[]` path was not.
- `QUALITY` src/config/rtmp-output.js:45 vs :94 vs defaults — bitrate floor is 200 in the consumer builder and 100 in `normalizeRtmpConfig`; the consumer's own fallback is 2500 while `defaults.rtmp.destinations[0].videoBitrateKbps` is 4500. The builder also never passes `fps` (so `-g:v` is computed for 50 fps: 100 frames = 4 s GOP on a 25 fps channel) or `programLayout`, and the stored `videoCodec` field is never read.

## src/config/rtmp-url.js
- `OK`

## src/config/screen-consumer-policy.js
- `BUG` src/config/screen-consumer-policy.js:28-31 / :47-51 — `forceTag` matches commented-out tags *inside* a `<screen>` block, so the policy is not applied. Failing case: `<screen><device>1</device><!-- <vsync>true</vsync> --></screen>` → output keeps `<!-- <vsync>false</vsync> -->` (rewritten inside the comment) and no live `<vsync>` line is inserted, because `block.match(re)` is truthy. The header promises "everything outside `<screen>` byte-identical and the policy forced on every consumer". Impact is small only while Caspar's own vsync default is off. Fix: strip/skip comments inside the block before matching (e.g. split the block on `<!--…-->` like the outer regex does).

## src/config/screen-consumer-port-resolve.js
- `RISK` src/config/screen-consumer-port-resolve.js:58-60 — `physicalPortIndexFromGpuConnector` clamps to 1..4, so `gpu_p4`, `gpu_p5`, … all map to port 4 and would stamp their flags onto `screen_4_*`. Fine on today's 4-port cards, silent mis-assignment otherwise.

## src/config/screen-destinations.js
- `BUG` src/config/screen-destinations.js:294-303 `destinationAudioLayoutsByMain` — skips `multiview` and `stream` but not `operator_gui` (or `host_channel`), whose `mainScreenIndex` is only a placement hint (always 0). Last writer wins, so list order decides the program bus layout. Failing case (run): `[{id:'p',mode:'pgm_prv',mainScreenIndex:0,audioLayout:'8ch'},{id:'g',mode:'operator_gui'}]` → `{0:'stereo'}`; with the operator GUI listed first (today's box, `config/screen_destinations.json`) it happens to work. Delete/re-add the operator GUI destination and screen 1's 8ch PGM bus silently becomes stereo in the generated channel layout (`program-audio-layouts.js` re-exports this function). Fix: `if (!isMainBusDestinationMode(mode)) continue`.
- `BUG` src/config/screen-destinations.js:175-178 `isMainBusDestinationMode` — returns true for `host_channel`. `device-view-crud.js:37-60` *persists* host_channel destinations (`mainScreenIndex:0`), so they claim a PGM/PRV slot. Failing cases (run through `getChannelMap`): only destination `[{mode:'host_channel',…}]` → `screenCount 1`, `programChannels [1]`, `previewChannels [2]` (a phantom PGM+PRV pair for a box with no screen); `[host_channel, pgm_only@0]` → `previewChannels [2]` for a PGM-only screen (`resolvePreviewEnabledByMain` picks the host row first), whereas `[pgm_only, host_channel]` gives `[null]`. Result depends on destination order. Fix: exclude `host_channel` in `isMainBusDestinationMode` (and in `compactMainScreenIndices`, which uses it).
- `RISK` src/config/screen-destinations.js:279-287 `routingDestinationsFromConfig` — maps through `normalizeDestination` but, unlike `normalizeScreenDestinations` (:241), does not call `compactMainScreenIndices`. Channel math (`resolveMainScreenCount`, `getChannelMap`) and `destinationsFromConfig` consumers (wiring, snapshot, state) can therefore disagree: `[operator_gui, pgm_prv@1, pgm_only@2]` → `resolveMainScreenCount = 3`, while `destinationsFromConfig` gives indices `[0,0,1]`. Safe only while every writer passes through `finalizeScreenDestinationsConfig` / `normalizeScreenDestinations` (config-manager does at load); a config injected otherwise (hand edit, `settings-post` raw copy) regrows the phantom Screen 1 pair that WO-274/the compaction comment describes.
- `RISK` src/config/screen-destinations.js:123-132 — destination `stream.key` is stored in `screenDestinations` and survives normalisation; `get-state.js:110` returns `normalizeScreenDestinations(cfg.screenDestinations)` verbatim in `GET /api/state` (and `routes-device-view.js:108` likewise), so a stream key entered on a `stream` destination is readable by anything that can read state. WO-261 blanked the same secret for `streamOutputs` connectors (`device-graph-suggest.js:252`). No such destination exists on the box today (`config/screen_destinations.json`), so not demonstrated live.
- `QUALITY` src/config/screen-destinations.js:180-190 — the JSDoc for `compactMainScreenIndices` is detached (two comment blocks stack above `screenLabelsFromConfig`), the function at :222 has none. Also `isValidIpv4` (:24) duplicates `network-settings.js:56`.

## src/config/screen-layout-guard.js
- `RISK` src/config/screen-layout-guard.js:31-46 and :95-135 — coverage gaps in the Apply-time warnings: (a) multiview windows (`multiview_x/_y/_custom_width/…`) are never put in `screenRectsFromConfig`, so a multiview window overlapping a PGM window or overrunning the desktop produces no warning; (b) `collectDecklinkBindingWarnings` ignores `screen_N_decklink_key_device`, `multiview_decklink_key_device` and per-multiview `multiview_N_decklink_device`, so one card claimed as fill on one screen and key on another is not reported. Warnings only, no wrong output.

## src/config/server-info-config.js
- `BUG` src/config/server-info-config.js:15-20 `resolutionFromVideoModeString` — a custom channel mode is registered under the id `WxH` (generator: `config-generator-channel-plan.js:30`, `config-modes.js:179` → `modeId: '3072x1728'`), which carries no fps; this parser then hard-codes `fps: 50`. Failing case (run): `<channels><channel><video-mode>3072x1728</video-mode></channel></channels>` with a `<video-modes>` entry of `<time-scale>25000</time-scale>` → `{1:{w:3072,h:1728,fps:50}}`. `buildChannelMap` (`channel-map-from-ctx.js:34-37`) accepts it because `r.fps > 0`, so a 25 fps custom/LED-wall channel reports 50 fps to scene fps math, enrichment (`pickChannelResolution`) and `program-resolution.js`. Fix: read the `<video-modes>` `<time-scale>/<duration>` for the id (or fall back to the project fps instead of 50).
- `RISK` src/config/server-info-config.js:33 — `/<channel[^>]*>([\s\S]*?)<\/channel>/gi` also matches `<channels>`, `<channel-layouts>` and `<channel-layout …>`; index and mode come out right on the live `config/casparcg.config` (7 channels verified) only because the lazy match runs to the first real `</channel>`. A `<channel-layout …>` tag between two channels, or a commented-out `<channel>` block, would shift every following index. Use `<channel(?:\s[^>]*)?>` and strip comments first.

## src/config/source-labels.js
- `DEAD` src/config/source-labels.js:118 `shortSourcePill` — no server caller; the client has its own mirror (`client/lib/source-label.js:71`, comment "must agree"). grep: `grep -rnw shortSourcePill src client godot tools` → definition, export, the client comment, and `tools/smoke/smoke-wo506-source-labels.test.js`. Smoke-only, keep only if the test is the intended contract guard.

## src/config/tailscale-config.js
- `RISK` src/config/tailscale-config.js:35-44 / :51-54 — `loadTailscaleConfig` swallows any read/parse error and returns `DEFAULTS`; `saveTailscaleConfig` then writes `{...defaults, ...patch}` with a plain `fs.writeFileSync` (non-atomic). Case: a truncated/corrupt `config/tailscale.json` (power cut mid-write) silently reverts `autoLoginOnBoot`, `hostname`, `acceptRoutes` to defaults and the next save persists the reset. Fix: temp file + rename; keep the corrupt file as `.corrupt-<ts>` like the other config slices do.
