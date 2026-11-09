# WO-1016 — Which Devices settings can the running Caspar take live, and which really need a restart
**Area:** devices-config, caspar-build
**Status: IN PROGRESS (09.11)**

Owner, 09.11 (verbatim):
> i also want you to do a check against current version of casparcg server and see which of the settings from device
> tab can be created dynamically at once and which actually need a restart.

Owner follow-up, 09.11 (verbatim):
> but doesnt caspar allow dynamic channels when they are standard video mode?

Research only. No code was changed in HighAsCG or in Caspar.

## Investigation

### Answer to the follow-up: no runtime channel add or remove exists, for any video mode

The mode only decides whether an EXISTING channel can switch to it live (`SET MODE`). It never decides whether a channel
can be created.

- **One code path creates channels:** `setup_channels` at startup. The only `channels_->emplace_back` in the tree is
  `src/shell/server.cpp:300`, reached from `start()` (`:128-152`).
- **AMCP has no channel command:** the full registry (`src/protocol/amcp/AMCPCommandsImpl.cpp:1878-1960`) has no channel
  ADD/REMOVE/CREATE. `ADD`/`REMOVE` (`:499-541`) add and remove consumers on a channel that already exists.
- **Upstream doesn't have one either:**
  - `upstream/master` (newest commit `fe19ac0e3`, 2026-10-15) has the same single startup `emplace_back`
    (`server.cpp:332`) and the same command set. `git grep` over `upstream/master`, `enhanced/main` and `origin/master`
    finds no channel-creation command.
  - `git log --all -i --grep` for "dynamic channel", "add channel", "channel add", "runtime channel", "create channel"
    and "new channel" finds no commits.
- **Live probe:** `POST /api/amcp/raw {"cmd":"CHANNEL ADD 1080p5000"}` → `COMMAND_UNKNOWN_DATA`. `INFO` afterwards still
  showed the same 8 channels.
- **What "standard video mode" does change** is `SET <ch> MODE <id>` on an existing channel (`AMCPCommandsImpl.cpp:575-588`):
  - Standard modes are always in the format repository, so they always work.
  - A custom mode works only if it was declared in `<video-modes>` at boot (`server.cpp:180-254`). Live:
    `SET 8 MODE 1234x567` → `403`.
- **Smallest patch:** `CHANNEL ADD <mode-id> [8|16] [bt709|bt2020]`, append-only, so existing numbers never shift. About
  80-120 lines:
  1. Move the per-channel body of `setup_channels` (`server.cpp:262-300`) into a `make_channel(format, depth, colour_space)`.
     Expose it to AMCP through a hook on `amcp_command_static_context`, the same way `shutdown_server_now` is exposed.
  2. Guard `channels_` (`server.cpp:110`) with a `shared_mutex`, or at least `reserve()` it at startup so it never
     reallocates. Today it is read without a lock:
     - by command parsing (`amcp_command_repository.cpp:153,199`);
     - by every batch (`AMCPCommandQueue.cpp:135-139` iterates all channels);
     - by every `ctx.channels->at()`.
  3. Grow the per-connection channel queues lazily. `AMCPProtocolStrategy.cpp:99-106` creates one queue per channel when
     a connection opens, and dispatch is `commandQueues_.at(channel_index + 1)` (`:221`). Without this, node's
     already-open connection cannot address the new channel until it reconnects.
  4. The new command itself is about 30 lines.
- **Removal is extra:** `CHANNEL REMOVE` (last channel only, refused while a `route://` from it is live) adds about
  40 lines and is the riskier half. Parking an unused channel (no consumers, `CLEAR`) is the safe alternative.
- **Modes:** any mode already registered works, standard or boot-declared custom. A new custom size also needs
  `VIDEO-MODE ADD` (P-c in §4).

### 0. What was read, and what runs

- **Caspar:** `~/caspar-build/src-v2`, branch `highascg-main`, HEAD `2476644c4`. The box runs exactly this commit:
  `VERSION` → `2.5.1 2476644c4 Stable`. Paths below are relative to `src/`.
- **HighAsCG:** the Devices ▸ Apply path, the generator `src/config/config-generator*.js`, the runtime ADD/REMOVE
  callers, and the Godot Devices inspectors (`godot/client/features/devices/*_controls.gd`, `*_model.gd`).
