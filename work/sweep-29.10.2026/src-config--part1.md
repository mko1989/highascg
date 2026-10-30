# src/config (part 1) — sweep 29.10.2026 (batch 077)

Files: 46 · lines: 6922 · findings: 0 BUG-HIGH, 5 BUG, 16 DEAD, 17 RISK, 41 QUALITY

Method: every file read in full. Generator behaviour was re-checked by calling `buildCasparGeneratorFlatConfig` + `buildConfigXml` on synthetic configs (pure functions, no I/O) and by `node -e` against `config/general.json` key names only. Dead-export scan: for every export of every file, `grep -rnw --include=*.js,*.mjs,*.html,*.gd,*.sh src client index.js tools scripts godot/client` excluding the file itself; "test-only" means the only hits are under tools/smoke, tools/ci, tools/fixtures.

## src/config/artnet-pixelmap-universe.js
- `OK`

## src/config/audio-channel-layouts.js
- `DEAD` src/config/audio-channel-layouts.js:70-71 exports `LAYOUT_CHANNEL_COUNT` and `PROGRAM_LAYOUT_IDS` — never imported (used inside the file only). grep: `grep -rnwE "LAYOUT_CHANNEL_COUNT|PROGRAM_LAYOUT_IDS" src client index.js tools godot/client` → only this file.
- `QUALITY` src/config/audio-channel-layouts.js:52-58 — an orphan JSDoc block ("Program master layout for mixer / inspector routing — widest of explicit programLayout and enabled PortAudio output layouts") sits directly above the unrelated JSDoc of `casparChannelLayoutId`. It documents a function that no longer exists here; delete it.

## src/config/audio-preview.js
- `RISK` src/config/audio-preview.js:15-20 `normalizeAudioPreview` — `enabled` is an OR of `casparServer.audio_preview_enabled` and `audioRouting.audioPreview.enabled`. The nested object (the one the Device View writes) cannot switch the feature off while the flat casparServer flag is `true`: `{audioRouting:{audioPreview:{enabled:false}}, casparServer:{audio_preview_enabled:true}}` → `enabled:true`. Make the nested value win when it is defined (`ar.enabled ?? cs.audio_preview_enabled`).
- `RISK` src/config/audio-preview.js:28 + 73-75 `defaultSource` / `resolveAudioPreviewDefaultRoute` — the default source is the literal `'preview_1'` regardless of `screenIndex`. With `screenIndex:2` and no explicit `defaultSource`, `resolveAudioPreviewChannel` returns `previewCh(2)` but the "solo cleared" route is `previewCh(1)` (regex `preview[_-]?(\d+)` matches `preview_1` → `i = 1`), i.e. the headphone channel of screen 2 falls back to screen 1's picture/audio. Derive the default from `screenIndex`.
- `QUALITY` src/config/audio-preview.js:73 — `|| src === 'preview_1'` is redundant (the regex already matches `preview_1`), and `pr` can be the boolean `true`, so `pr[1]` on line 74 relies on `true[1] === undefined`. Works, reads as a bug.

## src/config/build-caspar-generator-config-audio.js
- `QUALITY` src/config/build-caspar-generator-config-audio.js:39 + 137-158 — since WO-683 only one PortAudio output (`paId`) becomes a consumer, and `edges.find` (line 42) takes only the first cable of that output, so `screen_N_portaudio_consumers` can never hold more than one entry from this pass. `assignStereoBusPatchesOnScreens` (needs `list.length > 1`) and the multi-consumer branch of `renderPortAudioConsumerBlocks` are unreachable from the generator now. Remove or comment as legacy.
- `RISK` src/config/build-caspar-generator-config-audio.js:71-90 — `merged[...portaudio_consumers].push(consumer)` pushes into an array that already exists on `merged` if `casparServer` carried one, and `merged` is only a shallow copy (see build-caspar-generator-config.js:37), so that push would mutate the live config array and duplicate on every Apply. Nothing writes this key today (`grep -rn portaudio_consumers src client godot/client` → only generator files), so latent. Start from `merged[...] = []` instead of reusing.
- `QUALITY` src/config/build-caspar-generator-config-audio.js:14, 138, 172 — three copies of `Math.min(16, Math.max(1, parseInt(merged.screen_count || 4)))`. Note the fallback is 4 here but `buildChannelMap`/`getChannelMap` use the routing value.

