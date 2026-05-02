# Work Order 06: Multi-Channel Audio Playout Architecture (CasparCG on Ubuntu)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Enable CasparCG Server running on Ubuntu to output **2, 4, 8, or 16 audio channels** through various audio transports beyond DeckLink SDI. Target outputs include:

- **NVIDIA GPU HDMI/DisplayPort** audio
- **Standard 3.5mm analog jack** (onboard/USB audio)
- **Network audio protocols** (Dante via AES67, NDI embedded audio)
- **Professional USB audio interfaces** (multi-channel)

This work order documents the architecture, CasparCG configuration, Linux audio stack setup, and HighAsCG integration for managing these audio outputs.

## Context & Constraints

### CasparCG Audio Architecture
- CasparCG handles audio per-channel via **consumers** (DeckLink, FFmpeg, System Audio, NDI)
- Audio routing within CasparCG: `MIXER` AMCP commands (VOLUME, MASTERVOLUME per layer)
- Channel layouts: `mono`, `stereo`, `matrix` (pass-through), `5.1`, `7.1`, or custom via `<channel-layout>`
- FFmpeg audio filters can be applied per-play: `PLAY 1-10 clip AF "pan=4c|c2=c0|c3=c1"`

### Linux Audio Stack (Ubuntu)
```
CasparCG Process
    │
    ▼ (ALSA / PulseAudio / PipeWire)
┌─────────────────────────────────────────┐
│         PipeWire (recommended)          │
│         or JACK (optional)              │
├─────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ NVIDIA   │ │ Onboard  │ │ USB     │ │
│  │ HDMI/DP  │ │ 3.5mm    │ │ Audio   │ │
│  │ audio    │ │ (ALSA)   │ │ IF      │ │
│  └──────────┘ └──────────┘ └─────────┘ │
└─────────────────────────────────────────┘
    │              │              │
    ▼              ▼              ▼
  Display       Speakers      USB / rack
  (HDMI out)    (monitors)    (mixer/amp)
```

### Protocol Support Matrix

| Transport | Linux Support | Max Channels | Latency | Notes |
|-----------|--------------|--------------|---------|-------|
| **DeckLink SDI** | ✅ Native | 16 (embedded) | <1 frame | Best option, requires hardware |
| **NVIDIA HDMI/DP** | ✅ ALSA driver | 8 (HDMI 2.0) | ~10ms | Via ALSA `hw:N` device |
| **3.5mm analog** | ✅ ALSA native | 2 (stereo) | ~5ms | Onboard or USB |
| **USB audio IF** | ✅ Class-compliant | 2-32 | ~5-10ms | RME, Focusrite, MOTU, etc. |
| **NDI** | ✅ CasparCG native | 16 | ~1 frame | Network, requires NDI receiver |
| **AES67** | ⚠️ Complex setup | 64+ | <1ms | Dante-compatible, needs RAVENNA/AES67 driver |
| **Dante** | ❌ No Linux DVS | 64 | <1ms | Hardware bridge needed (USB-to-Dante) |
| **SoundGrid** | ❌ No Linux support | N/A | N/A | Windows/macOS only for control |
| **JACK Network** | ✅ NetJACK | 32+ | ~5ms | LAN only, open source |
| **PipeWire Network** | ✅ Native | varies | ~10ms | ROC (Real-time Open Codec) |

---

## Tasks

### Phase 1: Linux Audio Stack Setup

- [x] **T1.1** Document ALSA device enumeration
  - `aplay -l` — list all ALSA playback devices
  - `aplay -L` — list all ALSA PCM devices (including virtual)
  - Identify: onboard audio, NVIDIA HDMI/DP, USB audio interfaces
  - Map device names: `hw:N,M` (card N, device M)
  - Document channel capabilities per device
  - **Doc:** [`docs/audio/alsa-device-enumeration.md`](docs/audio/alsa-device-enumeration.md)