- **Today's Apply:** it writes the XML and restarts Caspar whenever the text differs
  (`src/api/routes-caspar-config.js:146`).
  - The unchanged gate is `src/utils/full-config-apply.js:213-233` (WO-337).
  - The Godot button bypasses that gate: it always posts `{force:true}` (`godot/client/features/devices/cable_gesture.gd:420`).
    This is the owner's WO-440 rule, "Apply should ALWAYS restart caspar".
  - So every Devices Apply is a full restart today. WO-805 measured it at about 13-16 s, 8-9 s of which is Caspar's
    relaunch.

### 1. How Caspar is built up, and what can change later

- **Startup is one pass:** `shell/server.cpp:128-152` runs `setup_video_modes` → `setup_channels` → modules → consumers and
  producers from XML → `setup_controllers` → `setup_osc`. Nothing re-reads the config afterwards:
  - `env::properties()` is loaded once (`common/env.cpp:87-104`).
  - `INFO CONFIG` (`protocol/amcp/AMCPCommandsImpl.cpp:1712-1723`) prints that boot tree back. It is not live state.
  - `RESTART` (`:1765-1769`) only exits with code 5 (`shell/main.cpp:272-273`), and run.sh relaunches. There is no
    config-reload command.
- **The AMCP command set** (`AMCPCommandsImpl.cpp:1878-1960`) has no command that creates or removes a channel, and none
  that adds a video mode. These are what can change at runtime:

| Command | What it changes live | Evidence |
|---|---|---|
| `ADD ch[-idx] <consumer> …` | Builds a consumer from AMCP params, then `output.add(idx)`. `add()` first REMOVEs the same index, so an ADD to an occupied index replaces that consumer | `AMCPCommandsImpl.cpp:499-514`, `core/consumer/output.cpp:64-72` |
| `REMOVE ch-idx` / `REMOVE ch <params>` | Drops a consumer by index, or by the index its params would produce | `AMCPCommandsImpl.cpp:516-541` |
| `APPLY ch-idx …` | A call into a running consumer. Only the screen consumer implements it (`SLICES SET/CLEAR`, WO-869) | `:476-497`, `modules/screen/consumer/screen_consumer.cpp:1228-1342`, `core/consumer/frame_consumer.h:56` |
| `SET ch MODE <id>` | Changes the channel format. The id must already be in the format repository | `:575-588` |
| `LOG LEVEL [lvl]` | Sets the global log level | `:559-573` |
| `OSC SUBSCRIBE/UNSUBSCRIBE port` | Adds an OSC target, but only at the calling AMCP client's own IP, and only for that connection's lifetime | `:1845-1876` |
| `CHANNEL_GRID` | Takes over the LAST channel with a screen and a route grid. Not usable for HighAsCG's multiview | `:1544-1584` |
| `DIAG` | Opens Caspar's diagnostics window. Not a config tool | `:1746-1750` |
| `MIXER …`, `PLAY/LOAD … route:// / DECKLINK / NDI / SHM / [HTML]` | All layer and producer state, live as always | — |

- **`SET MODE` caveats** (`AMCPCommandsImpl.cpp:575-588`):
  - `stage::video_format_desc()` runs `layers_.clear()` (`core/producer/stage.cpp:418-428`). Every layer on the channel
    goes black.
  - On the next tick `output` re-`initialize`s every consumer (`core/consumer/output.cpp:112-127`):
    - The screen consumer destroys and recreates its window (`screen_consumer.cpp:1319-1327`).
    - DeckLink reopens its device (`modules/decklink/consumer/decklink_consumer.cpp:1169-1176`).
    - FFmpeg streams restart their encoder.
  - Routes taken FROM the channel keep the old `format_desc` (`core/video_channel.cpp:216`, upstream TODO). So routes
    from it should be re-PLAYed.
  - Live: `SET 8 MODE 1234x567` → `403 SET FAILED`, and ch 8 was untouched (still 1080p5000, `layer_1` intact). A new
    custom size therefore needs a restart.
- **Video modes are fixed at startup:** `setup_video_modes` (`server.cpp:180-254`) is the only writer of
  `video_format_repository::store`.
  - A runtime adder would also have to respect two sizes taken at startup:
    - every image mixer's `max_frame_size` (`accelerator/accelerator.cpp:31`, max of the registered modes × 2 bytes);
    - the static empty-frame buffer (`accelerator/ogl/image/image_mixer.cpp:97`). It is sized from that max, and a
      bigger mode would read past its end.
