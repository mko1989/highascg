# WO-249 — 8ch → stereo pair selection for PGM2/streaming + stop the mixer reporting lie

**Status:** OPEN
**Priority:** HIGH (owner: hears ch 3&4 on the PGM2 stream while the mixer claims otherwise; no way to pick the pair)
**Owner check:** A249.1

## Investigation findings (verified, file:line)
- The compact mixer ALWAYS displays the output pair default: `client/lib/audio-mixer-rows.js:129,163,193` set `audioRoute: <x>.audioRoute || '1+2'` and never read `routeSourceAudio` — so a route layer whose SOURCE pair is `3+4` (applied server-side as `pan=stereo|c0=c2|c1=c3` at `src/engine/scene-take-lbg-jobs.js:170` via `routeSourceChannelsToAudioFilter`, `src/engine/audio-route.js:66-78`) shows as if nothing special is routed. This is the "mixer reports it like that but I hear 3&4" discrepancy.
- The dedicated streaming/record bus HARDCODES the first pair: `buildAudioDownmixFilterChain` at `src/streaming/streaming-channel-ffmpeg.js:21-28` emits `pan=stereo|c0=c0|c1=c1` for any non-stereo program layout; fed from `src/api/routes-streaming-channel-rtmp.js:79-87` and `src/api/routes-streaming-channel-shared.js:104` (layout via `resolveSourceProgramAudioLayout`, `routes-streaming-channel-shared.js:172-180`). No selector exists.
- Streaming bus `<channel-layout>` is derived from the VIDEO source screen only: `resolveStreamingChannelAudioLayout` at `src/config/config-generator-consumer-attach.js:508-514`. If it resolves narrower than the actual 8ch source, CasparCG's audio mixer does a naive count-based interleaved copy (verified in `caspar-build/src-tree/src/core/mixer/audio/audio_mixer.cpp:134-208` — no rematrix) and SCRAMBLES pairs before the consumer ever sees them. The bus layout must match the source width.
- Caspar has NO audio channel-selection AMCP/MIXER command (verified in AMCPCommandsImpl.cpp) — ffmpeg `pan=` is the only per-selection mechanism; it is already the established pattern.
- Existing pair picker precedent: `client/components/inspector-mixer.js:44-75` ("Source audio channels": all/1+2/3+4/5+6/7+8 on route sources); shared pair tables deliberately mirrored at `src/engine/audio-route.js:11-20` ↔ `client/lib/audio-routes.js:4-12`.

## Tasks

**T249.1 — mixer rows report the truth** (`client/lib/audio-mixer-rows.js`)
For route-source rows, read `routeSourceAudio` off the layer and expose it as a distinct field (e.g. `sourceAudioPair`); the compact mixer strip (find the renderer consuming these rows) shows it next to the output pair when it's not 'all' (compact form like `src 3+4`). Do NOT change `audioRoute` semantics.

**T249.2 — streaming source-pair selector (model + server)**
- Config: `streamingChannel.audioSourcePair` ('all' default | '1+2' | '3+4' | '5+6' | '7+8') — add to defaults (`src/config/defaults-core.js` streamingChannel block), settings-post streamingChannel rebuild (`src/api/settings-post.js:199-227` — mind WO-244's preserve-on-empty block sitting there now; this field is NOT a secret, plain rebuild), settings-get passthrough.
- Plumbing: extend `buildAudioDownmixFilterChain(programLayout, ...)` (`src/streaming/streaming-channel-ffmpeg.js:21-28`) with the pair: 'all' keeps today's `c0=c0|c1=c1`; a specific pair emits `pan=stereo|c0=c<2n>|c1=c<2n+1>` — derive indices from the SHARED table (`src/engine/audio-route.js` — export a helper if needed, keep client/server tables in sync). Thread the value from `src/api/routes-streaming-channel-rtmp.js:79-87` AND the record path `src/api/routes-streaming-channel-shared.js:104`.
- Guard: if the selected pair exceeds the resolved program layout's channel count, log a warn and fall back to first pair (never emit pan referencing nonexistent channels — ffmpeg would error the whole encode).

**T249.3 — streaming source-pair selector (UI)** (`client/components/device-view-inspector-stream.js` + `client/lib/streaming-channel-state.js:54-58`)
Dropdown "Source audio pair" (same option list/labels as `inspector-mixer.js:56-62`) in the streaming channel inspector, saved with the streaming settings; visible only when the resolved source layout has >2 channels (reuse `resolveSourceProgramAudioLayout` data if exposed, else always show with 'all' default).

**T249.4 — bus layout follows the wider source** (`src/config/config-generator-consumer-attach.js:508-514`)
`resolveStreamingChannelAudioLayout`: resolve BOTH the video-source screen layout and the audio-source screen layout (when audioSource is a program_N, not follow_video) and pick the WIDER. Cite the restart-dirty affordance (config change → regen+restart) — no live behavior change until applied.

**T249.5 — smoke** (`tools/smoke/smoke-wo249-audio-pair-select.test.js`, curated gate)
- `buildAudioDownmixFilterChain` matrix: stereo layout → no pan; 8ch + 'all' → c0/c1; 8ch + '3+4' → c2/c3; 8ch + '7+8' → c6/c7; 4ch + '5+6' → warn+fallback c0/c1.
- settings round-trip of `audioSourcePair` through the settings-post streamingChannel rebuild (and confirm WO-244 preserve-on-empty untouched: empty streamKey still preserved).
- mixer rows: route layer with routeSourceAudio '3+4' → row exposes sourceAudioPair '3+4'; without → 'all'/absent.

## Constraints (standard)
No git, no service ops, no AMCP, no HTTP to :4200/:5250, no vite build, curated gate ONLY. node --check + eslint --quiet on touched files; exact gate counts; <500 lines/file; honest checkboxes.

- [ ] T249.1 mixer truth
- [ ] T249.2 model+server pair plumbing (rtmp AND record paths)
- [ ] T249.3 UI dropdown
- [ ] T249.4 wider-bus layout resolve
- [ ] T249.5 smoke in gate
- [ ] A249.1 (owner) 8ch clip on PGM1, route on stream: pick 1+2/3+4/5+6/7+8 and confirm on the stream; mixer row shows the source pair