- [x] **T1.2** Configure PipeWire for multi-channel routing
  - Install PipeWire + WirePlumber (default on Ubuntu 24.04+)
  - Configure channel mapping in `/etc/pipewire/pipewire.conf.d/`:
    ```
    context.properties = {
      default.clock.rate = 48000
      default.clock.quantum = 256
      default.clock.min-quantum = 64
    }
    ```
  - Create virtual sinks for CasparCG audio routing
  - Tool: `qpwgraph` for visual audio routing
  - Tool: `pw-cli`, `pw-dump`, `pw-top` for monitoring
  - **Doc:** [`docs/audio/pipewire-multichannel-routing.md`](docs/audio/pipewire-multichannel-routing.md)

- [x] **T1.3** Configure JACK as alternative
  - JACK2 installation and setup
  - `jackd -d alsa -d hw:N -r 48000 -p 256 -n 2`
  - Multi-device support via `alsa_in` / `alsa_out` bridges
  - CasparCG → JACK → multiple hardware outputs
  - Tool: `qjackctl` or `Carla` for routing
  - **Doc:** [`docs/audio/jack-audio-routing.md`](docs/audio/jack-audio-routing.md)

- [x] **T1.4** NVIDIA HDMI/DP audio setup
  - Verify NVIDIA driver loaded: `lsmod | grep snd_hda_intel`
  - Find NVIDIA ALSA device: `aplay -l | grep -i nvidia`
  - Test: `aplay -D hw:N,M test.wav`
  - Configure for multi-channel (HDMI supports up to 8ch):
    ```
    # /etc/asound.conf or ~/.asoundrc
    pcm.nvidia_hdmi {
      type hw
      card N
      device M
    }
    ```
  - Note: Some NVIDIA cards expose multiple HDMI outputs as separate ALSA devices
  - **Doc:** [`docs/audio/caspar-outputs-nvidia-stereo-usb.md`](docs/audio/caspar-outputs-nvidia-stereo-usb.md) § NVIDIA

- [x] **T1.5** USB audio interface setup
  - Class-compliant devices work automatically via ALSA
  - Verify: `aplay -l` shows device with correct channel count
  - Configure sample rate match: device rate must match CasparCG channel rate
  - Multi-channel mapping: verify all channels are accessible
  - Recommended interfaces for multi-channel:
    - **RME Digiface USB** (up to 66 channels, class-compliant on Linux)
    - **MOTU UltraLite** (10 out, USB class-compliant)
    - **Focusrite Scarlett 18i20** (20 out, needs firmware mode for UAC2)
  - **Doc:** same as T1.4 — [`docs/audio/caspar-outputs-nvidia-stereo-usb.md`](docs/audio/caspar-outputs-nvidia-stereo-usb.md) § USB (includes **§ 3.5 mm stereo** for simple onboard output)

### Phase 2: CasparCG Consumer Configuration

- [x] **T2.1** System audio consumer (ALSA direct)
  - CasparCG `<system-audio>` consumer in config:
    ```xml
    <consumers>
      <system-audio>
        <channel-layout>stereo</channel-layout>
      </system-audio>
    </consumers>
    ```
  - Maps to default PipeWire/PulseAudio/ALSA sink
  - Limitation: only one `<system-audio>` per channel
  - For specific device: set `PULSE_SINK` or default PipeWire sink
  - **Doc:** [`docs/audio/caspar-audio-consumers.md`](docs/audio/caspar-audio-consumers.md) § T2.1

- [x] **T2.2** FFmpeg consumer for audio-only output
  - Audio-only FFmpeg consumer to specific ALSA device:
    ```xml
    <ffmpeg>
      <path>-f alsa hw:N,M</path>
      <args>-codec:a pcm_s24le -ar 48000 -ac 8</args>
    </ffmpeg>
    ```
  - Alternative: FFmpeg to PipeWire/PulseAudio named sink:
    ```xml
    <ffmpeg>
      <path>-f pulse caspar_audio_bus_1</path>
      <args>-codec:a pcm_s24le -ar 48000 -ac 2</args>
    </ffmpeg>
    ```
  - Can output to multiple sinks from same channel (multiple FFmpeg consumers)
  - **Doc:** [`docs/audio/caspar-audio-consumers.md`](docs/audio/caspar-audio-consumers.md) § T2.2

