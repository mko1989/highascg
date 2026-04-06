# CasparCG audio consumers (config reference)

How to declare **audio outputs** in `casparcg.config`: system default sink, FFmpeg to ALSA/Pulse, NDI, audio-only channels, and **channel layouts**. Complements the Linux stack guides ([ALSA](./alsa-device-enumeration.md), [PipeWire](./pipewire-multichannel-routing.md), [NVIDIA / stereo / USB](./caspar-outputs-nvidia-stereo-usb.md)).

**Consolidated:** [Audio setup guide](./audio-setup-guide.md) · [Audio routing reference](./audio-routing-reference.md) (MIXER, buses, FFmpeg `AF`).

**WO:** [06 — Audio playout](../../06_WO_AUDIO_PLAYOUT.md) · Phase 2 (T2.1–T2.5)

---

## T2.1 — `<system-audio>` consumer

Sends the channel mix to the **default** desktop audio sink (PipeWire / PulseAudio / ALSA default, depending on session).

```xml
<consumers>
  <system-audio>
    <channel-layout>stereo</channel-layout>
  </system-audio>
</consumers>
```

| Topic | Notes |
|-------|--------|
| **Layout** | Match `<channel-layout>` on the channel (e.g. `stereo`, `5.1`) to what the sink supports. |
| **Count** | **At most one** `<system-audio>` per Caspar **channel**. |
| **Choosing the device** | Caspar follows the process default. Set the session **default output** in OS settings, or set **`PULSE_SINK=<sink_name>`** (PulseAudio compatibility layer used by PipeWire) so the default sink is the intended HDMI / 3.5 mm / USB device. |

FFmpeg consumers are **not** required for basic “play through speakers” if this consumer is enough.

---

## T2.2 — FFmpeg consumer (explicit device or Pulse sink)

Use when you need a **specific** ALSA card/device or a **named** Pulse/PipeWire sink (see [virtual sinks](./pipewire-multichannel-routing.md)).

### ALSA hardware

```xml
<ffmpeg-consumer>
  <path>-f alsa hw:N,M</path>
  <args>-codec:a pcm_s24le -ar 48000 -ac 8</args>
</ffmpeg-consumer>
```

Replace `N,M` using `aplay -l`. Align **`-ar`** and **`-ac`** with the channel **video-mode** cadence and **channel-layout**.

### Pulse / PipeWire named sink

```xml
<ffmpeg-consumer>
  <path>-f pulse caspar_audio_bus_1</path>
  <args>-codec:a pcm_s24le -ar 48000 -ac 2</args>
</ffmpeg-consumer>
```

Create the sink first (`pactl load-module module-null-sink sink_name=caspar_audio_bus_1 …`). Multiple **`<ffmpeg-consumer>`** blocks on the **same** channel are allowed—each can target a different sink or device.

**Note:** In HighAsCG’s config generator, FFmpeg blocks use element name `<ffmpeg-consumer>` (see `src/config/config-generator.js`); upstream Caspar examples sometimes say `<ffmpeg>`—follow your Caspar build’s schema.

---

## T2.3 — NDI consumer (network video + embedded audio)

NDI carries **embedded audio** with the stream; receivers on the LAN can decode both.

```xml
<ndi>
  <name>CasparCG-Audio-PGM</name>
</ndi>
```

Audio channel count follows the Caspar **channel layout** for that channel. Useful when a downstream tool or hardware takes **NDI** and splits or meters audio.

---

## T2.4 — Audio-only channels (extra channels)

Use **extra** channels with **no** screen consumer as **buses**: route program audio with **`PLAY … route://`** (or equivalent routing) and adjust **MIXER** / **MASTERVOLUME** on routed layers.

Example shape (video mode and layout must exist in your Caspar build; `PAL` is a common minimal mode for audio-only channels):

```xml
<channel>
  <video-mode>PAL</video-mode>
  <channel-layout>16ch</channel-layout>
  <consumers>
    <ffmpeg-consumer>
      <path>-f alsa hw:USB_AUDIO</path>
      <args>-codec:a pcm_s24le -ar 48000 -ac 16</args>
    </ffmpeg-consumer>
  </consumers>
</channel>
```

Replace `hw:USB_AUDIO` with your real `hw:N,M` or Pulse sink. HighAsCG’s **audio mixer** / routing UI (when enabled) uses the same idea: **extra audio channels** in generated config.

---

## T2.5 — Channel layouts and `<audio><channel-layouts>`

Caspar ships standard layouts (`stereo`, `5.1`, `7.1`, …). For **4 / 8 / 16** discrete buses you often define **custom** layouts in the global **`<audio>`** section:

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

Then reference them on a channel:

```xml
<channel>
  <video-mode>1080p5000</video-mode>
  <channel-layout>8ch</channel-layout>
  <consumers>
    <!-- … -->
  </consumers>
</channel>
```

| Channels | Typical layout id | Use |
|----------|-------------------|-----|
| 2 | `stereo` | L/R |
| 4 | custom `4ch` (define in XML) | Stereo + aux, etc. |
| 8 | `7.1` or custom `8ch` | Surround or multi-bus |
| 16 | custom `16ch` | Stems / buses |

HighAsCG **config generator** can emit `live-8ch` and other layouts when needed (`buildAudioLayoutsXml` in `src/config/config-generator.js`).

---

## See also

- [Network audio protocols (AES67/Dante, NDI, NetJACK, ROC)](./network-audio-protocols.md)
- [WO-06 Phase 4 & 5](../../06_WO_AUDIO_PLAYOUT.md) — HighAsCG settings API / config generator integration when implemented
- [Caspar wiki / server docs](https://github.com/CasparCG/help/wiki) (consumer syntax varies slightly by version)
