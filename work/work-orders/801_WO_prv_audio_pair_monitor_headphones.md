# WO-801 — PRV audio: monitor individual pairs on headphones (not only the mix-down)

**Area:** audio
**Status: DONE (29.10, live e2e on the box) (29.10) — investigated, designed, built offline (server + Godot picker, tests green); live check + owner headphone QA open (see "Live checks for the next round") · live e2e 29.10: HP pair picker PASS on ch7 (3+4/1+2/5+6/7+8/Mix, journal ok each, PGM/PRV consumers unchanged); follow-up: ~4 s xrun burst after one switch (7+8, 20:16:35.90)**

Owner, 29.10:
> prv channel is always 2audio ch due to either possibility of only one multi audio channel or to make it cheaper. but now when previewing a look with multi audio ch i get a mix down and no way to prv via monitor headphones individual audio pairs.

## Problem

- The PRV channel is built with **2 audio channels** (stereo). A look that carries several stereo pairs
  (for example 8 ch = four pairs: 1+2, 3+4, 5+6, 7+8) is folded to one stereo mix on PRV.
- The owner cannot audition a single pair on the headphones before taking it.
- The source is there: PGM is the full multi-channel channel; the look's layers carry the pairs.

## Investigation to do (agent to fill, file:line)

- Where PRV is built: the PRV channel's `audio` channel count and its consumer (search `prv` /
  `preview` in `src/` and `caspar/` config generation).
- Monitor output path: how the headphone output is chosen today (`config/audio_outputs.json`,
  `config/audio_routing.json`, `src/` monitor / ALSA device code) and whether a PortAudio consumer
  can take a pair selection.
- WO-683 (one PortAudio output next to Enhanced OAL): Caspar's PortAudio is global, so only one PortAudio
  output works. Headphones and the switcher share that constraint — the design must not add a second PortAudio
  consumer.
- WO-249 (`AUDIO-PAIR-PGM2`): the streaming/record bus already has a "Source-audio-pair" dropdown with an
  ffmpeg `pan=` — reuse the same pair concept.

## Options

**A — Monitor pair select on the PRV channel (preferred if the channel can carry 8 ch).**
- PRV carries the full channel audio; the monitor consumer gets a pair selector (1+2, 3+4, …) that
  picks which pair goes to the headphone device.
- Cost: PRV channel count changes (the owner chose 2 ch to save cost) — CPU/decoder cost to measure.

**B — Route-based pair monitor (keeps PRV at 2 ch).**
- A separate monitor channel `route://` from the look's layers, one per pair the owner selects; only the
  selected pair is routed to the headphone output. Costs one extra channel while monitoring.

Pick A if the cost check is fine, else B.

## Acceptance

- Previewing a look with 8 ch audio: the owner can choose pair 3+4 and hear only that pair on headphones.
- PRV tile and program outputs unchanged; no second PortAudio consumer; WO-683 invariant holds.
- Verify on the box with the monitor headphones (owner QA) and with a probe of the monitor device's levels.

## Owner decisions needed

1. Is PRV at 8 ch acceptable (cost) — or route-based B?
2. Which device is the headphone monitor (ALSA hw name)?

## Owner decisions (defaults taken 29.10 — the owner can overrule)

1. **Neither "PRV at 8 ch" nor B: the PRV channel is not changed, and the pair is picked at the headphone output.**
   Default taken because the measurements below show that PRV already carries every channel of the look, so
   "PRV at 8 ch" costs nothing and changes nothing; the mix-down happens only in the headphone consumer.
   - PRV cost today vs "8 ch": **0**. This Caspar build gives every channel 16 audio channels
     (`core/video_format.h:106 audio_channels = 16`); the `<channel-layout>` we write into `casparcg.config` is not
     read by Caspar at all (no `channel-layout` string in `shell/` or `core/`). INFO 2 (PRV) on the box: 16 `<volume>`
     per channel + 16 per audible layer; `GET /api/osc/audio/2` → `nbChannels: 16`.
   - Pair picker cost (one ffmpeg consumer with `pan=` instead of the OAL consumer, same channel): **0.10 s CPU per
     20 s of audio (≈0.5 % of one core, incl. process start)**, measured with the system ffmpeg (the same
     `libavformat.so.62` / `libavdevice.so.62` Caspar links) piping 16 ch → `pan=stereo|c0=c2|c1=c3` → the ALSA
     output device at real time. The OAL-style 16 → stereo downmix measured 0.12 s / 20 s. No extra channel.
   - B cost: one more Caspar channel per monitored pair. The existing monitor channel (ch 7, the same shape B
     would add) measured **1.2 % (channel-7 thread) + 0.1 % (stage 7) of one core over 10 s** on the box, plus a
     720p50 GPU mixer pass — and B **still cannot isolate a pair**: `route://` takes no audio filter
     (`route_producer.cpp:281-310` parses only `BACKGROUND` / `NEXT` / `BUFFER`), and a routed frame keeps the source
     channel's interleaved 16 ch (`audio_mixer.cpp:~150-205` sums without remapping). B would need the same
     consumer-side `pan=` on top of its extra channel.
