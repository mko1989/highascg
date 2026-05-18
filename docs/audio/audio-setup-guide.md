# Audio setup guide (CasparCG on Ubuntu)

Single entry point for **multi-channel playout**: follow one path below, then use [Audio routing reference](./audio-routing-reference.md) for MIXER / `route://` / FFmpeg mapping details.

**Related:** WO-06 Audio playout · Phase 5 (T5.1)

| Topic | Deep dive |
|-------|-----------|
| List ALSA devices | [ALSA device enumeration](./alsa-device-enumeration.md) |
| NVIDIA HDMI/DP, 3.5 mm, USB | [Caspar outputs: NVIDIA, stereo, USB](./caspar-outputs-nvidia-stereo-usb.md) |
| Consumers in `casparcg.config` | [Caspar audio consumers](./caspar-audio-consumers.md) |
| AES67, Dante bridges, NDI tools, NetJACK, ROC | [Network audio protocols](./network-audio-protocols.md) |
| PipeWire sinks / graph | [PipeWire multi-channel routing](./pipewire-multichannel-routing.md) |
| JACK alternative | [JACK audio routing](./jack-audio-routing.md) |

---

## Before you start

1. **Sample rate:** Caspar channels typically run at **48 kHz**; FFmpeg `-ar 48000` and hardware must agree.
2. **Layout vs hardware:** `channel-layout` on the channel (and any custom names in `<audio><channel-layouts>`) must match what you send with **`-ac`** and what the sink can play.
3. **Find `hw:N,M`:** `aplay -l` (see enumeration doc). HighAsCG can list devices via **`GET /api/audio/devices`** when the app runs on the same machine as Caspar.

---

## 1. NVIDIA HDMI / DisplayPort

**Goal:** Send program audio over the GPU’s digital audio device (often **2–8 channels** on one link).

1. Confirm driver: `lsmod | grep snd_hda_intel` (see [§1.1](./caspar-outputs-nvidia-stereo-usb.md#11-verify-kernel-audio-stack)).
2. Map the connector: `aplay -l | grep -iE 'nvidia|hdmi|display'` → note **card** and **device** → `hw:N,M`.
3. Test: `aplay -D hw:N,M /usr/share/sounds/alsa/Front_Center.wav` (or any short WAV).
4. Multi-channel: `speaker-test -D hw:N,M -c 8` if you need to validate **>2ch** (see enumeration doc).
5. Caspar: add **FFmpeg consumer** with `-f alsa hw:N,M` and `-ac` / codec matching your layout, or **`<system-audio/>`** if the default desktop sink should follow HDMI (less deterministic on headless servers).

**Also read:** [§1.6 — HDMI/DP into a video switcher](./caspar-outputs-nvidia-stereo-usb.md#16-hdmi--displayport-into-a-video-switcher-embedded-audio-as-main-output) (embedded audio into switchers that de-embed / bridge to Dante).

---

## 2. USB audio interface

**Goal:** Class-compliant **multi-channel** output (often **8–32+** channels).

1. Plug in the interface; `aplay -l` should show the product name on a **USB** card.
2. Match **rate** and **channel count** to the device spec (see [§3](./caspar-outputs-nvidia-stereo-usb.md#3-usb-audio-interface)).
3. Probe channels: `speaker-test -D hw:N,M -c 8` (adjust `-c`).
4. Caspar: **FFmpeg consumer** `-f alsa hw:N,M` with `-codec:a pcm_s16le` or `pcm_s24le`, `-ar 48000`, `-ac N`.

**Dante on the network:** Linux has **no** Dante Virtual Soundcard; use a **USB–Dante hardware bridge** or AES67 mode — [Network audio protocols § T3.1](./network-audio-protocols.md).

---

## 3. AES67 / Dante bridge

**Goal:** Get audio into a Dante domain without DVS on Linux.

1. Prefer a **hardware bridge** (e.g. USB interface with Dante ports): it appears as **ALSA** on Linux; route Caspar FFmpeg to `hw:N,M` like any USB device.
2. **AES67 mode** on Dante endpoints: configure in **Dante Controller** (Windows/Mac), then use a **Linux AES67/RAVENNA** stack or PipeWire module as described in [§ T3.1](./network-audio-protocols.md).

---

## 4. NDI (network)

**Goal:** Send video + **embedded audio** to the LAN.

1. Enable **NDI consumer** on the Caspar channel; set `<name>` uniquely ([§ T2.3](./caspar-audio-consumers.md#t23--ndi-consumer-network-video--embedded-audio)).
2. Downstream: NDI Studio Monitor, FFmpeg with `libndi_newtek`, or hardware — [§ T3.2](./network-audio-protocols.md).

---

## 5. PipeWire multi-channel routing

**Goal:** Virtual sinks, graph routing, or ROC — when a single `hw:` device is not enough.

1. Install **PipeWire** + **WirePlumber** (default on recent Ubuntu).
2. Optional: drop-in **clock/quantum** under `/etc/pipewire/pipewire.conf.d/` ([PipeWire doc](./pipewire-multichannel-routing.md)).
3. Create **null-sinks** or named sinks for each Caspar “bus”; point Caspar FFmpeg to **`-f pulse sink_name`**.
4. Use **`qpwgraph`** to verify edges from Caspar’s process to the right sink.

---

## Troubleshooting

| Symptom | Things to check |
|---------|-------------------|
| **No sound** | Wrong `hw:N,M`; cable/port; monitor/switcher input selected; `PULSE_SINK` / default sink for `<system-audio/>`. |
| **Only 2 channels work** | Layout is `stereo` but you need `8ch` / custom; HDMI EDID limits; `-ac` too small. |
| **Crackle / xruns** | Increase buffer (`-buffer_size` in FFmpeg args, or PipeWire quantum); avoid competing exclusive `hw` users. |
| **Device busy** | Another app holds ALSA `hw` exclusively; use Pulse/PipeWire path or stop the other app. |
| **Dante not in OS** | Expected on Linux without a bridge — use AES67 + Linux stack or USB–Dante hardware. |

### Diagnostic commands

```bash
aplay -l
pactl list short sinks          # PipeWire/Pulse sinks
pw-cli list-objects Node       # PipeWire nodes (best-effort)
speaker-test -D hw:N,M -c N
```

---

## HighAsCG settings

Application **Settings → Audio / OSC** stores **`audioRouting`** (program layout, ALSA/NDI/system/custom FFmpeg, extra buses). The **config generator** merges this into flat Caspar keys — see `src/config/config-generator.js` (`mergeAudioRoutingIntoConfig`).