- **Channels are fixed at startup:**
  - They are created only in `setup_channels` (`server.cpp:256-304`), into
    `spl::shared_ptr<std::vector<channel_context>> channels_` (`server.cpp:110`).
  - That vector is read without a lock by every AMCP command (`protocol/amcp/amcp_command_repository.cpp:153,199`,
    `ctx.channels->at()`).
  - AMCP addresses channels by position, so removing one in the middle renumbers everything after it.
  - Colour depth and colour space are fixed per channel when the image mixer is created (`server.cpp:262-289`).
- **Consumer factories: XML vs AMCP.** The XML startup path and AMCP `ADD` use different factories
  (`core/consumer/frame_consumer_registry.cpp:156-197`). Where the AMCP one parses fewer options, the setting cannot go
  live:

| Consumer | Default index | AMCP `ADD` takes | XML-only (no AMCP equivalent) | Evidence |
|---|---|---|---|---|
| screen | 600 + device (+10 key-only) | device (`SCREEN n`, **0-based**; XML `<device>` is 1-based), `NAME`, `X`, `Y`, `WIDTH`, `HEIGHT`, `BORDERLESS`, `FULLSCREEN`, `KEY_ONLY`, `SBS_KEY`, `NON_INTERACTIVE`, `GPU` | `always-on-top`, `vsync`, `stretch`, `aspect-ratio`, `colour-space`, `force-linear-filter`, `enable-mipmaps`, `<slices>` (but live over APPLY), 16-bit channels (AMCP throws) | `screen_consumer.cpp:1385-1437` vs `:1440-1574`; index `:1357` |
| decklink | 300 + device | device, `INTERNAL_KEY`/`EXTERNAL_KEY`/`DISABLED_KEY`, `FULL_DUPLEX`/`HALF_DUPLEX`, `LOW_LATENCY`, `EMBEDDED_AUDIO`, `KEY_ONLY` | `video-mode` (output format ≠ channel), `pixel-format`, `buffer-depth`, `color-space`, `wait-for-reference`, `<subregion>`, `<ports>`, `key-device`/`external_separate_device`, `hdr-metadata` | `decklink/consumer/config.cpp:190-226` vs `:35-188`; index `decklink_consumer.cpp:1190` |
| ndi | 900 | `NAME`, `ALLOW_FIELDS`, `USE_ADVERTISER`, `ALLOW_MONITORING`, `BUFFER_SIZE`, `DISCOVERY_SERVER` | — (full parity) | `newtek/consumer/newtek_ndi_consumer.cpp:333-375`; index `:313` |
| system-audio (OAL) | 500 | `AUDIO`/`SYSTEM-AUDIO` `DEVICE_NAME` | — (full parity) | `oal/consumer/oal_consumer.cpp:427-445`; index `:418` |
| portaudio | 501 | nothing | nothing either: both factories ignore their arguments; every setting is the GLOBAL `configuration.portaudio.*` | `portaudio/consumer/portaudio_consumer.cpp:997-1015`, `:629-642` |
| ffmpeg (stream/file) | 100000 + crc16(path) | `STREAM`/`FILE` path + args | `realtime` | `ffmpeg/consumer/ffmpeg_consumer.cpp:838-866`; index `:470-473,829` |
| shm | 740 | `NAME` | — | `shm/consumer/shm_consumer.cpp:177-199`; index `:125` |
| artnet (pixel-map) | 1337 | **no AMCP factory** | everything | `artnet/artnet.cpp:36` |
| pixel | 1000 | **no AMCP factory** | everything | `pixel/pixel.cpp:29-30` |

- **Global sections, read once:**
  - `html.*`: `modules/html/html.cpp:187,248,251,341` and `accelerator/ogl/util/device.cpp:120` (CEF GPU, debug port).
  - `ndi.auto-load`: `newtek/newtek.cpp:48`.
  - `ffmpeg.producer.*`: read per new producer, from the frozen tree (`ffmpeg/producer/av_producer.cpp:300-327`).
  - `paths`: `env::configure`.
  - `controllers`: `server.cpp:432-470`.
  - `osc.*`: `server.cpp:306-342`.
  - `lock-clear-phrase` and `amcp.media-server`.