2. **Headphone monitor = Sennheiser SC60 USB headset, card 2 `Lync` (`hw:2,0`), through the box-local 48 kHz plug PCM
   `sc60mon`** (`~/.asoundrc`, WO-406). It is already the monitor bus device (`config/audio_outputs.json` row
   `audio_2`: `system-audio`, `deviceName: sc60mon`, `role: monitor`) → Caspar monitor channel 7
   `<system-audio><device-name>sc60mon`. `aplay -l` / `/proc/asound/cards`: card 0 PCH ALC1220 (`hw:0,0`, main out),
   card 1 NVidia HDMI/DP PCMs `hw:1,3/7/8/9` (WO-779: display outputs, not the headphones), card 2 Sennheiser
   SC60 for Lync (`hw:2,0`, S16_LE, 2 ch, 8–48 kHz, `Status: Running` = held by Caspar's OAL now). The picker reads
   the device from the monitor bus config — nothing is hard-coded.

## Investigation (29.10, read-only on the box)

**Where PRV is built.** `src/config/config-generator-consumer-attach-screen.js:209` builds the PRV channel; it writes
no `<channel-layout>` (live `config/casparcg.config` ch 2: `<consumers></consumers>`, no layout), PGM ch 1 has
`discrete-8ch`. That looks like "PRV is 2 ch", but Caspar ignores both:
- `~/caspar-build/src-v2/src/core/video_format.h:106` — `int audio_channels = 16;` for every channel (upstream
  "feat: 16 channel audio #395", commit 28c4dcd41). Nothing in `shell/server.cpp` parses `<channel-layout>`.
- `modules/ffmpeg/util/av_util.cpp:107-130` — a decoded frame's audio is copied **discretely** into the 16 slots
  (source channel j → slot j, the rest zero; no rematrix). An 8 ch look on PRV is 8 discrete channels in the PRV mixer.
- `core/mixer/audio/audio_mixer.cpp:~105-205` — the channel mix sums the 16 interleaved slots per layer.

**Where the mix-down happens.** The headphone output is the monitor channel (WO-406,
`src/config/config-generator-audio-xml.js:416-445` `buildMonitorChannelXml`): live ch 7, 720p5000, one
`<system-audio><device-name>sc60mon</device-name></system-audio>` consumer (INFO 7: `port_500 system-audio`).
The OAL consumer (`modules/oal/consumer/oal_consumer.cpp:203-215, 257-262`) builds an swr context from
`av_channel_layout_default(16)` (hexadecagonal) to stereo and downmixes every frame — FL/BL/SL… to L, FR/BR/SR… to R,
centre/back-centre to both. That is the owner's "mix-down": pair 3+4 = slots 2/3 = FC (both sides) + BL (left).
Offline proof with the same matrix (`lv16.wav`, c0/c1 −0.9 dB, c2 −6 dB, c3 −12 dB, c4–c7 DC 0.9):
`pan=stereo|c0=c2|c1=c3` → L −6.02 dB / R −12.04 dB (exactly c2/c3); the 16 → stereo default downmix → L −10.0 /
R −9.9 dB (everything folded together).

**What feeds the monitor.** `POST /api/audio/solo` (`src/api/routes-audio.js:300-360`) plays `route://<ch>[-<layer>]`
on the monitor channel's solo layers; no solo = the default route `route://<PRV>` (`src/config/audio-preview.js:60-85`,
`defaultSource: preview_1`). `POST /api/audio/monitor-source` (`routes-audio.js:252-297`) plays one source. Both are
`route://` into a channel that is also 16 ch, so the routed audio arrives intact; only the consumer folds it.