## src/config/build-caspar-generator-config-decklink.js
- `RISK` src/config/build-caspar-generator-config-decklink.js:151-152 — `g.connectors.forEach((c) => { if (c.kind ...` dereferences `c` without a null check, while the Map built at line 18 uses `c?.id` and the `.filter` calls use `c?.`. A `null` entry in `deviceGraph.connectors` throws and aborts the whole config generation. `normalizeDeviceGraph` drops null connectors, but this function reads the raw `appConfig.deviceGraph`. Use `c?.kind`.
- `QUALITY` src/config/build-caspar-generator-config-decklink.js:181 — legacy `outputBinding.index` is clamped to 1..8 here, everything else in the generator allows screens 1..16 (e.g. `releaseDecklinkDeviceFromOtherTargets` at line 75 scans 1..16). A binding to screen 9-16 is silently moved to screen 8.

## src/config/build-caspar-generator-config-screens.js
- `BUG` src/config/build-caspar-generator-config-screens.js:133 `applyMultiviewDestinationOverrides` — the destination `videoMode` is tested with `STANDARD_VIDEO_MODES[modeRaw]` without `normalizeVideoModeId`, while the sibling `applyDestinationOverridesToScreens` (line 96) normalizes aliases. Failing case (reproduced): `screenDestinations.destinations = [{id:'m', mode:'multiview', videoMode:'720p60'}, ...]` → `merged.multiview_mode = 'custom'`, `multiview_custom_width/height/fps = 1920/1080/50` (the destination had no width/height so the defaults 1920x1080@50 from `normalizeDestination` are used) → a 720p60 multiview is generated as 1080p50 custom, while the same alias on a PGM screen yields `720p6000`. `1080p50` happens to land on the right size by accident. Fix: `const normalized = normalizeVideoModeId(modeRaw)` as in line 96.
- `DEAD` src/config/build-caspar-generator-config-screens.js:140-149 — `merged.multiview_custom_width/height/fps` are written but never read. grep: `grep -rn "multiview_custom" src client godot/client` → only these six writes. The multiview channel never honours them (see config-generator-consumer-attach.js:45 for the consequence).
- `QUALITY` src/config/build-caspar-generator-config-screens.js:109, 145 — `width > 0 && height > 0` is always true because lines 91/92/129/130 clamp with `Math.max(64, ...)`, so the "no usable size" case cannot happen; a destination with no size info would become 64x64, and the only protection is `normalizeDestination` supplying 1920x1080 defaults.
- `QUALITY` src/config/build-caspar-generator-config-screens.js:89 — `picked` takes the first destination of a main with a non-default `videoMode`, else the first `pgm_prv`; two destinations on one main with different modes are resolved by array order only.

## src/config/build-caspar-generator-config.js
- `RISK` src/config/build-caspar-generator-config.js:37 — `base = { ...defaults.casparServer, ...appConfig.casparServer }` is a shallow merge, so every nested array/object under `casparServer` (e.g. `screen_N_decklink_tiles`, `*_ndi_stream_names`, `*_portaudio_consumers`) is shared by reference with the live `ctx.config` and with the `defaults` singleton, and the passes below (`applyNdiStreamOutputsToScreens` line 57-59 `list.push(name)`; audio pass `push(consumer)`) can mutate them. Today none of these keys is persisted, so the mutation has no input; the first feature that persists one gets an Apply-accumulates-duplicates bug. Clone arrays when copying.
- `QUALITY` src/config/build-caspar-generator-config.js:101 — `applyStreamRecordMappingsFromGraph` failure is swallowed with an empty `catch (_) {}`; a throw there leaves `streamingChannel` un-synced and nobody is told (the same function is called unguarded in config-manager.js:108/117).

## src/config/build-caspar-generator-destination-utils.js
- `OK`

## src/config/build-caspar-generator-layout-sync.js
- `QUALITY` src/config/build-caspar-generator-layout-sync.js:37-40 vs 75-76 — inside one function `screen_N_screen_consumer` is read two ways: `=== true || === 'true'` (unset → NOT a consumer) when summing `casparScreenCumulativeX`, and `!== false && !== 'false'` (unset → IS a consumer) for the LED-wall tile placement, and `buildScreenPairChannels` (config-generator-consumer-attach-screen.js) treats unset as on. For a screen without a destination (flag unset) the multiview x computed here (`merged.multiview_x`, which then wins in `resolveMultiviewConsumerX` line 32) does not include that screen's width although the generator emits its `<screen>`, so the multiview window overlaps it. Not reachable while every screen has a destination (`applyScreenConsumerOverridesFromCabling` sets the flag for all), hence QUALITY.
- `QUALITY` src/config/build-caspar-generator-layout-sync.js:99 — one broad `try { ... } catch (_) {}` around the whole layout pass; any exception silently leaves every `screen_N_x/y` unpositioned. Log it.

