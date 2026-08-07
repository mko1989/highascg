# JACK audio routing (Linux alternative to PipeWire graph)

**JACK** (JACK Audio Connection Kit) is a low-latency audio server with a patchable **client graph**. It fits when you want **deterministic** routing between apps, **multiple ALSA devices** via bridges, or **JACK-native** clients/plugins. On many desktops **PipeWire** already covers similar use cases and exposes a **JACK-compatible API**; see [PipeWire multi-channel routing](./pipewire-multichannel-routing.md) first.

**Context:** WO-06 Audio playout · **T1.3**

---

## Install

Ubuntu / Debian (example):

```bash
sudo apt update
sudo apt install jackd2 qjackctl
```

Optional:

| Package | Role |
|---------|------|
| `qjackctl` | Patchbay, connections, **JACK start/stop** GUI. |
| `carla` | Plugin host / advanced routing (optional). |
| `alsa-utils` | `aplay -l` for device IDs — see [ALSA enumeration](./alsa-device-enumeration.md). |

---

## Start JACK with the ALSA backend (`jackd`)

Pick **one** ALSA playback device to be the **master** clock for JACK (from `aplay -l`: card **N**, often device **0**).

Example: card **1**, 48 kHz, 256 frames/period, 2 periods (adjust for stability vs latency):

```bash
jackd -R -d alsa -d hw:1 -r 48000 -p 256 -n 2
```

| Flag | Meaning |
|------|---------|
| `-R` | Realtime scheduling (often needs `limits.conf` / `audio` group). |
| `-d alsa` | ALSA backend. |
| `-d hw:1` | ALSA **card** index (not `hw:1,3`—JACK ALSA driver uses **card**; use separate tools for subdevices if needed). |
| `-r 48000` | Sample rate (match Caspar / broadcast chain). |
| `-p 256` | Period size in frames. |
| `-n 2` | Periods in the buffer (latency ∝ `p * n`). |

Run in a terminal or via **qjackctl → Setup → Parameters → Start**. Stop with Ctrl+C or qjackctl.

**Exclusive access:** while `jackd` holds `hw:N`, other apps (including Caspar **FFmpeg `-f alsa hw:N`** to the same device) may fail with “device busy”. Plan **one** owner of the hardware or use bridges below.

---

## Multi-device routing: `alsa_in` / `alsa_out`

When you need **more than one** ALSA card (e.g. USB + onboard), JACK can expose extra devices via:

- **`alsa_in`** — ALSA capture → JACK inputs (e.g. line in on another card).
- **`alsa_out`** — JACK outputs → ALSA playback on a **second** device.

Typical pattern: JACK master on **card A**; route mix through JACK to **card B** with `alsa_out`:

```bash
alsa_out -d hw:2,0 -j mon_out
```

Flags vary by version; use `alsa_out --help`. Connect **JACK ports** to `mon_out` in `qjackctl` **Graph**.

This is how you achieve **CasparCG → (ALSA or Pulse) → … → JACK → multiple hardware outputs**: Caspar does not speak JACK natively; you either:

1. Send Caspar **FFmpeg** to an ALSA device that is **not** the JACK master, then **bridge** into JACK with `alsa_in`, or  
2. Use **PipeWire** with Pulse compatibility and patch in `qpwgraph`, or  
3. Use a **JACK sink** if your FFmpeg build supports **`-f jack`** (uncommon in stock Caspar builds—verify `ffmpeg -formats | grep jack`).

For many **CasparCG** deployments, **direct ALSA `hw:`** or **Pulse/PipeWire** sinks are simpler than a full JACK graph. Use JACK when you specifically need its **graph + multi-card bridges** or **JACK-only clients**; otherwise PipeWire/ALSA is often enough.

---

## `qjackctl` workflow

1. **Setup:** choose **Interface** (ALSA driver), **Sample rate**, **Frames/period**, **Periods/buffer**.  
2. **Start** JACK.  
3. **Graph** (or **Connect**): wire **outputs** (playback clients) to **inputs** (capture / `alsa_out` ports).  
4. Save a **patchbay** preset for repeatable shows.

---

## `jackd` vs PipeWire JACK layer

- **PipeWire** can expose **JACK-compatible** sockets so JACK clients connect without a separate `jackd` (depends on install: `pipewire-jack`, `pw-jack`).  
- If you already use PipeWire as the session manager, prefer **that** stack unless you have a specific **jackd2** workflow.

---

## CasparCG (reminder)

- Caspar **FFmpeg consumers** normally use **`-f alsa`** or **`-f pulse`**.  
- Avoid **double-opening** the same `hw:` from Caspar and `jackd`.  
- See [Caspar outputs: NVIDIA, stereo, USB](./caspar-outputs-nvidia-stereo-usb.md) and WO-06 **Phase 2** for XML examples.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| `jackd` won’t start | Wrong `hw:` card; device in use; try larger `-p`. |
| Xruns (red in qjackctl) | Increase period; close other apps; CPU governor. |
| No permission for realtime | User in `audio` group; `/etc/security/limits.d/` `rtprio` / `memlock`. |
| Second interface silent | `alsa_out` / graph not wired; wrong `-d hw:`. |

---

## See also

- [ALSA device enumeration](./alsa-device-enumeration.md)
- [PipeWire multi-channel routing](./pipewire-multichannel-routing.md)
- [Caspar outputs: NVIDIA, stereo, USB](./caspar-outputs-nvidia-stereo-usb.md)
