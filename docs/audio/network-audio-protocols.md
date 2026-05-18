# Network audio protocols (Linux + CasparCG context)

Options for moving **audio over the network** or bridging **Dante / AES67** to Linux. Use with local I/O guides: [ALSA](./alsa-device-enumeration.md), [Caspar audio consumers](./caspar-audio-consumers.md), [PipeWire](./pipewire-multichannel-routing.md).

**Context:** WO-06 Audio playout · Phase 3 (T3.1–T3.4)

---

## T3.1 — AES67 and Dante-compatible setups

**Dante Virtual Soundcard does not run on Linux.** On Linux you typically use one of:

1. **AES67** — Dante devices can expose an **AES67** stream if enabled in **Dante Controller** (usually on a Windows or macOS machine on the same network). Other gear (or Linux with a suitable stack) subscribes to that stream.
2. **Linux driver** — Some vendors ship **RAVENNA / AES67**-style drivers that expose **ALSA** devices (e.g. Merging’s commercial Linux offerings). Treat them like any other ALSA card in Caspar **FFmpeg** consumers (`-f alsa hw:…`).
3. **Hardware USB bridge** — A **USB** interface that speaks **Dante** on the network but shows up on Linux as a **normal multi-channel ALSA** device (e.g. RME Digiface Dante, Audinate AVIO USB). Dante routing and labels stay in **Dante Controller** on another host; Caspar only sees `aplay -l` and `hw:N,M`.

**Workflow sketch:** enable AES67 on the Dante side → ensure multicast / PTP / network requirements from the vendor → on Linux either use a **driver** that creates ALSA nodes or a **USB bridge** so Caspar never needs a Windows-only driver.

---

## T3.2 — NDI audio extraction

Caspar’s **NDI consumer** sends **video + embedded audio** on the LAN (see [caspar-audio-consumers § T2.3](./caspar-audio-consumers.md)).

**Receiving / monitoring elsewhere**

| Tool | Notes |
|------|--------|
| **NDI Studio Monitor** | Common for monitoring; runs on Windows/macOS (check current NDI SDK / vendor docs). |
| **FFmpeg** with NDI input | On a machine with a build that includes `libndi_newtek`, you can decode and send audio to ALSA, e.g.: `ffmpeg -f libndi_newtek -i "SOURCE_NAME" -f alsa hw:0` (names match what NDI advertises). |
| **go2rtc** | If you already use go2rtc (e.g. streaming WO), some pipelines can fork NDI → other outputs; keep latency and licensing in mind. |

Exact **FFmpeg** flags and stream names depend on build (`ffmpeg -decoders | grep ndi`) and your NDI source name as shown in NDI tools.

---

## T3.3 — JACK network audio (NetJACK)

**NetJACK** sends **JACK audio streams over a LAN** between machines running JACK.

Typical pattern:

1. **Server** (e.g. Caspar host): run **`jackd`** with the ALSA backend as usual ([local JACK doc](./jack-audio-routing.md)).
2. **Client** (receiver): run **`jack_netsource`** (or the matching NetJACK2 tool for your version) pointing at the server’s IP and NetJACK port.

You get **multiple channels** (often 32+ depending on configuration) with **low latency** on a solid wired LAN. **Firewall:** allow the TCP/UDP ports your NetJACK build uses.

Caspar does not output JACK natively; audio reaches JACK via **ALSA bridges** (`alsa_in` / `alsa_out`) or other paths described in the JACK doc. NetJACK is for **distributing** JACK streams, not for replacing Caspar’s own consumers.

---

## T3.4 — PipeWire ROC (Real-time Open Codec)

**ROC** is a network stack for streaming audio (part of the broader PipeWire ecosystem). Typical CLI tools:

- **`roc-send`** — sender on the machine that has the audio stream (e.g. near Caspar or a loopback).
- **`roc-recv`** — receiver on the listening machine.

Use cases: **LAN** streaming between Linux hosts when you want **ROC**’s codec and latency model instead of raw RTP or NDI. Install **roc-toolkit** / distro packages as available; options and port defaults change by version—see `roc-send --help` / `roc-recv --help`.

This is **orthogonal** to Caspar: you would still take audio from Caspar **FFmpeg** / **system-audio** / **ALSA** and feed the ROC sender, unless you patch at the PipeWire graph level.

---

## Dante / Linux reminders (from WO-06)

- **Dante Virtual Soundcard:** not supported on Linux — use **AES67**, **hardware bridge**, or **RAVENNA-class** drivers where applicable.
- **SoundGrid (Waves):** control software is not Linux-targeted for typical station workflows.
- **Reliable Dante-to-ALSA on Linux:** USB **Dante** interfaces that enumerate as standard ALSA devices are often the least fragile path.

---

## See also

- [Caspar audio consumers](./caspar-audio-consumers.md) (NDI, FFmpeg)
- [JACK audio routing](./jack-audio-routing.md) (local graph)
- WO-06 Important Notes