## src/config/channel-map-from-ctx.js
- `RISK` src/config/channel-map-from-ctx.js:24-25 — `infoXml.trim()` assumes `gatheredInfo.infoConfig` is a string; an object/Buffer (the AMCP layer returns strings today) would throw out of `buildChannelMap`, which feeds `/state` and the scene engine. Guard with `typeof === 'string'`.
- `QUALITY` src/config/channel-map-from-ctx.js:58 — lazy `require('./audio-preview')` inside the function; there is no cycle (audio-preview only needs routing-map), hoist it.

## src/config/config-classify.js
- `DEAD` src/config/config-classify.js:51 `classifyConfigKey` and :65 `splitConfigForReplication` — test-only. grep: `grep -rnw "classifyConfigKey\|splitConfigForReplication" src index.js client` → only the definitions; callers are tools/smoke/smoke-config-classify.js and smoke-wo333-audio-capture-fft.test.js. `DEVICE_TOP_LEVEL_KEYS`, `SHOW_TOP_LEVEL_KEYS`, `SHOW_DESTINATION_SLICES` exports have no importer at all. Production replication only uses `mergeSharedProjectIntoLocal` (src/replication/replicate-projects.js) and the hardware-slice lists (src/replication/follower-machine-profile.js). The tier tables describe a config-level replication that is not wired.
- `QUALITY` src/config/config-classify.js:53-54 — line 54 (`/^screen_[1-4]_/ && (endsWith('_system_id') || includes('_os_'))`) can never be reached; line 53 already returns `'device'` for every key containing `_os_` or `_system_id`. Also `key.includes('_os_')` is a substring test and will classify any future key like `custom_os_x` as device-local.
- `QUALITY` src/config/config-classify.js:3-30 vs 83-90 — the same slice (`audioRouting`, `dmx`, `rtmp`, `streamOutputs`, `audioOutputs`, `recordOutputs`, `streamingChannel`) is `'show'` in `SHOW_TOP_LEVEL_KEYS` (shared, replicated leader→follower) and "per-machine on hot backup" in `SHOW_ROUTING_HARDWARE_SLICES` (kept local on the follower). Both lists cannot be right; today only the second is live.

## src/config/config-compare.js
- `QUALITY` src/config/config-compare.js:131-155, 195-215 — `buildIssues()` is only called (line 200) from the branch where `serverChannels.length === 0`, where it returns immediately with "No server channels parsed". Its channel-count and mode-mismatch loops, `screensCountMismatch` (can only be true if `serverPhysicalScreens.length > 0`, which is empty in that branch) and the `Screen outputs: ...` issue are unreachable; `aligned` is always `false` there. When the server channels exist the result is hard-wired `aligned: true, issues: []`. So the "compare" never compares: `moduleChannels` is just the server list echoed back. Either delete the dead code or restore a real comparison.
- `DEAD` src/config/config-compare.js:85 export `buildModuleChannelExpectation` — used only inside this file (feeds `settingsExpectation`). grep: `grep -rnw buildModuleChannelExpectation src client index.js tools` → definition + export only.

## src/config/config-generator-audio-routing.js
- `BUG` src/config/config-generator-audio-routing.js:80-86 — the preview-bus loop defaults `apScreen` to the loop index `n` (`ap.screenIndex ?? out.audio_preview_screen ?? n`), but `normalizeAudioPreview` (audio-preview.js:24) and the defaults (`audioPreview.screenIndex: 1`, defaults-core.js:151) default it to 1, and `bus` compares only against `'multiview'` while `normalizeAudioPreview` also treats `'mvr'` as multiview. Reproduced: `mergeAudioRoutingIntoConfig({screen_count:2, audioRouting:{audioPreview:{enabled:true, deviceName:'X'}}})` → `screen_1_preview_system_audio_enabled = true` AND `screen_2_preview_system_audio_enabled = true` (both preview channels get a `<system-audio>` on device X, two OpenAL consumers on one device) although `normalizeAudioPreview` says screen 1 only. With `bus:'mvr'` screen 1's preview audio is also enabled besides the multiview one. `normalizeAudioRouting`'s shallow `{...defaults, ...ar}` (line 15) does not fill the nested `audioPreview` defaults, which is what exposes it. Fix: use `normalizeAudioPreview(out)` for `apEn/apBus/apScreen/apDev` instead of re-deriving them.
- `DEAD` src/config/config-generator-audio-routing.js:64-68, 109 — the generator forces `screen_N_ffmpeg_audio_enabled=false`, empty paths/args for every screen and `extra_audio_channel_count = 0` on every run. Nothing writes these keys: `grep -rn "_ffmpeg_audio_enabled\|extra_audio_channel_count" src client godot/client` → only routing-map.js:198 (reads count) and the generator files. So `buildScreenFfmpegConsumersXml`, `buildExtraAudioFfmpegConsumersXml`, `buildExtraAudioChannel`, `getExtraAudioChannelLayouts`, `getExtraAudioModeDimensions`, the `programOutput: 'alsa'|'custom'` branches of `normalizeAudioRouting` (lines 20-35) and `defaultFfmpegAudioArgs` are unreachable from the generator. Candidates for removal (≈250 lines).
- `OK` otherwise — the PortAudio-vs-OpenAL reconcile (line 91-97) matches build-caspar-generator-config-audio.js.

