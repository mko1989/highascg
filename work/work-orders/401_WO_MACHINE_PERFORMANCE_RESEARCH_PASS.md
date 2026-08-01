# WO-401 — Machine performance research pass (todos30.07.26)

**Status:** IN PROGRESS — research complete 2026-07-30; **F1, F2, F4, F6, F7, F8, F9 implemented same day** (owner-approved), **awaiting service restart after the show** to take effect. F3 and F5 found VOID as proposed; F10–F15 deliberately deferred with reasons — see §2. Follow-ups: F3-revised (value-aware dirty marking), client tranche (F12 + todos item 6) post-show.
**Priority:** High (owner: "things that can be done better to get better performance of the machine")
**Date:** 2026-07-30
**Source:** owner conversation + `work/work-orders/todos30.07.26` items 6 (thumbnail refresh) and 8 (devices tab load)
**Related:** WO-392 (live-thumb URL bust — half of item 6), WO-396 (Devices-tab load — already fixed 30.07, see below), WO-399 (v4l2 jpg-branch 50 fps burn — sibling of F5), successor WOs to be opened per fix.

## 1. Investigation

All numbers measured live on the box 2026-07-30 (~17:00, node PID 2188853; casparcg PID 2182627).
Findings 1–5 spot-verified in source by a second pass; the rest carry the researcher's file:line evidence.

### Live baseline

| Metric | Value |
|---|---|
| casparcg CPU | **431 %** (~20 threads at 10–20 % each), GPU 33 % / 42 W |
| OSC messages handled by node | **18,656 msg/s** (1,677 datagrams/s, ~11 msg/bundle) |
| WS traffic per client | **335 KB/s**, of which `osc` = 323 KB/s (21.9 msg/s × 15,064 B full snapshots) |
| node service | 7.9 % of one core sustained, 400 MB RSS (flat — no leak) |
| `GET /api/state` | 43–49 ms, fully synchronous (event-loop stall) |
| v4l2 relay ffmpeg | 22 % of one core, 24/7 |
| Firefox kiosk | ~5 % total; Xorg ~13 % |
| Load / memory | ~7 on 28 cores; 14 / 64 GB used |

### Ranked findings

**F1 — HIGH. OSC debug sample list burns ~15 % of the node process.** `src/osc/osc-listener.js:26-35`
(called from `:66`/`:79`): `sampleAddresses.includes(addr)` linear-scans a 40-string ring on every
one of 18,656 msg/s; Caspar emits hundreds of distinct addresses so it's a near-permanent miss
(40 string compares + push/shift per message). Benchmarked 0.63 µs/msg ≈ **1.18 % of a core** for a
field only read by `/api/osc/diagnostics`. Fix: `Set` (stop mutating once saturated) or gate behind
a debug flag. *(Verified in source.)*

**F2 — HIGH. Four full deep clones + two full stringifies of OSC state per 50 ms tick.**
`src/osc/osc-state.js:190,210` (`getSnapshot` = `JSON.parse(JSON.stringify(channels))`, called by
`_buildChangePayload` from `_flushEmit:172-181`), `src/bootstrap/osc-lifecycle.js:50` (second
`getSnapshot` same tick), `src/state/state-manager.js:349,359,371,373` (clone again into `_state`),
then `osc-lifecycle.js:64` (`_wsBroadcast('osc')`) **and** `state-manager.js:385` (`_emit('osc')`)
each ship the same 15 KB. `_decayStaleAudio`/`_pruneStaleLayers` run 4× per tick. ≈0.7 % of a core
in pure serialization plus the GC churn behind 400 MB RSS. Fix: compute the snapshot once per tick
and pass it through; drop the duplicate `_emit('osc')`. *(Verified in source.)*

**F3 — HIGH. 323 KB/s of full OSC state to every WS client; the delta path exists but is OFF.**
`src/server/ws-server.js:134-152`, `src/osc/osc-config.js:21-39`. `wsDeltaBroadcast` defaults false
and neither `highascg.config.json` (only `emitIntervalMs: 50` at `:184`) nor `.env` enables it —
yet `osc-state.js:187-202` implements per-dirty-channel deltas and the client merge path
(`client/lib/osc-client.js:3-31`) is written and tested. Kiosk throttles to 4 Hz client-side but
still `JSON.parse`s all 20 Hz (`client/lib/ws-client.js:131`, plus a 15 KB `text.trim()` copy).
Fix: set `osc.wsDeltaBroadcast: true`, consider `emitIntervalMs: 100`. *(Verified in source.)*