**Pair selection options inside Caspar (no C++):**
- MIXER has no per-channel gain / channel select (WO-249: none in `AMCPCommandsImpl.cpp`).
- `route://` takes no `AF` (above). **WO-174's `routeSourceAudio` pan on route PLAYs is therefore a no-op on this
  build** (`scene-take-lbg-jobs.js:198` adds `AF pan=…` to a `PLAY … route://`; the route factory ignores it) —
  recorded here, not fixed in this WO.
- PortAudio has a channel map but is global and single (WO-683) and already the main out — not usable.
- **The ffmpeg consumer can write to ALSA.** `modules/ffmpeg/ffmpeg.cpp:115` `avdevice_register_all()`; the deployed
  binary links `libavdevice.so.62` → `libasound.so.2`. `ffmpeg_consumer.cpp:545-555` takes `-format <muxer>`; the
  `alsa` muxer has `video_codec NONE` (no video branch, `:561`) and `audio_codec pcm_s16le` (the SC60's native
  S16_LE). `-filter:a <spec>` becomes the audio stream's filter graph (`:123-130`, suffix `:a`). A path with a colon
  is not treated as a media file (`:527-540` `prot_exp "^.+:.*"`), so the device is named `plug:sc60mon`.
  Offline: `ffmpeg … -f alsa plug:null` rc 0; `-f alsa plug:sc60mon` → "cannot open audio device plug:sc60mon
  (**Device or resource busy**)" (name resolves; the SC60 is single-open and held by the OAL consumer) vs an unknown
  PCM → "No such file or directory".
- **Consequence: the two consumers must swap, never coexist.** Port numbers: OAL `index() = 500`
  (`oal_consumer.cpp:328`); AMCP `ADD <ch>-<port>` / `REMOVE <ch>-<port>` address one port
  (`AMCPCommandsImpl.cpp:476-517`; `output.cpp:64-80` replaces an occupied port). A realtime STREAM consumer that fails
  to open retries by itself (1 s, doubling, `ffmpeg_consumer.cpp:457-460, 740-800`); the OAL consumer opens its
  device in its constructor (`oal_consumer.cpp:81-103`), so `ADD … AUDIO` fails at once while the device is still busy.
- Clock: OAL `has_synchronization_clock() = true`; the ffmpeg consumer false. Without OAL the monitor channel runs on
  its own timer (as PRV does today — it has no consumer clock either); the SC60 playback endpoint is ADAPTIVE
  (`/proc/asound/card2/stream0`), so it follows the host's data rate. A slow drift would show as a rare dropped frame
  (`dropped-frame` tag) — owner QA listens for it.