- [x] **T2.3** NDI consumer for network audio
  - CasparCG NDI consumer already includes embedded audio:
    ```xml
    <ndi>
      <name>CasparCG-Audio-PGM</name>
    </ndi>
    ```
  - NDI receivers on network can extract audio
  - Can be received by DAW, audio mixer, or NDI-to-analog converter
  - Audio channel count matches CasparCG channel layout
  - **Doc:** [`docs/audio/caspar-audio-consumers.md`](docs/audio/caspar-audio-consumers.md) § T2.3

- [x] **T2.4** Dedicated audio-only CasparCG channels
  - Extra channels in CasparCG config for audio bus mixing:
    ```xml
    <!-- Audio-only channels (no video output needed) -->
    <channel>
      <video-mode>PAL</video-mode>
      <channel-layout>16ch</channel-layout>
      <consumers>
        <ffmpeg>
          <path>-f alsa hw:USB_AUDIO</path>
          <args>-codec:a pcm_s24le -ar 48000 -ac 16</args>
        </ffmpeg>
      </consumers>
    </channel>
    ```
  - Route audio from program channels to audio bus via `PLAY` with `route://` source
  - MIXER VOLUME per routed layer for sub-mix control
  - **Doc:** [`docs/audio/caspar-audio-consumers.md`](docs/audio/caspar-audio-consumers.md) § T2.4

- [x] **T2.5** Multi-channel audio layout configuration
  - CasparCG channel layouts for different channel counts:
    | Channels | Layout | Use Case |
    |----------|--------|----------|
    | 2 | `stereo` | Standard L/R |
    | 4 | custom `4ch` | L/R + aux send |
    | 8 | `7.1` or custom `8ch` | Surround or multi-bus |
    | 16 | custom `16ch` | Multi-bus, stems |
  - Custom layout definition in CasparCG config:
    ```xml
    <audio>
      <channel-layouts>
        <channel-layout name="8ch" type="8ch" num-channels="8"
          channel-order="FL FR FC LFE BL BR SL SR"/>
        <channel-layout name="16ch" type="16ch" num-channels="16"
          channel-order="c0 c1 c2 c3 c4 c5 c6 c7 c8 c9 c10 c11 c12 c13 c14 c15"/>
      </channel-layouts>
    </audio>
    ```
  - **Doc:** [`docs/audio/caspar-audio-consumers.md`](docs/audio/caspar-audio-consumers.md) § T2.5

### Phase 3: Network Audio Protocols

- [x] **T3.1** AES67 (Dante-compatible) setup
  - **AES67-compatible Dante devices** can interoperate with Linux
  - Requirements:
    - Dante Controller: enable AES67 mode on Dante devices (Windows/Mac app)
    - Linux side: RAVENNA/AES67 driver or PipeWire AES67 module
  - Option A: **Merging ALSA RAVENNA driver** (commercial, Linux-native)
    - Creates ALSA devices that appear as standard audio I/O
    - Compatible with Dante (via AES67 bridge mode)
  - Option B: **Hardware bridge** (recommended for reliability)
    - Device: RME Digiface Dante (USB class-compliant → Dante)
    - Appears as multi-channel ALSA device on Linux
    - Dante routing managed from Dante Controller on another machine
  - **Doc:** [`docs/audio/network-audio-protocols.md`](docs/audio/network-audio-protocols.md) § T3.1

- [x] **T3.2** NDI audio extraction
  - NDI output from CasparCG → received by external NDI device/app
  - NDI audio tools for monitoring:
    - **NDI Studio Monitor** (Windows/Mac only for monitoring)
    - **ffmpeg with NDI support** on another Linux machine:
      ```
      ffmpeg -f libndi_newtek -i "CASPAR (Channel 1)" -f alsa hw:0
      ```
  - Can also use go2rtc pipeline for audio extraction (WO-05 overlap)
  - **Doc:** [`docs/audio/network-audio-protocols.md`](docs/audio/network-audio-protocols.md) § T3.2

