# PipeWire multi-channel routing (Linux)

[PipeWire](https://pipewire.org/) is the default audio server on **Ubuntu 24.04+** (with **WirePlumber** as the session/policy manager). Use it to route **multi-channel** CasparCG output (FFmpeg → Pulse/PipeWire, or system default sink) to HDMI, USB, or other devices with flexible graph routing.

**Companion doc:** [ALSA device enumeration](./alsa-device-enumeration.md) · WO-06

---

## Packages

Typical desktop/session install:

```bash
sudo apt update
sudo apt install pipewire pipewire-pulse wireplumber qpwgraph
```

Useful extras:

| Package | Purpose |
|---------|---------|
| `qpwgraph` | Visual patchbay (nodes ↔ links). |
| `pipewire-audio-client-libraries` | Dev headers (optional). |

Verify the **user** session is running PipeWire (common on desktop; headless may differ):

```bash
systemctl --user status pipewire pipewire-pulse wireplumber
```

---

## Sample-rate and buffer size (drop-in config)

CasparCG channel modes are usually **48 kHz**-aligned. You can set **default clock** and **quantum** (buffer in frames) via a drop-in so apps share a stable time base.

Create e.g. `/etc/pipewire/pipewire.conf.d/99-caspar-clock.conf` (path may be `~/.config/pipewire/pipewire.conf.d/` for **per-user** overrides):

```ini
context.properties = {
  default.clock.rate = 48000
  default.clock.quantum = 256
  default.clock.min-quantum = 64
}
```

| Property | Role |
|----------|------|
| `default.clock.rate` | Global sample rate (Hz); **48000** matches typical Caspar/FFmpeg consumer args. |
| `default.clock.quantum` | Default buffer size in **frames** at the default rate (latency vs stability tradeoff). |
| `default.clock.min-quantum` | Lower bound for dynamic quantum (lower = lower latency, higher CPU). |

Restart the session services after editing system-wide files:

```bash
systemctl --user restart wireplumber pipewire pipewire-pulse
```

**Note:** Exact merge behaviour depends on PipeWire version; if a property is ignored, check `journalctl --user -u pipewire` for warnings.

---

## Virtual sinks for CasparCG routing

Caspar can send audio to a **named sink** (e.g. FFmpeg `-f pulse <sink_name>` or system default). Creating a **dedicated sink** lets you:

- Patch **Caspar → mixer → hardware** in `qpwgraph`
- Isolate **PGM vs monitor** buses without renumbering ALSA `hw:N,M` in XML

### PulseAudio compatibility (PipeWire implements this)

With **pipewire-pulse**, `pactl` often controls PipeWire’s Pulse-compatible sinks.

**Example:** null sink with a friendly name and multiple channels (adjust `channels=` to your layout):

```bash
pactl load-module module-null-sink sink_name=caspar_pgm \
  sink_properties=device.description=CasparPGM channels=8
```

List sinks:

```bash
pactl list short sinks
```

Use the sink name in Caspar **FFmpeg** consumer paths that target Pulse, e.g. `-f pulse caspar_pgm` (see WO-06 Phase 2).

Unload (note module id from `pactl list modules short`):

```bash
pactl unload-module <module-id>
```

For **persistent** null sinks across reboots, prefer a WirePlumber snippet or a small user systemd unit that runs the `pactl load-module` line at login—station-specific.

---

## Tools

### `qpwgraph`

- Launches a **graph** of PipeWire **nodes** (apps, sinks, sources).
- **Drag connections** between outputs and inputs to route Caspar (or `pw-play`) into the right hardware or virtual sink.
- Ideal for validating **multi-channel** paths before baking paths into `casparcg.config`.

### `pw-cli` and `pw-dump`

- **Inspect** objects, properties, and links:
  ```bash
  pw-cli ls Node
  pw-dump | less
  ```
- Use to confirm **channel counts** and **port names** on a device node.

### `pw-top`

- Live **CPU** and **quantum** / driver timing view (similar to `top`).
- Useful when chasing **xruns** or high load while running Caspar + FFmpeg consumers.

---

## CasparCG integration notes

| Path | Behaviour |
|------|------------|
| **FFmpeg `-f alsa hw:N,M`** | Talks **ALSA** directly; **bypasses** PipeWire unless ALSA is plumbed to PipeWire. |
| **FFmpeg `-f pulse <sink>`** | Goes through **PipeWire’s Pulse layer**; virtual sinks and `qpwgraph` routing apply. |
| **`<system-audio/>` consumer** | Usually follows **default desktop sink** (often PipeWire). |

For a **single** fixed device, ALSA `hw:N,M` is often simpler. For **flexible** routing between multiple outputs, **Pulse-compatible sinks** + PipeWire graph are appropriate.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| No nodes for Caspar | Consumer uses ALSA `hw:` only → no PipeWire node; use `pulse` or test `pw-play` into a sink. |
| Crackling / dropouts | Quantum too low vs CPU load; try raising `default.clock.quantum`; close other heavy clients. |
| Wrong rate | Force 48000 in Caspar channel mode and FFmpeg `-ar 48000`; match `default.clock.rate`. |
| `pactl` fails | Ensure `pipewire-pulse` socket is active; user session vs system PipeWire. |

---

## See also

- [JACK audio routing](./jack-audio-routing.md) (separate low-latency graph stack)
- [Caspar outputs: NVIDIA, 3.5 mm stereo, USB](./caspar-outputs-nvidia-stereo-usb.md)
- [ALSA device enumeration](./alsa-device-enumeration.md)
- WO-06 Phase 1 — JACK alternative (**T1.3**), NVIDIA (**T1.4**), USB (**T1.5**)