## src/config/config-generator-audio-xml.js
- `BUG` src/config/config-generator-audio-xml.js:212-216 `buildGlobalPortAudioInnerXml` — scans `screen_1..8_portaudio_consumers` for the consumer that fills the root `<portaudio>` block, but `countPortAudioConsumers` (line 259-268) counts screens 1..16 and gates the block on `=== 1`. A single consumer on screen 9-16 (valid; every other pass supports 16 screens) satisfies the gate, is not found by the 1..8 scan, and the root block is built from the `screen_1_portaudio_*` fallbacks (no device name, 2 channels, defaults) → Caspar opens the default PortAudio device instead of the cabled one. Fix: loop to 16.
- `QUALITY` src/config/config-generator-audio-xml.js:135-138 — two stacked JSDoc blocks: the WO-58 comment for `buildComposePreviewFfmpegConsumerXml` is separated from its function by the comment of another one ("WO-58: dynamic AMCP attach…").
- `QUALITY` src/config/config-generator-audio-xml.js:395 — `parseInt(outPair.split('-')[0])` without radix and `mixPair.split` assumes a string; a numeric `audio_patch` value throws and aborts generation of the whole config.
- `RISK` src/config/config-generator-audio-xml.js:352-356 — with `caspar_global_portaudio` and one consumer per screen on two screens (count 2), the root block is skipped (count must be 1) AND each screen emits an empty `<portaudio/>`, so the device settings exist nowhere. Not reachable since WO-683 (one PA output, one cable), but nothing prevents it.

## src/config/config-generator-builders.js
- `DEAD` src/config/config-generator-builders.js:43 re-export `buildScreenConsumerExtrasXml` — no importer of the facade uses it. grep: `grep -rnw buildScreenConsumerExtrasXml src tools` → screen-xml.js (definition) and this re-export only.
- `OK` otherwise (facade).