- [x] **T3.3** JACK Network Audio (NetJACK)
  - Native Linux network audio:
    - Server: `jackd` on CasparCG machine
    - Client: `jack_netsource` on receiving machine
  - Low latency LAN audio distribution
  - Up to 32+ channels
  - Free, open source
  - **Doc:** [`docs/audio/network-audio-protocols.md`](docs/audio/network-audio-protocols.md) § T3.3

- [x] **T3.4** PipeWire ROC (Real-time Open Codec)
  - Modern Linux network audio streaming:
    - Sender: `roc-send` on CasparCG machine
    - Receiver: `roc-recv` on destination
  - Supports multi-channel, low latency
  - Part of PipeWire ecosystem
  - **Doc:** [`docs/audio/network-audio-protocols.md`](docs/audio/network-audio-protocols.md) § T3.4

### Phase 4: HighAsCG Integration

- [x] **T4.1** Audio routing configuration in Settings modal (WO-05 integration)
  - **Audio tab** in settings modal:
    ```
    │ Audio    │  Audio Output Configuration                    │
    │          │                                                │
    │          │  Program Audio:                                │
    │          │  Layout:  [Stereo ▾]  [4ch] [8ch] [16ch]      │
    │          │  Output:  [System Default ▾]                   │
    │          │           [NVIDIA HDMI (hw:1,3)]               │
    │          │           [USB Audio IF (hw:2,0)]              │
    │          │           [NDI]                                │
    │          │           [Custom FFmpeg...]                   │
    │          │                                                │
    │          │  ── Extra Audio Channels ──                    │
    │          │  Count: [0 ▾] [1] [2] [4]                     │
    │          │                                                │
    │          │  Audio Bus 1:                                  │
    │          │  Layout: [Stereo ▾]                            │
    │          │  Output: [3.5mm Jack (hw:0,0) ▾]              │
    │          │                                                │
    │          │  ── Monitoring ──                              │
    │          │  Browser audio: [PGM ▾]                        │
    ```
  - **Implemented:** Audio / OSC tab — program layout/output (incl. ALSA list + custom FFmpeg), extra buses, browser monitor; persisted as `audioRouting` in `highascg.config.json` via `/api/settings`.

- [x] **T4.2** AMCP commands for audio management
  - HighAsCG API endpoints for audio control:
    - `POST /api/audio/volume` — set layer/master volume
    - `POST /api/audio/route` — route audio from channel to audio bus
    - `GET /api/audio/devices` — list available audio devices (via shell command)
    - `POST /api/audio/config` — update audio routing config
  - Web UI: audio mixer panel integration with audio bus routing
  - **Implemented:** `GET /api/audio/devices`, `POST /api/audio/config`, `POST /api/audio/volume` (layer or `master`), `POST /api/audio/route` → `501` (configure via generator / Caspar config). Device list works without AMCP (`router.js` before Caspar gate).

- [x] **T4.3** CasparCG config generation for audio
  - Update `config-generator.js` (from WO-02) to include:
    - Audio channel layouts in `<audio>` block
    - Extra audio-only channels with appropriate consumers
    - FFmpeg/NDI consumers with correct audio encoding
    - System audio consumer when selected
  - Generate valid CasparCG config XML with audio routing
  - **Implemented:** `mergeAudioRoutingIntoConfig` in `src/config/config-generator.js` maps Settings `audioRouting` to flat keys; `<system-audio/>` when “System audio”; FFmpeg/NDI consumers; `<audio><channel-layouts>` for `live-8ch`, `4ch`, `16ch` when used.

- [x] **T4.4** Audio device detection script
  - `src/audio/audio-devices.js` (≤200 lines)
  - Parse `aplay -l` output for available ALSA devices
  - Parse `pw-cli list-objects` for PipeWire sinks
  - Return structured list: `{ id, name, type, channels, sampleRates }`
  - Expose via `GET /api/audio/devices`
  - Cache with periodic refresh
  - **Implemented:** `src/audio/audio-devices.js` — `aplay -l`, optional `pw-cli list-objects Node`, 30s cache, `GET /api/audio/devices`.

