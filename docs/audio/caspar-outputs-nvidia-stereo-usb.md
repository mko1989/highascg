# CasparCG audio outputs on Linux: NVIDIA, 3.5 mm stereo, USB

Practical guide for the three most common **local** playout paths on Ubuntu:

1. **NVIDIA GPU** — HDMI / DisplayPort embedded audio (often **up to 8 channels** on one link). On many installs this is the **main** multi-channel program output, not only a local monitor feed—see §1.6.
2. **3.5 mm jack** — onboard **stereo** analog (headphones / line out).
3. **USB audio interface** — class-compliant **multi-channel** (2–32+ outputs depending on hardware).

**Prerequisite:** know how to read `aplay -l` and map **`hw:N,M`** — see [ALSA device enumeration](./alsa-device-enumeration.md). For PipeWire routing, see [PipeWire multi-channel routing](./pipewire-multichannel-routing.md).

**Context:** WO-06 Audio playout

---

## Quick pick

| Goal | Typical ALSA clue (`aplay -l`) | Caspar channel layout | FFmpeg consumer hint |
|------|--------------------------------|----------------------|----------------------|
| **Monitor / TV** over HDMI | `NVidia`, `HDMI`, `DP` | `stereo` … `8ch` (HDMI 2.0 often **8ch** capable) | `-f alsa hw:N,M` + `-ar 48000` `-ac 2` … `8` |
| **Switch / router** (HDMI/DP → de-embed / Dante / buses) | Same — cable to switcher input | `stereo` … `8ch` (match switcher embed path) | Same `hw:N,M` path; downstream device handles network audio and routing |
| **Simple stereo** room / cue | `Analog`, `ALC`, onboard HDA | `stereo` | `-ac 2` |
| **Multi-bus / stems** | USB vendor name, many channels | custom `8ch` / `16ch` / `live-8ch` | `-ac` matches layout |

Always set **sample rate** (`-ar`, usually **48000**) and **channel count** (`-ac`) to match the Caspar **channel** video-mode cadence and **channel-layout** in `casparcg.config`.

---

## 1. NVIDIA HDMI / DisplayPort audio

### 1.1 Verify kernel audio stack

NVIDIA HDMI audio typically uses **Intel HDA** binding to the GPU:

```bash
lsmod | grep snd_hda_intel
```

You should see `snd_hda_intel` (and often `snd_hda_codec_hdmi`). If the module is missing, fix GPU / driver install first (proprietary `nvidia` driver vs nouveau affects which codec nodes appear).

### 1.2 Find the ALSA device

```bash
aplay -l | grep -i -E 'nvidia|hdmi|display'
```

Note **card** and **device** (e.g. `card 1, device 3` → **`hw:1,3`**). Many GPUs expose **one HDMI port per device number**—use the connector that matches your display cable.

### 1.3 Test playback

```bash
aplay -D hw:1,3 /usr/share/sounds/alsa/Front_Center.wav
```

(Replace path with any stereo WAV; use a multi-channel test file to validate **>2ch** if needed.)

### 1.4 Optional ALSA alias (`/etc/asound.conf` or `~/.asoundrc`)

```conf
pcm.nvidia_hdmi_main {
  type hw
  card 1
  device 3
}
```

Then FFmpeg can use `-f alsa nvidia_hdmi_main` instead of raw `hw:1,3`.

### 1.5 CasparCG notes

- **Multi-channel:** HDMI often supports **up to 8ch**; confirm with `speaker-test -D hw:N,M -c 8` and your display/sink capabilities.
- **Multiple displays:** you may have **several** `device` entries—one per output; pick the active monitor chain.
- Example consumer args (8-channel): `-f alsa hw:1,3 -codec:a pcm_s24le -ar 48000 -ac 8` (match your `channel-layout` and codec choices to Caspar’s expectations).

### 1.6 HDMI / DisplayPort into a video switcher (embedded audio as “main” output)

