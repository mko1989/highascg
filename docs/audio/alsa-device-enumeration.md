# ALSA device enumeration (Linux)

This guide explains how to **list and interpret** ALSA playback devices on Ubuntu (and similar distributions). Use it when wiring CasparCG **FFmpeg** or **system-audio** consumers to specific hardware (HDMI, USB interfaces, onboard jack) for [multi-channel audio playout](../../06_WO_AUDIO_PLAYOUT.md).

**Package:** `alsa-utils` (`aplay`, `arecord`). Install if needed: `sudo apt install alsa-utils`.

---

## List playback hardware: `aplay -l`

Prints **hardware** PCM devices: one block per **card**, with **device** indices.

```bash
aplay -l
```

Example (illustrative):

```
**** List of PLAYBACK Hardware Devices ****
card 0: PCH [HDA Intel PCH], device 0: ALC892 Analog [ALC892 Analog]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
card 1: NVidia [HDA NVidia], device 3: HDMI 0 [HDMI 0]
  Subdevices: 1/1
  Subdevice #0: subdevice #0
card 2: USB [Scarlett 18i20 USB], device 0: USB Audio [USB Audio]
  Subdevices: 0/1
  ...
```

### How to read it

| Field | Meaning |
|-------|---------|
| **card N** | ALSA card index (0, 1, 2, …). |
| **device M** | Device index on that card (0, 1, …). |
| Bracket name | Human-readable name (chip, HDMI port, USB product). |

**ALSA PCM hardware ID:** `hw:N,M` = card **N**, device **M**.

Examples:

- Onboard analog: `hw:0,0`
- NVIDIA HDMI on card 1, device 3: `hw:1,3`
- USB interface on card 2, device 0: `hw:2,0`

Use these IDs in CasparCG FFmpeg paths such as `-f alsa hw:1,3` (see `config-generator` / WO-06 Phase 2).

---

## List PCM names (including plugins): `aplay -L`

Prints **all PCM device names** ALSA knows, including **soft aliases** and **plug** devices (`plughw:`, `default`, `pulse`, `pipewire`, etc.).

```bash
aplay -L
```

Typical patterns:

| Name | Role |
|------|------|
| `default` | Often PipeWire/PulseAudio default sink (session-dependent). |
| `sysdefault:CARD=...` | Card-specific default. |
| `hw:CARD=...,DEV=...` | Named access to hardware (see `aplay -l` for indices). |
| `plughw:N,M` | Hardware with automatic format conversion. |

**Rule:** For **low-latency, fixed-format** routing from CasparCG, **FFmpeg → ALSA** usually targets **`hw:N,M`** or a **`plughw:N,M`** if sample format must be converted. For **desktop default speaker**, `default` or PipeWire may be easier but less deterministic on servers.

---

## Identify device types

| Clue in `aplay -l` | Likely device |
|--------------------|----------------|
| `HDA Intel`, `Realtek`, `ALC`, `Analog` | Onboard **3.5 mm** / internal codec. |
| `NVidia`, `HDMI`, `DP`, `DisplayPort` | **GPU HDMI/DP** audio (often **up to 8ch** on one HDMI). |
| `USB`, vendor name (Focusrite, RME, MOTU, …) | **USB audio interface** (channel count varies). |
| `HD-Audio Generic` | Could be onboard or secondary HDA; check `device` name. |

NVIDIA often exposes **multiple HDMI/DP devices** as separate **device** numbers on one **card**—pick the connector you use.

That same HDMI/DP output is often used as the **main** multi-channel program feed into a **video switcher** that de-embeds audio and bridges to Dante or other networks—see [Caspar outputs: NVIDIA, stereo, USB](./caspar-outputs-nvidia-stereo-usb.md) §1.6.

---

## Channel capabilities

`aplay -l` does **not** always show max channel count. To probe:

1. **Vendor specs** for USB interfaces (e.g. 8-out, 16-out).
2. **Test playback** with a known multi-channel WAV and FFmpeg/ALSA (e.g. `-ac 8`), or use `speaker-test` if installed:
   ```bash
   speaker-test -D hw:2,0 -c 8 -t wav
   ```
3. Inspect card details (if available):
   ```bash
   cat /proc/asound/cards
   ```
4. For PipeWire, use `pw-cli`, `pw-dump`, or `wpctl status` to see **node** channel counts (see [WO-06 Phase 1 T1.2](../../06_WO_AUDIO_PLAYOUT.md) PipeWire section).

**Caspar:** match channel **layout** (`stereo`, `8ch`, custom `live-8ch`, etc.) to **consumer** `ac` / device capability.

---

## Quick reference: card index vs `hw`

| Goal | Command |
|------|---------|
| Playback devices | `aplay -l` |
| All PCM names | `aplay -L` |
| Card summary | `cat /proc/asound/cards` |
| Record devices (same cards, capture side) | `arecord -l` |

---

## Mapping checklist for CasparCG / HighAsCG

1. Run `aplay -l` on the **same machine** that runs CasparCG.
2. Note **card** and **device** for each output you need.
3. Build FFmpeg ALSA path: `-f alsa hw:N,M` (or `plughw:N,M` if required).
4. Align **sample rate** (`-ar`) and **channel count** (`-ac`) with the Caspar channel **video-mode** cadence and **channel-layout**.
5. Document the chosen `hw:N,M` in your station runbook (firewall and WO-06 **T1.4** NVIDIA notes apply separately).

---

## See also

- [JACK audio routing](./jack-audio-routing.md)
- [Caspar outputs: NVIDIA, 3.5 mm stereo, USB](./caspar-outputs-nvidia-stereo-usb.md)
- [Work Order 06 — Audio playout](../../06_WO_AUDIO_PLAYOUT.md)
- Caspar wiki: FFmpeg consumer, system-audio consumer
- `.reference/` in repo (if present) for Caspar audio consumer XML