### Phase 5: Documentation & Guides

- [x] **T5.1** Create audio setup guide
  - Step-by-step for each output type:
    1. NVIDIA HDMI/DP audio on Ubuntu
    2. USB audio interface setup
    3. AES67/Dante bridge configuration
    4. NDI audio routing
    5. PipeWire multi-channel routing
  - Troubleshooting: common issues, diagnostic commands
  - **Doc:** [`docs/audio/audio-setup-guide.md`](docs/audio/audio-setup-guide.md) (consolidated index + links to Phase 1–3 deep dives)

- [x] **T5.2** Create audio routing reference
  - CasparCG MIXER audio commands cheat sheet
  - Channel layout definitions
  - Multi-bus routing diagrams
  - FFmpeg audio filter examples for channel mapping
  - **Doc:** [`docs/audio/audio-routing-reference.md`](docs/audio/audio-routing-reference.md) (MIXER table, layouts, mermaid bus diagram, AF examples)

---

## Recommended Audio Setup Configurations

### Setup A: Simple Stereo (3.5mm or HDMI)
```xml
<channel>
  <video-mode>1080p5000</video-mode>
  <consumers>
    <system-audio/>
    <decklink><device>1</device></decklink>
  </consumers>
</channel>
```
- System audio → default sink (3.5mm or HDMI)
- DeckLink → SDI with embedded audio

### Setup B: Multi-Channel USB Interface (8ch)
```xml
<channel>
  <video-mode>1080p5000</video-mode>
  <channel-layout>8ch</channel-layout>
  <consumers>
    <decklink><device>1</device><embedded-audio>true</embedded-audio></decklink>
    <ffmpeg>
      <path>-f alsa hw:USB_AUDIO</path>
      <args>-codec:a pcm_s24le -ar 48000 -ac 8</args>
    </ffmpeg>
  </consumers>
</channel>
```
- SDI out with video + audio
- USB audio interface receives 8 discrete channels

### Setup C: Network Audio (NDI + AES67)
```xml
<channel>
  <video-mode>1080p5000</video-mode>
  <channel-layout>16ch</channel-layout>
  <consumers>
    <decklink><device>1</device><embedded-audio>true</embedded-audio></decklink>
    <ndi><name>CasparCG-PGM</name></ndi>
  </consumers>
</channel>
<!-- Audio bus to Dante via USB bridge -->
<channel>
  <video-mode>PAL</video-mode>
  <channel-layout>16ch</channel-layout>
  <consumers>
    <ffmpeg>
      <path>-f alsa hw:RME_DANTE</path>
      <args>-codec:a pcm_s24le -ar 48000 -ac 16</args>
    </ffmpeg>
  </consumers>
</channel>
```
- SDI out + NDI (with 16ch audio embedded)
- Dante via USB-to-Dante hardware bridge for 16 discrete channels to audio network

### Setup D: NVIDIA HDMI + Monitoring
```xml
<channel>
  <video-mode>1080p5000</video-mode>
  <consumers>
    <decklink><device>1</device></decklink>
    <ffmpeg>
      <path>-f alsa hw:NVidia,3</path>
      <args>-codec:a pcm_s16le -ar 48000 -ac 2</args>
    </ffmpeg>
  </consumers>
</channel>
```
- DeckLink SDI for main output
- NVIDIA HDMI for confidence monitor with embedded audio

---

## Important Notes

> ⚠️ **Dante Virtual Soundcard does NOT work on Linux.** Audinate has no Linux support. Use AES67 mode on Dante devices + hardware bridge (USB-to-Dante) or RAVENNA driver.

> ⚠️ **SoundGrid (Waves) has NO Linux support** for control software or drivers. The SoundGrid server itself runs custom Linux internally, but cannot interface with standard Linux applications.

> 💡 **Best universal approach for 16ch audio:** CasparCG → FFmpeg consumer → USB class-compliant multi-channel audio interface (e.g., RME Digiface USB). This gives you direct ALSA access to 16+ channels with no network protocol overhead.