Treat the NVIDIA **HDMI or DisplayPort** link as a normal **multi-channel digital audio output**, not only as “sound to a monitor.” Many **video switchers and production routers** accept **HDMI/DP with embedded PCM** on their inputs, **de-embed** that audio internally, and expose it on **Dante**, MADI, analog buses, or other network / facility routing—so the GPU path can be your **primary** playout into house audio, IFB, or a Dante domain, with the switcher acting as **bridge** between Caspar’s embedded stream and the rest of the plant.

Design checks: match **channel count** and **sample rate** to what the switcher documents for that input; confirm on the switcher that the correct **input port** and **audio mapping** (per-channel vs downmix) match your Caspar **channel-layout**. If the switcher is also the **monitor** path, you still use the same ALSA `hw:N,M` for Caspar—the difference is **system role** (program vs confidence), not a different Linux device type.

---

## 2. 3.5 mm stereo (onboard analog)

### 2.1 Identify the device

In `aplay -l`, look for **Analog**, **Front**, **Headphones**, or codec names (**ALC892**, **Realtek**, etc.) on the **motherboard audio** card (often **card 0**).

Example mapping: `card 0, device 0` → **`hw:0,0`**.

### 2.2 Caspar configuration

- Use channel layout **`stereo`** (or default stereo mapping) on that channel.
- **FFmpeg consumer:** e.g. `-f alsa hw:0,0 -codec:a pcm_s16le -ar 48000 -ac 2`
- **System-audio consumer:** sends to the **default** desktop sink (PipeWire/Pulse); good for quick tests on a workstation, less deterministic on a headless server than explicit `hw:`.

### 2.3 PipeWire / default sink

If Caspar uses **Pulse** (`-f pulse <sink>`) or `<system-audio/>`, the **default** output may be the 3.5 mm jack when that’s the selected OS output—use `qpwgraph` or OS sound settings to confirm which physical port is active.

---

## 3. USB audio interface

### 3.1 Class-compliant devices

Most **USB** interfaces appear automatically as an ALSA card:

```bash
aplay -l
```

Look for **USB** and the vendor/model. Note **`hw:N,0`** (device index is often `0`).

### 3.2 Channel count and rate

- **Match Caspar** channel layout to the interface: e.g. **8 outputs** → layout **`8ch`** (or custom `live-8ch` in generated config) and **`-ac 8`** in FFmpeg.
- **Sample rate** must match the channel clock (typically **48000** Hz in broadcast Caspar setups). Mismatch causes pitch/speed errors or device refusal.

Verify channels (example: card 2, device 0):

```bash
speaker-test -D hw:2,0 -c 8 -t wav
```

### 3.3 Recommended multi-channel gear (Linux-friendly)

| Device class | Notes |
|--------------|--------|
| **RME Digiface USB** | Very high channel count; class-compliant on Linux. |
| **MOTU UltraLite** | Many channels; verify UAC2 mode if needed. |
| **Focusrite Scarlett** | Often needs **firmware / class mode** for full channel count—check vendor Linux notes. |

### 3.4 CasparCG FFmpeg example (8 outputs)

```xml
<ffmpeg-consumer>
  <path>-f alsa hw:2,0</path>
  <args>-codec:a pcm_s24le -ar 48000 -ac 8</args>
</ffmpeg-consumer>
```

Adjust `hw:2,0`, codec, and `-ac` to your card and `<channel-layout>`.

---

## Troubleshooting (all three)

| Symptom | What to check |
|---------|----------------|
| No sound | Wrong `hw:N,M`; another app holds the device exclusively; mute in `alsamixer`. |
| NVIDIA silent | Cable on correct HDMI/DP port; monitor audio input selected; try another `device` index. |
| USB only 2 ch | Interface in **class-1** mode; driver limitation—vendor firmware / UAC2. |
| Crackling | Buffer size; try `plughw:`; raise PipeWire quantum (see PipeWire doc). |

---

## See also

- [Caspar audio consumers (system-audio, FFmpeg, NDI, layouts)](./caspar-audio-consumers.md)
- [ALSA device enumeration](./alsa-device-enumeration.md)
- [PipeWire multi-channel routing](./pipewire-multichannel-routing.md)