- **Elements HighAsCG writes that this build never reads:** a grep over `src/` finds no reader for any of these:
  - `<channel-layout>` (per channel, and inside DeckLink);
  - `<mixer><audio-osc>`;
  - the screen's `<high-bitdepth>` (derived from the channel depth instead);
  - the root `<system-audio>`;
  - every per-channel `<portaudio>` child (`src/config/config-generator-audio-xml.js:275-305`), since PortAudio reads
    only the root block (`:315-337`).

  Changing any of these restarts Caspar for nothing.
- **Side finding (from source; not seen live, because no channel has two NDI outputs today):**
  - An XML consumer's index is its type default, and `output.add` replaces an existing index.
  - So two `<ndi>` on one channel (`src/config/config-generator-consumer-attach-screen.js:162-183`, the per-screen NDI
    plus the NDI stream outputs) leave only the LAST sender running.
  - The same happens for several RTMP `<ffmpeg>` blocks with path `-` on one channel (`src/config/rtmp-output.js:57`).
  - Needs its own WO.

### 2. What HighAsCG already does live (outside Apply)

Runtime consumers, confirmed live in `INFO <ch>` on 09.11:
- **Static consumers:** `1-740 shm opgui` and `2-600 screen` come from the XML.
- **Runtime consumers:** `3..8-720 ffmpeg udp://127.0.0.1:520NN` are meter-null consumers added over AMCP.

None of the runtime consumers appear in `INFO CONFIG`.

| Live today | AMCP | Where |
|---|---|---|
| Stream/RTMP and record outputs | `ADD ch-97 STREAM …`, `ADD ch-96 FILE …` | `src/api/routes-streaming-channel-rtmp.js:156`, `routes-streaming-channel-record.js:93` |
| Monitor/headphone device (OAL ↔ ALSA pair) | `REMOVE ch-500` / `ADD ch-730 STREAM … -format alsa`, `ADD ch-500 AUDIO DEVICE_NAME` | `src/audio/monitor-pair.js:82-96` |
| Meters, FFT, Zoom audio, compose preview, v4l2 bridge | `ADD ch-720/9276/9277/701/710/711 STREAM …` | `src/audio/meter-null-consumer.js:106`, `fft-channel-source.js:51`, `src/zoom/zoom-audio.js:39`, `src/preview/compose-preview-consumer.js`, `src/virtual-output/v4l2-bridge-consumer.js` |
| Shared-memory video surfaces | `ADD ch-74x SHM NAME role` | `src/system/video-surfaces.js:120-124` |
| DeckLink input device | `STOP` + `MIXER CLEAR` + `PLAY ch-l DECKLINK n` | `src/api/host-live-layer.js:40`, `src/config/routing-setup-decklink-inputs.js:124` |
| Live audio input device | WO-166 | — |
| Host-live content (webpage URL, NDI source, Zoom ring) | `PLAY ch-l [HTML] … / NDI / SHM NAME` | `src/config/host-live-sources.js:366-371`, `host-live-sources-zoom.js:91` |
| Screen slices / mapping | `APPLY ch-idx SLICES SET …` | `src/config/mapping-slices-windows.js:74-77` |

### 3. Verdict per Devices setting

Verdicts:
- **LIVE:** works over AMCP now, with no Caspar change.
- **CAVEAT:** live, but with a visible cost.
- **RESTART:** needs a Caspar restart in this build.
- **PATCH:** could be live with a Caspar patch (§4).