> 💡 **For Dante integration:** Use a USB-to-Dante hardware interface (RME Digiface Dante, Audinate AVIO USB adapter). It appears as a standard ALSA device on Linux while providing Dante on the network side.

---

## Work Log

*(Agents: add your entries below in reverse chronological order)*

### 2026-04-04 — Agent (Phase 5 T5.1–T5.2 documentation guides)
**Work Done:**
- [`docs/audio/audio-setup-guide.md`](docs/audio/audio-setup-guide.md): single entry point for all five output paths (NVIDIA, USB, AES67/Dante, NDI, PipeWire), “before you start”, troubleshooting table, diagnostic commands, HighAsCG `audioRouting` pointer.
- [`docs/audio/audio-routing-reference.md`](docs/audio/audio-routing-reference.md): MIXER `VOLUME` / `MASTERVOLUME` cheat sheet, HighAsCG `POST /api/audio/volume`, layout summary table, mermaid PGM→bus→consumer diagram, FFmpeg `AF` / `pan` examples.

**Status:**
- **T5.1**–**T5.2** complete (documentation).

**Instructions for Next Agent:**
- WO-06 is complete through Phase 5; optional follow-ups: `GET /api/settings` without Caspar (`--no-caspar`), or dedicated mixer panel wired to `/api/audio/*`.

### 2026-04-04 — Agent (Phase 4 T4.1–T4.4 HighAsCG integration)
**Work Done:**
- **T4.4:** [`src/audio/audio-devices.js`](src/audio/audio-devices.js) — ALSA + PipeWire discovery, cache; [`src/api/routes-audio.js`](src/api/routes-audio.js); [`src/api/router.js`](src/api/router.js) routes before Caspar gate where appropriate.
- **T4.2:** `POST /api/audio/volume`, `POST /api/audio/config`, `GET /api/audio/devices`, `POST /api/audio/route` (501 stub).
- **T4.1 / persistence:** [`config/default.js`](config/default.js) `audioRouting`; [`src/api/routes-settings.js`](src/api/routes-settings.js); [`web/components/settings-modal.js`](web/components/settings-modal.js) + [`web/lib/settings-state.js`](web/lib/settings-state.js).
- **T4.3:** [`src/config/config-generator.js`](src/config/config-generator.js) `mergeAudioRoutingIntoConfig`, `<system-audio/>`, extended `<audio>` layouts; [`src/config/config-modes.js`](src/config/config-modes.js) `4ch`/`16ch` channel counts.
- **Fix:** [`index.js`](index.js) `buildConfig` streaming merge (`resolveStreamingConfig(cfg.streaming)`) — removed undefined `appSettings` reference.

**Status:**
- **T4.1**–**T4.4** complete (code). Mixer UI “hooks” beyond settings are minimal; dedicated mixer panel can subscribe to same APIs later.

**Instructions for Next Agent:**
- **Phase 5** guides (T5.1–T5.2) or optional: `GET /api/settings` without Caspar for `--no-caspar` workflows; mixer panel wiring.

### 2026-04-04 — Agent (Phase 3 T3.1–T3.4 network audio doc)
**Work Done:**
- [`docs/audio/network-audio-protocols.md`](docs/audio/network-audio-protocols.md): AES67 / Dante vs Linux (no DVS, bridges, ALSA), NDI audio monitoring + FFmpeg/go2rtc notes, NetJACK server/client + firewall note, ROC `roc-send`/`roc-recv`, cross-links to JACK and consumer docs.

**Status:**
- **T3.1**–**T3.4** complete (documentation).

**Instructions for Next Agent:**
- **Phase 4** HighAsCG integration (T4.1–T4.4) or **Phase 5** consolidated guides (T5.1–T5.2).