**Live drift seen while reading (not this WO's):** the node's channel map says `audioPreviewCh: 6` /
`programAudioLayouts: [stereo, stereo]`, while the running `casparcg.config` has the monitor on ch 7 and PGM 1
`discrete-8ch` (a DeckLink input still on ch 6). The node config changed after the last Apply (another agent is on
WO-805 Devices Apply). The picker therefore refuses a channel that has neither the OAL port nor its own port (below).

## Design

- **One global "headphone pair" for the monitor output**: `mix` (today's OAL downmix, unchanged) or `1+2 … 15+16`.
  It applies to whatever the monitor plays — PRV by default, or the solo'd strips — so "preview a look, pick 3+4"
  works and a solo'd 8 ch layer can be auditioned per pair too.
- **Server** `src/audio/monitor-pair.js`: pair → `ADD <mon>-730 STREAM plug:<monitor device> -format alsa -filter:a
  pan=stereo|c0=c<a-1>|c1=c<b-1>` after `REMOVE <mon>-500` (OAL). `mix` → `REMOVE <mon>-730` then `ADD <mon>-500 AUDIO
  [DEVICE_NAME <dev>]` with retries (250/500/1000/2000 ms) while ALSA lets go. Port 730 sits in the internal 7xx range
  (compose 701, v4l2 710/711, meter-null 720). The pan string comes from the shared pair table
  (`routeSourceChannelsToAudioFilter(pair, '16ch')`, WO-174/249).
  Guard: `INFO <mon>` must show `port_500` or `port_730`; otherwise 409 ("Apply the Caspar config first") — no
  consumer is touched on a channel the node only thinks is the monitor.
- **State**: `monitorPair` in the server's audio console state (`src/audio/mixer-state.js`, persisted, broadcast as
  the existing `audioMixer` change); absent = `mix`, so the existing mixer GET shape is unchanged for `mix`.
- **API**: no new route (router.js is at 500 lines and in WO-805's hands): `POST /api/audio/monitor-source
  { pair }` (no `source`) sets the pair; `{ source, pair }` does both. Reply `{ ok, pair, monitorCh, commands }`.
- **Reconnect**: `setupAllRouting` (Caspar connect / restart) re-asserts a stored pair: a restarted Caspar comes
  back with only the OAL port from the config, so a stored `3+4` is re-applied; `mix` touches nothing.
- **Godot**: the PRV master strip on the Audio tab (the strip whose SOLO sends PRV to the headphones — the
  "PRV mix-down" path today) gets a compact `HP` picker under SOLO: `HP Mix`, `HP 1+2`, `HP 3+4`, … (pairs up to the
  widest program bus, at least 4, at most 8). Shown only when the node has a monitor channel (`channelMap.audioPreviewCh`).
  The value is the server's `audioMixer.monitorPair`; a failed POST puts the picker back.
- Not changed: PRV and PGM channels and their consumers, the solo / monitor-source routing, PortAudio (WO-683
  invariant holds — the new consumer is ffmpeg/ALSA, not PortAudio), `casparcg.config` generation.

## What was done (29.10, offline — nothing live touched)

- `src/audio/monitor-pair.js` (new): pair table, AMCP lines (`pairCommands` / `mixCommands`), `monitorChannel`
  (audio-preview bus, else the monitor bus), `applyMonitorPair` (INFO guard → swap → restore the OAL consumer on any
  failure so the headphones are never left silent) and `reassertMonitorPair`. Why a consumer swap and not a channel:
  Caspar already carries all 16 discrete channels on the monitor channel; only the OAL consumer downmixes, so
  choosing the pair *at the consumer* costs nothing on PRV/PGM and needs no config or Caspar restart.
- `src/audio/mixer-state.js`: `monitorPair()` / `setMonitorPair()`; `snapshot()` adds `monitorPair` only when not
  `mix` (keeps the WO-604 `{gains, muted, solos}` shape).
- `src/api/routes-audio-monitor-pair.js` (new) + `src/api/routes-audio.js`: `POST /api/audio/monitor-source {pair}`
  (400 bad pair · 409 no headphone consumer on the channel · 502 Caspar refused · 503 no AMCP); stored and broadcast
  only after Caspar took it.
- `src/config/routing-setup.js`: end of `setupAllRouting` re-applies a stored pair after a Caspar (re)connect.
- Godot: `features/audio/audio_actions.gd` (pairs / text / request), `audio_strip.gd` (`HP` OptionButton under the
  PRV master's SOLO, `monitor_pair_selected`), `audio_console_ctl.gd` (POST + status "Headphones: …"),
  `audio_tab.gd` (picker only on PRV masters, only when `channelMap.audioPreviewCh` exists; shows the stored pair),
  `core/demo/demo_extras.gd` (simulated server answers the pair).
- Tests: `tools/smoke/smoke-wo801-monitor-pair.test.js` (7, registered in `tools/ci/offline-test-files-2.js`),
  `godot/client/tests/test_audio_monitor_pair.gd`, GUI e2e `godot/client/e2e/scenarios/08_audio_monitor_pair.gd`
  (`tools/e2e/run-gui-e2e.js` seeds the PGM/PRV destination for it; the scenario turns audio preview on for PRV 1
  itself via `POST /api/settings`. Seeding audio preview at sandbox boot instead left 07_pixel_map's channel list empty
  in 2 of 3 runs, so it is set after 07).
- Side finding (not fixed): WO-174's `routeSourceAudio` pan on `route://` PLAYs is a no-op — `route_producer.cpp:281-310`
  takes no `AF` filter.

## Verified

Offline (29.10):
- `node --test tools/smoke/smoke-wo801-monitor-pair.test.js`: 7/7.
- `node tools/ci/run-offline-tests.js`: 3604 tests, 3602 pass, 0 fail, 2 skipped (baseline 3575/0/2 + other agents' new files).
- Godot `run_tests.gd`: 22804 passed, 1 failed — the failure is `test_wo805_apply_timeout` (WO-805 work in flight:
  `core/api.gd` `request_timeout`), not WO-801. The audio suites alone (monitor pair, actions, demo server, tab split):
  244/0.
- `check-max-file-lines.js`: 0 over 500. eslint clean on all touched JS.
- GUI e2e `node tools/e2e/run-gui-e2e.js --e2e=08_audio_monitor_pair`: 3/3 — picker on PRV 1 Master (HP Mix, 1+2 … 7+8),
  pick HP 3+4 against the simulated Caspar (no port 500 in its INFO) → 409, footer "Headphones: Caspar channel 2 has
  no headphone consumer … Apply the Caspar config first", picker back on HP Mix, server keeps no `monitorPair`.
  Also `--e2e=02_outputs,07_pixel_map,08_audio_monitor_pair`: 20/0 (08 after the scenarios that reset audio routing).
  Shots: `$OUT/shots/0{1..4}_08_audio_monitor_pair_*.png` (02 = the open list).
  The success path (swap + store) is proven by the smoke only, not on a real Caspar.

NOT yet verified: anything on the real Caspar / SC60 — see below.

## Live checks for the next round

Read-only first, then one owner-present headphone test. `<mon>` = the node's monitor channel
(`curl -s :4200/api/state | jq .channelMap.audioPreviewCh`).
1. **Drift first**: node map says `<mon>` = 6, the running `casparcg.config` has the monitor on ch 7. `INFO <mon>` must
   show `<port_500>` (OAL). If not, Apply the Caspar config (Devices) before anything else — the picker refuses with 409
   until then.
2. Preview an 8 ch look on PRV 1 (or SOLO a multi-ch strip) — the monitor plays `route://<prv>`.
3. Pick **HP 3+4** on the PRV master. Expect: `INFO <mon>` shows `<port_730>` (ffmpeg, `plug:sc60mon`, `pan=stereo|c0=c2|c1=c3`)
   and no `<port_500>`; `cat /proc/asound/card2/pcm0p/sub0/status` = RUNNING; journal
   `[Audio] monitor pair 3+4 on ch <mon>: ok`; no ALSA / ffmpeg errors in the Caspar log; the owner hears only 3+4.
4. Step 1+2 → 5+6 → 7+8: each switch < ~0.5 s of silence, no stuck device ("device busy" in the Caspar log = the
   250 ms release wait is too short).
5. **HP Mix**: `<port_500>` back, `<port_730>` gone, full downmix audible.
6. PRV and PGM untouched: `INFO <prv>` / `INFO <pgm>` consumer lists identical before/after; no PortAudio consumer added.
7. Restart Caspar with a pair stored: journal `[Audio] monitor pair 3+4 re-applied: ok`, `<port_730>` back.
8. Listen 2 min on a pair for clicks / dropouts (the ffmpeg ALSA consumer has no sync clock; OAL had one). If it drifts
   or clicks, that is the next issue to file.

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**PASS.** "Audio test 8ch" was staged on PRV 1 (ch2). On the Audio tab, SOLO on the PRV 1 Master puts route://2 on
the monitor ch7 (SC60 headset = card 2). Then the HP pair picker:

| Pick | Journal `[Audio] monitor pair N on ch 7: ok` | ch7 consumer |
|---|---|---|
| 3+4 | 20:16:05.56 | port_730 ffmpeg `pan=stereo\|c0=c2\|c1=c3` |
| 1+2 | 20:16:26.10 | port_730 |
| 5+6 | 20:16:31.00 | port_730 |
| 7+8 | 20:16:35.86 | port_730 |
| Mix | 20:20:09.83 | port_500 (system-audio) back |

- Each switch is REMOVE → ADD with a gap of about 250 ms. `/proc/asound/card2/pcm0p/sub0/status` stays RUNNING, and its
  owner is a casparcg thread (Tgid 1195230).
- The footer reads "Headphones: pair 3+4 only." while 3+4 is picked.
- The PGM/PRV consumer lists are identical before and after (cons801_pre.txt / cons801_post.txt). Un-soloed afterwards.

### Follow-up — xrun burst after a pair switch (not fixed)
- **Pair 7+8, 20:16:35.90 → ~20:16:40:** a burst of `ALSA buffer xrun` at about 50/s, lasting about 4 s, right after
  the switch (journal line 20:16:35.86).
- **Pair 5+6, 20:16:31.04:** one xrun after the switch.
- **After that:** 0 xruns over 2 min 10 s (20:16:41 → 20:18:51) on 7+8. The PCM stayed RUNNING
  (hw_ptr 6321504 / appl_ptr 6321600).
- **Suspect:** the new ffmpeg consumer opens card 2 before the old one has released its period backlog. Worth a look:
  pre-fill or a short start-threshold on the new consumer, or a 1-period overlap.

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).