| Devices setting | Ends up in | Verdict | How / why |
|---|---|---|---|
| Channel count, add/remove a screen, multiview, operator GUI, DeckLink/ALSA/v4l2 input, extra-audio, monitor bus, dedicated streaming channel | `<channels>` (allocation order: `src/config/routing-map.js:206-346`) | **RESTART** (PATCH, medium) | Channels are only created in `setup_channels`; AMCP has no channel add. Inserting in the middle renumbers every later channel (positional AMCP). |
| Host-live channels (webpage / NDI / browser / Zoom host) | pinned `<channel>` + PLAY | **RESTART** to add or remove the channel. **LIVE** for content | The channel is RESTART-class. With no patch, the way out is a layer on an existing host channel: `route://ch-layer` exists, and per-layer audio meters (WO-800) replace the per-channel VU. This is WO-1012 B2's approach for Zoom. |
| Operator-first / channel order | channel numbering | **RESTART** | Numbering is positional. |
| Channel video mode → a mode already registered (standard, or a custom id in the boot `<video-modes>`) | `<video-mode>` | **CAVEAT** | `SET ch MODE id`. It clears every layer, re-inits every consumer (window recreated, DeckLink reopened) and leaves stale route formats. HighAsCG must re-ADD screens with the new size, re-PLAY routes and re-take looks (WO-1013 restore). PGM and PRV change together. |
| Channel video mode → a new custom WxH/fps | `<video-modes>` + `<video-mode>` | **RESTART** (PATCH, small) | Confirmed live: `SET 8 MODE 1234x567` → `403`. |
| Channel colour depth (v210 / 16-bit), colour space | `<color-depth>`, `<color-space>` | **RESTART** | The image mixer depth is fixed at channel creation (`server.cpp:262-289`). |
| Screen consumer on/off, device/port, X/Y, width/height, borderless, windowed/fullscreen, key-only, SBS key, interactive, name | `<screen>` | **CAVEAT** | `ADD ch-600 SCREEN <dev-1> X … Y … WIDTH … HEIGHT … BORDERLESS [NON_INTERACTIVE] [KEY_ONLY] GPU NAME …`. It replaces index 600 in one command, and the window is recreated (a blip). Re-send `APPLY … SLICES` afterwards. Confirmed live on ch 8 (below). |
| Screen always-on-top, stretch, aspect ratio, colour space (datavideo), linear filter, mipmaps | `<screen>` children | **PATCH** (small) | Not parsed by AMCP `create_consumer` (`screen_consumer.cpp:1385-1437`). |
| Screen V-sync | `<vsync>` | n/a | Always off by policy (WO-716/995). The AMCP default is already `false` (`screen_consumer.cpp:111`). |
| Mapping slices on a screen window | `<slices>` | **LIVE** (already) | `APPLY ch-640+k SLICES SET/CLEAR`. |
| X11 / xrandr / OS mode, EDID, NVIDIA sync to display | xrandr, `apply-layout.sh`, caspar-env `__GL_SYNC_DISPLAY_DEVICE` | not a Caspar config. GL sync is **RESTART** | xrandr is applied live by node; a canvas grow needs nodm. GL sync is process environment, which is why WO-440 forced the restart. |
| DeckLink output: device, keyer, low latency, embedded audio, key-only | `<decklink>` | **CAVEAT** | `ADD ch-300+n DECKLINK n EXTERNAL_KEY LOW_LATENCY EMBEDDED_AUDIO`. The device reopens with a preroll gap. When a DeckLink joins or leaves, the channel's clock changes (it has a sync clock; `output.cpp:213-224`). |
| DeckLink output: SDI format ≠ channel, pixel format (yuv/v210), buffer depth, colour space, subregion, ports, key on a separate device (`key-device`), wait-for-reference | `<decklink>` children | **PATCH** (small) | AMCP parser `config.cpp:190-226`. Fill+key on two devices can be done as two AMCP consumers (fill `EXTERNAL_KEY` on n, `KEY_ONLY` on n+1), the same as the generator's split today (`src/config/decklink-key-fill.js:320-332`). |
| DeckLink "Channel layout" | `<channel-layout>` | **never needs a restart** | Ignored by Caspar. |
| DeckLink input: device | `PLAY ch-l DECKLINK n` | **LIVE** (already) | A new input is a new channel (RESTART, WO-53). |
| NDI output add/remove/rename (per screen, NDI stream outputs) | `<ndi>` | **LIVE** | `ADD ch-9xx NDI NAME x` / `REMOVE ch-9xx`. Use distinct indices: the XML default 900 collides (side finding). Confirmed live on ch 8. |
| NDI auto-load | `<ndi><auto-load>` | **RESTART** | Read at module init. |
| System-audio (OAL) output device | `<system-audio><device-name>` | **LIVE** | `ADD ch-500 AUDIO DEVICE_NAME "hw:2,0"` (replaces 500); monitor-pair.js already does this. |
| PortAudio outputs (device, channels, buffer, latency, host API) | root `<portaudio>` (per-channel children are ignored) | **RESTART** (PATCH, small) | The settings are global and read when the consumer is constructed. `ADD ch PORTAUDIO` exists, but only with the boot settings. |
| Destination "Audio outputs" layout (stereo/…) | `<channel-layout>` | **never needs a restart** | Ignored by Caspar. It matters only to HighAsCG's own audio routing. |
| Streaming / record / RTMP outputs | runtime ADD (or `<ffmpeg>` in attach mode) | **LIVE** (already) | WO-81 / WO-172. |
| Pixel-map (Art-Net) wall | `<artnet>` | **RESTART** (PATCH, small) | No AMCP factory. |
| OSC target (host/port), default port, send-to-AMCP-clients | `<osc>` | **RESTART** (local target: CAVEAT) | `OSC SUBSCRIBE port` reaches only the AMCP client's own IP, while that connection lives. Node could resubscribe on every connect. |
| CEF GPU, CEF debug port | `<html>` | **RESTART** | CEF and the GL device are initialised once. |
| Log level | `<log-level>` | **LIVE** | `LOG LEVEL debug` (read live: `INFO`). |
| Paths, controllers (5250), lock phrase, media-server, ffmpeg threads | fixed by the generator | **RESTART** | Not editable in Devices. |