### 2026-04-04 — Agent (Phase 2 T2.1–T2.5 Caspar consumers doc)
**Work Done:**
- [`docs/audio/caspar-audio-consumers.md`](docs/audio/caspar-audio-consumers.md): `<system-audio>` + `PULSE_SINK`; FFmpeg **`<ffmpeg-consumer>`** / ALSA & Pulse; NDI embedded audio; audio-only channels + `route://`; `<audio><channel-layouts>` table; note on HighAsCG `buildAudioLayoutsXml` / generator. Cross-link from [caspar-outputs-nvidia-stereo-usb.md](docs/audio/caspar-outputs-nvidia-stereo-usb.md).

**Status:**
- **T2.1**–**T2.5** complete (documentation).

**Instructions for Next Agent:**
- **Phase 3** network audio (T3.1–T3.4) or **Phase 4** HighAsCG integration (T4.x) / **Phase 5** guides (T5.1–T5.2).

### 2026-04-04 — Agent (T1.3 JACK routing doc)
**Work Done:**
- [`docs/audio/jack-audio-routing.md`](docs/audio/jack-audio-routing.md): `jackd2`/`qjackctl` install, ALSA backend `jackd -R -d alsa -d hw:N -r 48000 -p 256 -n 2`, `alsa_in`/`alsa_out` multi-device notes, exclusive `hw` vs Caspar, PipeWire JACK compatibility, troubleshooting.

**Status:**
- **T1.3** complete. **Phase 1** (T1.1–T1.5) documentation complete.

**Instructions for Next Agent:**
- **Phase 2** Caspar consumers: **T2.1** system-audio, **T2.2** FFmpeg, etc.

### 2026-04-04 — Agent (T1.4 / T1.5 NVIDIA · stereo · USB)
**Work Done:**
- [`docs/audio/caspar-outputs-nvidia-stereo-usb.md`](docs/audio/caspar-outputs-nvidia-stereo-usb.md): focused guide — **NVIDIA HDMI/DP** (`snd_hda_intel`, `aplay`, `hw:N,M`, `asound` alias, multi-channel, multi-display), **3.5 mm onboard stereo** (analog identification, stereo Caspar + FFmpeg / system-audio vs default sink), **USB interfaces** (class-compliant, rate/channel match, `speaker-test`, recommended gear, FFmpeg XML example). Cross-link from [alsa-device-enumeration.md](docs/audio/alsa-device-enumeration.md).

**Status:**
- **T1.4** and **T1.5** complete (shared doc; 3.5 mm covered explicitly).

**Instructions for Next Agent:**
- **T1.3** JACK alternative doc, or Phase 2 Caspar consumers (T2.x).

### 2026-04-04 — Agent (T1.2 PipeWire routing doc)
**Work Done:**
- [`docs/audio/pipewire-multichannel-routing.md`](docs/audio/pipewire-multichannel-routing.md): packages, `pipewire.conf.d` clock/quantum drop-in, virtual sinks via `pactl`/null-sink for Caspar buses, `qpwgraph` / `pw-cli` / `pw-dump` / `pw-top`, ALSA vs Pulse paths for Caspar FFmpeg, troubleshooting.

**Status:**
- **T1.2** complete.

**Instructions for Next Agent:**
- **T1.3** JACK alternative documentation (or Phase 1 T1.4 / T1.5).

### 2026-04-04 — Agent (T1.1 ALSA enumeration doc)
**Work Done:**
- [`docs/audio/alsa-device-enumeration.md`](docs/audio/alsa-device-enumeration.md): `aplay -l` / `aplay -L`, interpreting card/device, `hw:N,M`, identifying onboard vs NVIDIA HDMI vs USB, channel probing (`speaker-test`, `/proc/asound/cards`), mapping checklist for Caspar FFmpeg consumers.

**Status:**
- **T1.1** complete.

**Instructions for Next Agent:**
- Superseded by T1.2 entry above.

### YYYY-MM-DD — Agent Name
**Work Done:**
- (describe what was completed)

**Status:**
- (which tasks were completed)

**Instructions for Next Agent:**
- (what needs to happen next, any blockers or decisions needed)

---
*Work Order created: 2026-04-04 | Parent: 00_PROJECT_GOAL.md*