## src/config/config-generator-channel-plan.js
- `QUALITY` src/config/config-generator-channel-plan.js:69-70 — for multiview the plan calls `getModeDimensions(mode, config, ch)` where `ch` is the CASPAR CHANNEL NUMBER (e.g. 5) passed as the "screen index" argument. For standard modes the index is unused, but for `'custom'` it looks up `screen_<ch>_custom_width` (a different screen's keys, or none). Together with `buildMultiviewChannel` using the raw mode string this makes custom multiview unusable (see config-generator-consumer-attach.js:45).
- `OK` otherwise.

## src/config/config-generator-channels.js
- `QUALITY` src/config/config-generator-channels.js:80 — `require('../utils/os-config')` for `calculateLayoutPositions` while build-caspar-generator-layout-sync.js:1 requires the same function from `../utils/os-layout-calculator` (os-config re-exports it). Two import paths for one function.
- `QUALITY` src/config/config-generator-channels.js:30-36 — `resolveMultiviewConsumerX` returns `config.multiview_<n>_x ?? config.multiview_x` first; layout-sync.js:45 always writes `merged.multiview_x` when the planner has a multiview rect, so the sophisticated branches below it (same-GPU-screens, mapping bbox) only run when the planner has none. Intended per WO-40a? The comment says planner first; behaviour matches, but the double computation (layout-sync and here) with different `screenHasConsumer` predicates is confusing (see layout-sync finding).

## src/config/config-generator-consumer-attach-misc-channels.js
- `QUALITY` src/config/config-generator-consumer-attach-misc-channels.js:92-95 `buildPixelmapChannel` — `label` is `escapeXml`'d and then passed through `channelXmlComment`, which only needs `--` sanitising; a label `A & B` becomes `A &amp; B` inside the XML comment. Cosmetic.
- `QUALITY` src/config/config-generator-consumer-attach-misc-channels.js:46-62 `buildExtraAudioChannel` — unreachable (see config-generator-audio-routing.js DEAD).
- `OK` otherwise.

## src/config/config-generator-consumer-attach-screen.js
- `OK`

## src/config/config-generator-consumer-attach.js
- `BUG` src/config/config-generator-consumer-attach.js:45 + 142 `buildMultiviewChannel` — writes `<video-mode>${modeId}</video-mode>` where `modeId = mode = config.multiview_<n>_mode || config.multiview_mode`, the RAW setting, not `ctx.dims.modeId`. When the multiview mode is `'custom'` (which `applyMultiviewDestinationOverrides` produces for any non-standard multiview destination size, build-caspar-generator-config-screens.js:139/146) the channel gets the literal `<video-mode>custom</video-mode>`, and no `<video-mode><id>…` is registered for it because the plan (`config-generator-channel-plan.js:70`) resolves `'custom'` against `screen_<channelNumber>_custom_*`, finds nothing, falls back to 1920x1080@50 = standard `1080p5000` and `pushCustomMode` skips standard ids. Reproduced: destinations `[{mode:'multiview', videoMode:'custom', width:1728, height:960, fps:50}, {mode:'pgm_prv', mainScreenIndex:0, videoMode:'1080p5000'}]` → generated XML has `<video-mode>custom</video-mode>` on the multiview channel and `<video-modes/>` empty. Caspar refuses to start on an unknown video-mode id (same failure the WO-484 comment in config-generator-channel-plan.js:72-76 describes), so Apply produces a config that does not boot. The multiview `dims` used for the screen window (line 44) is right, only the channel mode id is wrong. Fix: `const modeId = ctx.dims.modeId`, resolve `multiview_custom_*` in the plan, and register the mode.
- `DEAD` src/config/config-generator-consumer-attach.js:233 re-export `buildDecklinkTiledConsumersXml` and :243 `resolveStreamingChannelAudioLayout` — test-only (tools/smoke). grep: `grep -rnw "buildDecklinkTiledConsumersXml\|resolveStreamingChannelAudioLayout" src` → definitions/re-exports and in-file use only.
- `QUALITY` src/config/config-generator-consumer-attach.js:46 — `mvStd` is computed from the raw mode string, so `'1080p50'` (an alias) is treated as a custom channel (`isChannelCustom: true`) here.

## src/config/config-generator-custom-modes.js
- `RISK` src/config/config-generator-custom-modes.js:16 — custom video modes are de-duplicated by `modeId`, and `getModeDimensions` mints ids as `${width}x${height}` WITHOUT the frame rate (config-modes.js:179, 193). Two channels at the same size but different fps (e.g. screen 1 1728x960@50, multiview 1728x960@25) share the id `1728x960`; the second mode is dropped and both channels run at the first one's fps and cadence. Include fps in the id (or compare fps before skipping).

## src/config/config-generator-mode-helpers.js
- `OK`

## src/config/config-generator-operator-gui.js
- `OK`

## src/config/config-generator-osc-xml.js
- `OK`

## src/config/config-generator-screen-xml.js
- `QUALITY` src/config/config-generator-screen-xml.js:37-86 vs 104-140 — `buildProgramScreenConsumerInnerXml` and `buildMultiviewScreenConsumerInnerXml` are ~45 lines of copy-paste differing only in how the key is read (`screen_N_x` vs `multiview_N_x ?? multiview_x`). A shared builder with a `read(field)` closure removes the drift risk (e.g. `always_on_top` defaults differ: PGM true, multiview false in attach.js:51 while defaults-caspar-server.js:66 says true).

## src/config/config-generator-utils.js
- `QUALITY` src/config/config-generator-utils.js:18-19 `escapeXml` — `String(s || '')` turns the number `0` and `false` into `''`; callers pass strings today, but `<device>` style numerics must not go through it.
- `OK` otherwise.

## src/config/config-generator-xml-comments.js
- `OK`

## src/config/config-generator.js
- `RISK` src/config/config-generator.js:50-67 — the manual `config.video_modes` hook writes `<cadence>${vm.cadence || 'progressive'}</cadence>` (the automatic modes use an integer `48000/fps`, so `'progressive'` is not a number Caspar's cadence accepts), `parseInt(vm.width)` can emit `NaN`, and ids are not de-duplicated against the auto-registered ones. No writer exists (`grep -rn video_modes src client godot/client` → this file only), so it is an undocumented escape hatch with no validation. Validate or remove.
- `QUALITY` src/config/config-generator.js:105-106, 114 — `<lock-clear-phrase>secret</lock-clear-phrase>`, the AMCP controller port `5250` and the `<amcp><media-server>` port `8000` are hard-coded in the template; the app's `caspar.port` (defaults-core.js:13) can be changed in Settings without changing what the generated server listens on.
- `DEAD` src/config/config-generator.js:130-134 re-exports `AUDIO_LAYOUT_CHOICES` (and `getStandardModeChoices`, which is imported directly from config-modes by src/api/routes-caspar-config.js:12) — `grep -rnw AUDIO_LAYOUT_CHOICES src client tools godot/client` → only config-modes.js and this re-export; no consumer. The list also lacks `4ch`, `16ch`, `discrete-8ch` that the generator supports.

## src/config/config-manager.js
- `BUG` src/config/config-manager.js:290-297 `_loadModular` — a `general.json` that fails to parse is logged and ignored but, unlike every slice file (line 313) and `tandem_topology.json` (line 324), NOT quarantined (WO-421 wired quarantine into the monolithic catch, the per-key catches and tandem_topology, but not this one). The next `save()` rewrites `general.json` from the defaults-merged in-memory config (line 349-352), destroying the torn-but-recoverable file with ~60 top-level keys (screen_count, composePreview, startup, network, machineProfile, extraLiveSources, gpuPhysicalTopology, cgStudio, per-screen OS keys, configVersion). Failing case: `config/general.json` truncated to 0 bytes by a power cut → box boots on defaults → the first Settings change persists them. Fix: call `_quarantineCorruptFile` in that catch.
- `RISK` src/config/config-manager.js:170-182 `load()` — the single outer `catch` treats ANY exception after parsing as corruption. Monolithic: a throw from `finalizeScreenDestinationsConfig`, `applyStreamRecordMappingsFromGraph` (unguarded here at 108/117, but wrapped in try/catch in build-caspar-generator-config.js:103, which implies it can throw) or a migration renames a perfectly valid config file to `.corrupt-*` and boots on defaults. Modular (directory): no quarantine (the `isFile()` check is false) but `this.config` becomes defaults and the next `save()` overwrites every slice file with defaults (`_saveModular` writes all slices). Wrap only the parse step; treat post-parse failures as fatal-with-log, not as "use defaults".
- `RISK` src/config/config-manager.js:240-241, 362-363 — tmp-write + rename without `fsync` of the temp file or the directory. On this box `config/` holds a 0-byte `*.corrupt-2026-09-04T12-10-27…` for every slice (WO-421 attributes that incident to the exFAT sync copy, which was fixed), the same failure mode a power loss after rename can produce on ext4 with delayed allocation. Use `fs.openSync`/`fsyncSync` before the rename.
- `RISK` src/config/config-manager.js:245 + 340-347 — `save(newConfig)` is replace, not merge: `this.config = { ...newConfig }` drops any key the caller omitted (the hand-listed `newConfig` in src/api/settings-post.js:389 is why sections silently revert), and `_saveModular` only writes slices whose key is `!== undefined`, so an omitted slice keeps its OLD file on disk and comes back on the next restart while the running process has already lost it. Either merge into the current config or delete the slice file when the key is absent.
- `RISK` src/config/config-manager.js:249-258 — the 300 ms duplicate-suppression state (`_lastConfigChangeJson/At`) is updated before the `emitChange` check. A `save(cfg, {emitChange:false})` (full-apply flows) followed within 300 ms by an identical `save(cfg)` returns early at line 254 and never emits `'change'`, so the subsystem recycle (OSC, streaming, DMX) that the second call asked for is skipped.
- `RISK` src/config/config-manager.js:82, 286, 450 — `{ ...defaults }` is a shallow copy of the module singleton, so every top-level key that is not overwritten by a file (e.g. `casparServer` when `caspar_server.json` is missing, `deviceGraph` in `factoryReset`, line 453 `deviceGraph: defaults.deviceGraph`) is the SAME object as `defaults.*`. Any code that mutates `ctx.config.<slice>.x = …` then edits the factory defaults for the whole process (later `{...defaults.casparServer}` users, the next factory reset). On the box all slices currently have files, so it is dormant.
- `QUALITY` src/config/config-manager.js:293 vs 113 — modes disagree on defaults: the monolithic loader deep-merges level 1 (`_merge`, new nested defaults appear), the modular loader does `Object.assign(result, general.json)` (keys in general.json such as `composePreview`, `startup`, `network` replace the default object, new default sub-keys never appear). A new default added under `composePreview` is visible in monolithic mode and undefined in modular mode (the box's mode) until the owner saves. Use `_merge` for the general keys too.
- `QUALITY` src/config/config-manager.js:219, 482 — `_saveChain` is a promise chained to an already-computed boolean; since `_saveNow` is synchronous it orders nothing. Only tools/smoke/smoke-config-lifecycle-wo161.test.js:113 awaits it.
- `QUALITY` src/config/config-manager.js:10-13 — the JSDoc "Top-level keys that should be saved to separate files…" is glued to `assertConfigPathString` and describes `MODULAR_KEYS` (line 47).
- `QUALITY` src/config/config-manager.js:241 — the monolithic temp file is the fixed name `highascg.config.json.tmp`; two processes (or a Syncthing peer picking up the half-written file) can collide. Use `${path}.tmp.${process.pid}` like button-preview-cache.js does.

## src/config/config-modes.js
- `QUALITY` src/config/config-modes.js:179, 193 — custom mode ids drop the frame rate (`${w}x${h}`), see config-generator-custom-modes.js. `findStandardModeId` and `getModeDimensions` are otherwise consistent with the standard table.
- `DEAD` src/config/config-modes.js:199-208 `AUDIO_LAYOUT_CHOICES` — exported and re-exported but never consumed (see config-generator.js); it also omits `4ch`/`16ch`/`discrete-8ch`.
- `QUALITY` src/config/config-modes.js:170 `getModeDimensions(modeId, config, screenIdx)` — the third parameter is "1-based screen index" in the docs but is called with a Caspar channel number from the multiview plan (config-generator-channel-plan.js:70) and with a hard-coded `1` from decklink-output-resolve-feed.js:23; no way to say "multiview". Add an explicit `multiview` key prefix argument.

## src/config/config-reload-signature.js
- `DEAD` src/config/config-reload-signature.js:81 export `pickSubsystemReloadSnapshot` — used only inside this file. grep: `grep -rnw pickSubsystemReloadSnapshot src index.js tools` → definition, export, and the one call in `hashSubsystemReload`. (`hashSubsystemReload` is used by index.js:240/247.)
- `OK` otherwise.

## src/config/decklink-amcp.js
- `DEAD` src/config/decklink-amcp.js:76-77 exports `PLAY_DECKLINK_RE` and `resolveDecklinkInputFromChannelLayer` — the former has no importer, the latter is used by tools/smoke only (in production only `normalizeDecklinkPlayAmcpLines` from src/api/routes-amcp.js is used).

## src/config/decklink-config-validate.js
- `OK`

## src/config/decklink-input-slots.js
- `DEAD` src/config/decklink-input-slots.js:71 `isLegacyImplicitDecklinkInputSlot()` — defined and exported, no caller anywhere (not even in this file). grep: `grep -rnw isLegacyImplicitDecklinkInputSlot src client tools godot/client index.js` → definition and export only. `DECKLINK_MVR_SENTINEL_SLOT` and `decklinkInputSlotsFromDeviceGraph` exports are test-only/in-file.
- `QUALITY` src/config/decklink-input-slots.js:5-11 — `readCasparSetting` is a byte-for-byte duplicate of src/config/routing-map.js:11-17 (and re-exported from here). Import it instead of copying.

## src/config/decklink-io-direction.js
- `DEAD` src/config/decklink-io-direction.js:37 `isDecklinkIoUnassigned()` — no src caller (grep: `grep -rnw isDecklinkIoUnassigned src` → definition + export only; client/lib/decklink-io-direction.js carries its own copy).

## src/config/decklink-key-fill.js
- `DEAD` src/config/decklink-key-fill.js:33 `decklinkRequiresYuvPixelFormat()` — defined and exported, never called (WO-487 removed its only use). The following exports have no importer outside the file: `FILL_ONLY_KEYER`, `DEFAULT_DECKLINK_CONSUMER_SETTINGS`, `DECKLINK_BUFFER_DEPTH_MIN/MAX`, `DECKLINK_LATENCY_VALUES`, `DECKLINK_COLOR_SPACE_VALUES`, `KEYER_VALUES`, `parseDecklinkEmbeddedAudio`, `parseDecklinkLowLatency`, `normalizeDecklinkLatency`, `normalizeDecklinkColorSpace`, `normalizeDecklinkBufferDepth`, `normalizeDecklinkChannelLayout`, `readDecklinkConsumerSettingsFromConnectorCaspar`, `buildDecklinkConsumerOptionsXml`, `buildDecklinkSubregionXml` (grep per name over src client tools godot/client: only this file, tests at most). `normalizeDecklinkKeyer` is used by src/api/device-view-crud.js. Trim the export list.
- `QUALITY` src/config/decklink-key-fill.js:83 `decklinkPixelFormatXml(videoMode, …)` — the `videoMode` parameter is ignored ("kept for callers"); callers still compute and pass it.
- `QUALITY` src/config/decklink-key-fill.js:336-345 — the key-only second `<decklink>` consumer is emitted without `<video-mode>`, latency, embedded-audio or buffer-depth, while the fill consumer on the same card pair carries them. Probably intended (Caspar derives them), left undocumented.

## src/config/decklink-output-resolve-feed.js
- `RISK` src/config/decklink-output-resolve-feed.js:23 `feedFromMultiviewConfig` — `getModeDimensions(mode, config, 1)` resolves `'custom'` against `screen_1_custom_*` (PGM screen 1's size) instead of the multiview's own, so a custom multiview feeds the DeckLink auto-format picker with screen 1's raster. Same family as the consumer-attach.js:45 bug.

## src/config/decklink-output-resolve-modes.js
- `DEAD` src/config/decklink-output-resolve-modes.js:83 `buildDecklinkPassthroughSubregion()` — no caller. grep: `grep -rnw buildDecklinkPassthroughSubregion src client tools godot/client` → definition, export, and the `...modes` spread in decklink-output-resolve.js only.

## src/config/decklink-output-resolve-status.js
- `OK`

## src/config/decklink-output-resolve.js
- `OK` (facade; spread of three modules, exports consistent).

## src/config/defaults-caspar-server.js
- `QUALITY` src/config/defaults-caspar-server.js:32 — `screen_N_portaudio_auto_tune` is a dead key: the generator reads `screen_N_portaudio_auto_tune_latency` (config-generator-audio-xml.js:238, 380) and nothing writes either. grep: `grep -rn "portaudio_auto_tune" src client godot/client` → this default and those two reads.
- `DEAD` src/config/defaults-caspar-server.js:56 `preview_screen_consumer: false` — never read. grep: `grep -rnw preview_screen_consumer src client godot/client index.js` → only this line. (`multiview_enabled` is read by x-display-session-layout-resolve.js and factory-starter.js, fine.)
- `QUALITY` src/config/defaults-caspar-server.js:181 — `configPath: '/home/casparcg/highascg/config/casparcg.config'` is an absolute path to this user's home; on any other install it is wrong until overwritten.
- `QUALITY` src/config/defaults-caspar-server.js:66 `multiview_always_on_top: true` vs attach.js:51 (`casparBoolEnabled(..., false)`): the default file and the code's own unset default disagree (the file wins only while the key is merged in).

## src/config/defaults-core.js
- `RISK` src/config/defaults-core.js:70-74 — `security: { enforceAuth: false, exposeToNetwork: true, apiToken: '' }` together with `server.bindAddress: '0.0.0.0'` (line 68) makes a fresh box an open, unauthenticated API on every interface (the live config/security.json on this box is the same: `enforceAuth:false, exposeToNetwork:true`, no token). Probably the owner's deliberate shop-LAN choice; flagged because the defaults are also what a factory reset and the stick image ship.
- `QUALITY` src/config/defaults-core.js:283-291 — `companion` defaults duplicated in src/companion/companion-config.js:30-40.
- `QUALITY` src/config/defaults-core.js:160-161 — `multiview_os_rate` and `multiview_os_mode` live at top level while the per-screen siblings are in `defaults.casparServer`; the one key in the `defaults` object that no file in `config/` provides (checked) so it stays shared with the singleton.

## src/config/defaults-replication.js
- `OK`

## src/config/defaults.js
- `OK`

## src/config/device-graph-constants.js
- `OK`

## src/config/device-graph-core.js
- `RISK` src/config/device-graph-core.js:76 — `index: parseInt(String(c.index), 10)` keeps `NaN` for a non-numeric index (only empty/undefined is filtered); `JSON.stringify` writes `null`, and `decklinkSlotFromConnector` (decklink-input-slots.js:43) then sees a non-finite index and falls through to `externalRef`. Use `Number.isFinite` and drop the key otherwise.
- `QUALITY` src/config/device-graph-core.js:79-81, 46 — `caspar`, `settings`, `edid` objects are copied by reference from the input graph into the "normalised" one, so mutating the result (as the decklink pass does on `merged`) can write through to `ctx.config.deviceGraph`; `normalizeDeviceGraph` also does not de-duplicate edges (only `validateDeviceGraph` reports them) while connectors are de-duplicated.
- `QUALITY` src/config/device-graph-core.js:111 — the legacy device id is hidden as a base64 literal (`'cGl4ZWxodWVfbWFpbg=='`); a named constant with a comment would say what is being filtered.