**Live checks on 09.11.** All through `POST /api/amcp/raw`, on channel 8, consumer indices 777/778 only:
- **Screen:**
  - `ADD 8-777 SCREEN 0 NAME wo1016probe X 0 Y 0 WIDTH 64 HEIGHT 36 BORDERLESS NON_INTERACTIVE` → `202 ADD OK`.
    `INFO 8` then showed `port_777 screen`, name `wo1016probe`, 93 frames presented.
  - An x11grab of :0 showed the 64x36 borderless window at 0,0.
  - `APPLY 8-777 SLICES CLEAR` → `202 APPLY OK`. `REMOVE 8-777` → `202 REMOVE OK`. The window was up for 1.94 s.
- **NDI:** `ADD 8-778 NDI NAME wo1016probe` → `202`, with the state echoing the name and `buffer_size 16`.
  `REMOVE 8-778` → `202`.
  - The `INFO 8` taken straight after the REMOVE still listed `port_778`, because output state refreshes on the next
    tick (`output.cpp:206-211`). The next INFO was clean.
  - So any verification has to poll at least one frame later.
- **SET MODE:** `SET 8 MODE 1234x567` → `403 SET FAILED`; channel 8 was unchanged.
- **Read-only:** `VERSION`, `INFO`, `INFO 1..8`, `INFO CONFIG`, `LOG LEVEL`.
  - `INFO CONFIG` re-serialises the boot tree with different whitespace. For example, the generator's
    `<x>2048</x><y>0</y>` comes back on two lines, and `<consumers></consumers>` comes back as `<consumers/>`.
  - So any diff must be semantic (parsed XML), never text.
- **Not tested live:** `SET MODE` (it would clear ch 8's Zoom layer); DeckLink, OAL and PortAudio ADDs (they take
  hardware or would be audible); OSC SUBSCRIBE (global). These rest on source reading.

**Observed while reading (not acted on):** the generated config differs from the running one.
- It now has 10 channels: a Screen 3 PGM/PRV pair at 7680x2160 inserted as ch 5/6, the inputs moved to 7/9, the Zoom
  host still pinned at 8, and the monitor bus at 10.
- The running Caspar has 8 channels.
- The next Apply is RESTART-class whatever rule is used.

### 4. Caspar patches that would widen the live set (size is a rough estimate)

| # | Patch | Where | Size | Unlocks |
|---|---|---|---|---|
| P-a | `ADD ch-idx XML <consumer element>`: parse an inline fragment (base64 or quoted) and call the existing preconfigured factory | `AMCPCommandsImpl.cpp:499` + `frame_consumer_registry.cpp:182` | ~50 lines | Every consumer option the XML has: screen always-on-top/stretch/aspect/colour/mipmaps/slices, all DeckLink options, artnet, pixel, ffmpeg realtime. One generator output then serves both boot and live. |
| P-b | Screen AMCP flags (`ALWAYS_ON_TOP`, `STRETCH`, `ASPECT_RATIO`, `COLOUR_SPACE`, `MIPMAPS`, `LINEAR_FILTER`) | `screen_consumer.cpp:1385-1437` | ~25 lines | Same for screens only, if P-a is not wanted. |
| P-c | `VIDEO-MODE ADD id w h timescale duration [cadence]`; refuse sizes above the startup max | `AMCPCommandsImpl.cpp` + `video_format.cpp:175` | ~40 lines | A custom screen size followed by `SET MODE`. |
| P-d | Refresh `route->format_desc` on SET MODE | `core/video_channel.cpp:216` | ~15 lines | Routes stay correct after a mode change. |
| P-e | PortAudio per-consumer params (AMCP and XML) | `portaudio_consumer.cpp:629-642,997-1015` | ~40 lines | Live PortAudio device changes; more than one PortAudio output. |
| P-f | `OSC SUBSCRIBE port [address]` | `AMCPCommandsImpl.cpp:1845-1862` | ~10 lines | Remote OSC targets live (still tied to the connection). |
| P-g | `CHANNEL ADD mode [depth] [colour-space]`, append-only, plus `CHANNEL REMOVE` of the last channel only | `server.cpp:256-304`, `amcp_command_repository.cpp` (unlocked `channels_` → reserve at startup + guard) | ~80-120 lines for add, plus ~40 for remove of the last channel (detail at the top of this WO); thread safety is the risk | Host-live / input / screen channels without a restart, but only when appended. Any renumbering stays RESTART. A zero-patch alternative is a few parked spare channels (64x36, no consumers; idle cost is small, since the mixer is skipped without consumers, `video_channel.cpp:163`), claimed with `SET MODE` + PLAY + ADD. |