**F4 — HIGH (take latency). Synchronous disk write before EVERY AMCP send.**
`src/caspar/amcp-client-history.js:6-20` does `mkdirSync` + `writeFileSync` of
`data/amcp-last50.txt`, called at `src/caspar/amcp-client-transport.js:81` and `:224` directly
before `socket.send`. A scene take issues dozens–hundreds of AMCP lines → that many blocking disk
round-trips inside take latency. Fix: keep ring in memory, flush debounced/async or on error only.
*(Verified in source.)*

**F5 — HIGH. v4l2 relay ffmpeg runs a redundant software scale/format filter 24/7.**
`src/virtual-output/v4l2-bridge-relay.js:50-61` adds `-vf format=yuv420p,scale=1920:1080`
unconditionally; source is already 1920×1080 and `-pix_fmt yuv420p` already covers format. 22 % of
a core around the clock (stream/udp mode — the jpg branch's separate 50 fps burn is WO-399). Fix:
omit `-vf` when configured size matches source. Bigger question for a follow-up: should the whole
bridge idle when nothing consumes /dev/video10? *(Verified in source.)*

**F6 — MED-HIGH. `GET /api/state` re-reads the project JSON 4× and blocks ~45 ms.**
`src/api/get-state.js:86,90` each call `loadProjectScenes()`; each does `readProjectFile` +
`readAutosaveFile` (+ legacy) — `src/engine/project-scenes-load.js:44,47,62`,
`src/engine/project-store.js:178,243,256` — 4 × `readFileSync` + `JSON.parse` of a 38.5 KB file per
request, plus the whole-state clone (`state-manager.js:407-420`). Measured 43–49 ms synchronous;
OSC/AMCP starve meanwhile. Likely a big slice of the Devices-tab 1–2 s load (todos item 8).
Fix: memoize `loadFullProject()` on mtime; pass the loaded envelope into the `globalBorders` branch.

**F7 — MED. ~4,480 `setVariable` calls/s from OSC audio/layer mirroring.**
`src/osc/osc-variables.js:59-160` (from `osc-lifecycle.js:54`): per 50 ms tick, 8 channels × (16
`_audio_cN_dBFS` + L/R) + 4 vars/layer ≈ 224 calls, each with `String()` + template-key allocation
before the dedupe check (`state-manager.js:105`); changed keys each emit a separate WS `change`
frame via the 500-entry `_changes` shift-array (`:75-76,116`). Fix: precompute keys, skip channels
whose `audio._lastUpdateAt` didn't advance.

**F8 — MED. `projects/_trash`: 620 tombstone dirs / 19 MB replicated to 3 Syncthing peers.**
`src/engine/project-store.js:118,144` retires into `projects/_trash/<slug>-<ts>/`; nothing prunes;
`projects/` is not in `.stignore`. Pure background IO/index cost on 4 machines. Fix: add
`/projects/_trash` to `.stignore` (mirror on the Mac per CLAUDE.md) + age/count cap in
`retireProjectSlug`.

**F9 — MED. 57 KB pretty-printed synchronous state write on every on-air key.**
`src/utils/persistence.js:24-27` (PRETTY defaults true), `:35-43` (IMMEDIATE_KEYS incl.
`liveScenesByProgramChannel`, `scene_deck`, bank/timers), `:59-68,124-128`: immediate keys bypass
the 200 ms debounce → full-blob `JSON.stringify(_, null, 2)` + `writeFileSync` + `renameSync` on
the main thread per set; several per scene take. Fix: `HIGHASCG_PERSISTENCE_PRETTY=0` + ~20 ms
coalescing window for immediate keys.

**F10 — MED. Every OSC message fully decoded before filtering.** `src/osc/osc-listener.js:63-87` →
`src/osc/osc-state.js:91-112`: full decode (≈1.17 % core) + 2–3 regexes per message
(`osc-state.js:105,133,150`) + repeated `tail.slice()` allocs (`osc-state-layer.js:81,84,154,155`);
`…/has_signal` and `…/file/format` fall through every branch with no handler. Fix: rejected-suffix
`Set` right after the channel regex; hoist regexes to module scope.

**F11 — MED-LOW. O(C²) channel lookup + unconditional per-channel emits per tick.**
`src/state/state-manager.js:365` (`channels.find` inside channel loop, 1,280 cmp/s) and `:374`
emits `channels.<id>` with freshly cloned `oscLayers` for every channel every tick;
`_dirtyChannels` (`osc-state.js:110`) is discarded at `:177` when delta mode is off. Fix: `Map`
index; emit only dirty channels.

**F12 — MED-LOW (client). Audio-meter rAF loop never idles.**
`client/lib/audio-mixer-meter-loop.js:47-131`: unconditional 60 fps rAF (only `document.hidden`
parks it, `:53`); per-strip `key.split(':')` alloc; `parseBusMeterFillKey` called twice for bus
keys (`:78-80`) — against OSC data refreshing at 4 Hz. Kiosk content process measured 2.9 %.
Fix: drive from OSC ingest or ~20 Hz timer; hoist the double parse.

**F13 — LOW. USB hotplug watcher forks `lsblk` every 2 s forever.** `src/media/usb-drives.js:99,110`
(started unconditionally `index.js:314`). Fix: udev/netlink watch, or 10 s + only while ingest UI open.

**F14 — LOW (feature currently off). Compose-preview mtime watch: 2 async `stat`/channel at 25 Hz**
with `require('fs')` resolved inside the loop — `src/preview/compose-preview-ffmpeg-jpeg.js:148-152,206-255`
(`:214` and redundant re-stat `:246`). Only bites when `composePreview.ffmpeg_jpeg` is enabled.

**F15 — LOW. Live-audio bridge encodes synthetic 320×240 x264 with GOP=1 and resamples twice.**
`src/audio/live-audio-bridge.js:130-133,148-165` (every frame IDR) and `:182-185` (FFT tee re-runs
the identical `aresample`/`aformat` chain from `:138-139`). Fix: `asplit`, and mpeg2video / lower
`-r` for the dummy video.

### Owner todos item 6 — live-input thumbnails refreshing periodically

WO-392 made the thumb URL stable (`client/components/sources-panel-live-render.js:130-134`), but the
panel still rebuilds each row with `el.innerHTML = …` (`:162`) on every state tick — the `<img>`
node is recreated, so the browser re-requests (304 revalidation) and can visibly flash. The refresh
the owner sees is DOM-recreation, not URL busting. Fix direction: only rewrite a row's innerHTML
when its data actually changed (or patch text/status nodes in place and leave the `<img>` alone).

### Owner todos item 8 — Devices tab 1–2 s load

**Already fixed earlier today by WO-396** (cold `GET /api/device-view` DeckLink re-probe: multi-day
log collector, log-first fallback, 10 min cache — cold 2.47 s → 0.455 s, warm 54 ms). F6 remains an
independent, additional `/api/state` cost worth fixing on its own merits.

### Checked and CLEAN (don't re-investigate)
No node memory leak (RSS flat); log ring buffers bounded (`log-buffer.js:38-39`,
`amcp-client-history.js:11-13`); `ws-server.js` stringifies once per broadcast with sane
backpressure (`:118-136`); `periodic-sync.js` correctly parks AMCP polling while OSC is live
(`:253,454-459`); `state-manager.js:168-170` skips xml2js on unchanged INFO; `.stignore` already
covers `.highascg-state.json`, `data/`, `log/`, `media/`, `node_modules/`.

## 2. What was done

First wave implemented 2026-07-30 evening (owner: "you can start working on those. the machine is
on show now. so no restarts") — all server-side, **inert until the next service restart**; nothing
was restarted or reloaded.

- **F1** — `src/osc/osc-listener.js`: `sampleAddresses` array ring → `Set`, frozen at 40 distinct
  addresses (hot path after saturation = two integer ops). Semantics change: first-40-seen instead
  of last-40-seen; `/api/osc/diagnostics` response shape unchanged.
- **F4** — `src/caspar/amcp-client-history.js`: the inline `mkdirSync` + `writeFileSync` before
  every `socket.send` is gone. Ring stays in memory; `data/amcp-last50.txt` is now a debounced
  (1 s, unref'd timer) async fire-and-forget artifact. `flushAmcpHistory` exported;
  `ctx._amcpHistoryFile` overrides the path for tests. Crash loses ≤1 s of tail — acceptable,
  nothing reads the file back.
- **F8** — `.stignore`: added `/projects/_trash` (WARNING in-file: **mirror on the Mac** — the
  entry is git-tracked so it arrives via pull, but Syncthing does not sync `.stignore` itself —
  before deleting any tombstones, or peers push them back, cf. the WO-354 shader fight). No
  tombstones deleted yet; the age/count cap in `retireProjectSlug` remains a follow-up.
- **F3 — VOID as proposed, flag NOT enabled.** Found while wiring it: `osc-state.js:110` does
  `_dirtyChannels.add(ch)` on **every handled message**, with no value comparison — and Caspar
  full-copies every channel's state every tick, so all 8 channels are dirty every 50 ms emit and
  the "delta" payload contains all channels at full size. Net effect of the flag on this box:
  identical bytes, plus the playlist handler (`scene-take-lbg-playlist.js:162`) and every WS
  consumer switch payload shape — risk without reward. (Checked before deciding: the playlist
  handler DOES tolerate delta payloads — channels absent from `snapshot.channels` just no-op —
  and `osc-lifecycle.js:50` keeps the StateManager mirror full regardless. So the flag is *safe*,
  merely useless.) A comment in `.env` records why it is deliberately unset. **F3-revised
  (follow-up):** make dirty-marking value-aware in the leaf writers (`_routeLayer`,
  `_routeMixerAudio`, …); only then does the flag pay. The new smoke deliberately pins today's
  per-message semantics so that change forces a revisit here. Alternative cheap lever if the
  owner accepts 10 Hz meters: `emitIntervalMs` 50 → 100 halves tick work + WS bytes — feel-visible,
  owner's call, not taken unilaterally.

Second tranche, same evening (owner: "ok, continue"):

- **F2** — one snapshot per tick, zero clones in the mirror:
  - `osc-state.js`: `_buildChangePayload` (full mode) uses new `_snapshotNow()` — skips the
    duplicate decay/prune that `_flushEmit` already ran this tick.
  - `osc-lifecycle.js`: the `change` handler reuses the emitted full snapshot for
    `updateFromOscSnapshot` + variables instead of re-deriving `getSnapshot()` (delta payloads
    still re-derive). Consumer chain verified read-only before sharing.
  - `state-manager.js updateFromOscSnapshot`: takes the snapshot **by reference** (each tick
    replaces it wholesale; nothing mutates in place) — the full-mirror deep clone plus per-channel
    audio/layers/outputs clones (20×/s) are gone. Per-tick `_emit('osc'/'audio'/'channels.N')`
    removed after proving all three have no consumers: `getDelta()` (the `_changes` ring's only
    reader) has **zero callers**; no client code reads stateStore paths `osc`/`audio`/
    `channels.N` (client OSC rides the dedicated `'osc'` WS broadcast + `'state'` hydrate);
    the Companion module's bridge consumes only `scene.live`/`scene.deck` change paths
    (`companion-module-highpass-highascg/src/bridge/ws-client.js:101-110`); `oscLayers`/
    `oscProfiler`/`oscOutputs` fields have no readers outside state-manager (kept updated for
    `/api/state` HTTP consumers, reference-shared). INFO-driven `channels.N` emits still fire
    via `_queueInfoChannelWsEmit`. Net: kills clones #1–#4, one WS `change` frame stream, and
    most `_changes` ring churn (part of F7's cost) per tick.
- **F9** — `persistence.js`: IMMEDIATE_KEYS now coalesce through a 25 ms ref'd timer
  (`HIGHASCG_PERSISTENCE_IMMEDIATE_COALESCE_MS`, 0 = old strict write-through) so a take's burst
  of immediate sets does one synchronous write instead of several; any full write clears the
  pending timer; `flush`/`flushSync` semantics unchanged. Plus `HIGHASCG_PERSISTENCE_PRETTY=0`
  in `.env` (machine-read file, ~35 % fewer bytes/write; `python3 -m json.tool` to inspect).
- **F5 — VOID as proposed, not changed.** The relay's `-vf format=yuv420p,scale=W:H` is not
  redundant work the way the research read it: ffmpeg fuses adjacent format/scale into one
  negotiated swscale pass, a conversion is needed regardless (Caspar's mjpeg decodes to
  full-range yuvj), and the `scale` is the guarantee that frame size matches the `-video_size`
  the v4l2 device was set to (dropping it breaks non-1080p channels loudly). The measured 22 %
  is the 1080p50 mjpeg **decode** itself. Real levers, both owner-visible tradeoffs, not taken
  unilaterally: `virtualCamera.fps` 50 → 25/30 (halves Caspar-side encode + relay decode) and/or
  an on-demand lifecycle (run the bridge only while something holds /dev/video10 open).

Third tranche, same evening:

- **F6** — `/api/state` cost split into two fixes after re-attribution (the 4 project-file
  read+parses are ~2 ms of the 43–49 ms; the **whole-state deep clone** in `getState()` — media/
  templates/channels/osc — is the bulk, and the WS slim-bootstrap path even threw the cloned
  catalog away):
  - `state-manager.js`: new `getStateShared()` — fresh top-level object, nested LIVE references,
    documented serialize-only. Field set verified identical to `getState()` (`_state` spread +
    `variables`). `getState()` (deep clone) kept for mutating callers (`scene-native-fill.js`).
  - `get-state.js`: DTO uses `getStateShared()` (verified read-only: media enrichment maps to new
    objects, both branches re-spread `base` before assigning); project envelope loaded ONCE per
    request and passed to `buildSceneDeckForApi(ctx, sharedProjectEnv)` (new optional param,
    `project-scenes-transform.js`) — halves the per-request project reads.
  - `ws-server.js` fallback and `periodic-sync.js fireOscChannelsBlob` → `getStateShared()`
    (both stringify immediately; serialization is synchronous so no torn reads possible).
- **F7** — `osc-variables.js`: per-channel/per-layer variable KEY strings now cached on ctx
  (`_channelVarKeys`/`_layerVarKeys` — keys are derived-only, so caching changes no values), and
  the 16-slot "clear unused meters" sweeps run only when `nb` changes instead of every tick
  (`_oscVarsAudioClearedNb` tracker; setVariable dedupe made the old sweeps no-ops that still
  paid key allocation — ~2.5k wasted string allocs/s). `clearOscVariables` resets both caches so
  an OSC subsystem restart repopulates from scratch. WO-239 clearing semantics unchanged —
  its dedicated smoke passes untouched.

Deliberately NOT taken (reasoning recorded so nobody re-litigates blind):
- **F10/F11** — marginal after F1/F2: JS regex literals are compiled once by V8 (the "re-parsed
  regexes" premise was wrong); the `channels.find` is 64 integer compares/tick and a Map index
  would have to be kept in sync with every other `_state.channels` writer in the file — risk
  outweighs <0.1 % of a core. The unhandled-suffix early-reject remains valid but is bundled
  into F3-revised (value-aware dirty marking touches the same routing layer).
- **F12 + todos item 6 (client)** — implemented later would need `npm run build:client` + kiosk
  reload; parked until post-show.
- **F13** — lsblk cadence is an owner-visible USB-detection-latency tradeoff (~0.5 forks/s is
  tiny); owner call.
- **F14** — feature currently disabled on the box (no `ffmpeg_jpeg` compose-preview mode); fix
  it when/if that mode returns.
- **F15** — touches the live-audio/FFT arg builder (DM3 path, hard-won per WO-354-era history)
  on show night; quiet-day work with owner QA.

## 3. What was VERIFIED

- Research: measurements taken live (see table); F1–F5 re-read in source at the cited lines by the
  main session before the WO was written; F6–F15 carry researcher evidence, re-verify at fix time.
- First wave: new `tools/smoke/smoke-wo401-perf-first-wave.test.js` (F1 saturation + Set hot
  path; F4 no-sync-write + 50-cap + async flush content; F3 void-finding pin: identical message
  twice still dirties the channel, guards the revisit). Added to the curated FILES list.
- Second tranche: same smoke extended to 5 tests — F2 (mirror stores snapshot/audio/oscLayers by
  reference, `_changes` length unchanged across a tick = no dead emits) and F9 (immediate key
  does NOT write synchronously, coalesced write lands compact within the window, `flushSync`
  still synchronous). `smoke-wo251-playlist-osc-wiring` (stubs the lifecycle wiring) re-verified
  green.
- Third tranche: F6/F7 covered by the EXISTING guards — `smoke-wo239-osc-variables.test.js`
  (9 tests: per-layer derivation both OSC lineages, pruned-layer clearing, `type===empty`
  immediate clear, restart tracking reset) passes against the F7 key-cache/clear-tracker rewrite;
  it caught a real `lk` TDZ collision mid-implementation (loop variable shadowing), fixed by
  renaming to `lkeys`. Final full offline suite **1764 pass / 0 fail / 2 skip**;
  `check-max-file-lines` 0 over.
- NOT yet verified live (post-restart owner QA): `/api/state` latency re-measure (expect well
  under 10 ms), `/api/variables` meters still tick, companion variables live, WS state hydrate
  intact on a GUI reload.
- NOT yet verified live: the changed code paths run only after the post-show restart. Owner QA
  after restart: `/api/osc/diagnostics` still returns addresses; `data/amcp-last50.txt` updates
  within ~1 s of AMCP traffic; take feel unchanged/better.