### 5. Proposal: Apply diffs first and restarts only when it must

**The rule.**
1. Generate the new XML.
2. Parse it and the last-applied baseline into normalised trees, stripping comments and whitespace.
   - The baseline is the casparcg.config Caspar booted from, plus the live ops applied since.
   - `INFO CONFIG` alone is not enough: it never reflects live changes. The existing WO-919 comparison
     (`src/engine/project-activate.js:216`) would otherwise report "misaligned" after every live apply.
3. Drop the elements Caspar ignores (§1).
4. **Restart** if any changed path is RESTART-class:
   - channel count or order;
   - a channel's depth or colour space;
   - a video-mode id that is not yet registered;
   - `osc`, `html`, `ndi`, `paths`, `controllers`, `ffmpeg` or the root `portaudio`;
   - a consumer type without AMCP parity (artnet, pixel; DeckLink or screen XML-only options until P-a/P-b);
   - a process-environment change (GL sync).
5. **Otherwise apply live:** per channel, `REMOVE` the indices that disappeared and `ADD ch-<same idx>` the changed or
   new consumers, then send `SET MODE` (with re-route and re-take), `LOG LEVEL` and `APPLY SLICES`.
6. Verify with `INFO ch` one tick later, write the file, and fall back to a restart on any failure.

**Priority order.**
1. **No Caspar patch.** Gives the biggest share of everyday edits:
   - ignored-element changes become "no restart";
   - NDI add/remove/rename;
   - system-audio device;
   - log level;
   - screen geometry, port, borderless, key and interactive (one window blip);
   - DeckLink output device, keyer, latency and embedded audio (preroll gap).
2. **P-a (or P-b).** Makes every remaining consumer option live, including all DeckLink options and pixel-map.
3. **P-c + P-d + the `SET MODE` path.** Resolution changes go from about 13 s to about 1 s plus the re-take.
4. **Host-live sources as layers on an existing channel** (WO-1012 B2), rather than P-g. Only build P-g or spare
   channels if new channels must appear live.

**Owner decision needed:** WO-440 says Apply ALWAYS restarts. The live path would need either a separate action
("Apply live") or the owner's consent to make live-first the default, with "Apply & restart" kept as the forced path.

## What was done

- Read the Caspar source on `highascg-main`, the generator, the apply path and the runtime AMCP callers.
- Ran the read-only queries and the ch-8 probes listed in §3.
- Wrote this WO.
- Nothing was implemented.

## What was verified

**Confirmed live on 09.11** (via `/api/amcp/raw`, ch 8, indices 777/778, each removed within 2 s):
- AMCP `ADD SCREEN` honours `X`/`Y`/`WIDTH`/`HEIGHT`/`BORDERLESS`/`NAME` (screenshot), and `APPLY SLICES` reaches a
  live-added screen.
- `ADD`/`REMOVE NDI` work live.
- `SET MODE` refuses an unregistered custom mode without side effects.
- The running build equals the source read (`2476644c4`).
- `INFO CONFIG` is the re-serialised boot file.
- The runtime consumers listed in §2 are present.

**From source only:**
- `SET MODE`'s layer clear, consumer re-init and route staleness.
- The DeckLink, OAL and PortAudio factory behaviour.
- That channels and video modes cannot be added at runtime.
- The ignored elements.
- The NDI/RTMP index collision.

**Open:** owner decision on WO-440 versus a live-first Apply; whether to file the NDI index collision and the
ignored-element cleanup as their own WOs.
