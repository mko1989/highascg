# Pixel Map destination — how it works in the real world, and how to actually test it

**Audience:** the operator, before hardware arrives or on first hookup. This is the practical
companion to [ARTNET_PIXEL_MAPPING.md](ARTNET_PIXEL_MAPPING.md) (concepts / engine comparison)
and [WALKTHROUGH_ARTNET_LED_WALL.md](WALKTHROUGH_ARTNET_LED_WALL.md) (raw consumer schema).
It exists to close WO-242's owner action A242.1: create one, light something, trust it.

**Do not confuse it with a Mapping Node.** Both live in the Devices tab, but they are
different machines:

| | Mapping node | Pixel Map destination |
|---|---|---|
| What it does | Splits a canvas across **GPU/DeckLink video outputs** (LED processors, projectors) | Turns a Caspar channel into **Art-Net DMX packets** for pixel fixtures |
| Output | Video signal on a physical port | UDP packets on the network (port 6454) |
| Where | "+ Add mapping node" band | Screen destinations panel → **Pixel Map (native Art-Net)** |

## What actually happens end-to-end

1. You create a **Pixel Map** screen destination and set the fixture-array fields.
2. On **Apply Caspar config (restart)**, the generator emits a dedicated Caspar channel with a
   raster-exact custom video-mode and ONE native `<artnet>` consumer containing ONE fixture
   group `fixture-count = cols x rows` that samples the **whole channel raster** with area
   averaging (each fixture cell = the average color of its patch of the frame).
3. The destination registers as a **PGM-only screen** (no PRV bus): it shows up in the deck /
   screen selectors like any screen, and you take looks/content onto it exactly as usual.
4. CasparCG then fires ArtDMX packets at **Controller IP : port (default 6454), unicast**, at
   the configured refresh rate (default 10 Hz — raise it for video-ish motion, e.g. 25–44).
   Universes beyond the first **auto-spill upward** (start universe, +1, +2, …), whole
   fixtures only — a fixture's channels are never split across two universes.

Real-world receive side: an **Art-Net pixel controller** (Advatek PixLite, Falcon, ESPixelStick,
any Art-Net→SPI/DMX node) configured with the SAME universe numbering and start address,
driving the tape/panels. The controller's pixel count per output must match what you send.

## Universe math (what to type into the controller)

- RGB = 3 channels/fixture → **170 fixtures per universe** (510 of 512 channels used).
- RGBW = 4 channels/fixture → **128 fixtures per universe**.
- First universe holds fewer if Start DMX address > 1.
- Example: 48×27 RGB grid = 1296 fixtures → universes 0–7 (8 universes) at start-address 1.
- The inspector's note and the generated XML comment both print the computed spill — trust
  those over hand math (`src/config/artnet-pixelmap-universe.js` mirrors the deployed
  consumer's loop exactly).

## Step-by-step on this box

1. Devices tab → Screen destinations `+` → type **Pixel Map (native Art-Net)**.
2. Inspector fields (all map 1:1 onto the consumer schema):
   - **Controller IP** — the Art-Net node's address (required; unicast; use the node's real
     IP, not broadcast).
   - **Fixture columns / rows** — the pixel grid as the wall is wired (cols × rows).
   - **Fixture type** — RGB (3ch) or RGBW (4ch); must match the tape/controller profile.
   - **Start universe / Start DMX address** — must match the controller's patch.
   - **DMX refresh rate (Hz)** — 10 default; 25+ for motion content.
3. **Apply Caspar config (restart)** — the fixture params only exist in the generated config,
   so every change here needs an Apply + Caspar restart. (This is the native path's one real
   cost; the deprecated JS pipeline was live-editable but lost color fidelity and sACN is its
   exclusive feature.)
4. Take content onto the new screen from the deck (it's a PGM-only screen; the WO-222 screen
   label applies).

## Testing WITHOUT a wall (today, zero hardware)

**A. Sanity-check the generated config (no restart needed to inspect):**

```
grep -A20 "<artnet>" /home/casparcg/highascg/config/casparcg.config
```

You should see your `<fixture>` block (type, start-address, fixture-count "colsxrows",
host, universe) and a custom `<video-mode>` whose `<id>` is the bare `WxH`.

**B. Watch the actual packets.** The box ships no tcpdump; use python3. Run this on the
machine whose IP you typed as Controller IP (or set Controller IP to another machine on the
LAN running an Art-Net monitor app — ArtNetominator / DMX-Workshop on Windows, ArtNetView on
macOS):

```python
#!/usr/bin/env python3
# artdmx-peek.py — print incoming ArtDMX frames (universe, length, first pixels)
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("0.0.0.0", 6454))
print("listening on :6454 …")
while True:
    d, addr = s.recvfrom(2048)
    if d[:8] == b"Art-Net\x00" and int.from_bytes(d[8:10], "little") == 0x5000:
        uni = int.from_bytes(d[14:16], "little")
        ln = int.from_bytes(d[16:18], "big")
        px = d[18:18+9]
        print(f"{addr[0]}  universe={uni}  len={ln}  rgb0..2={list(px)}")
```

Expected: one line per universe per refresh tick, and `rgb0..2` tracking whatever is on the
channel (take a full-red look → `[255, 0, 0, 255, 0, 0, …]`).

**C. Loopback test on the box itself:** set Controller IP to the box's own LAN IP, run the
script here, Apply, take a solid-color look. If universes and colors are right on loopback,
the only remaining variables on real hardware are the controller's patch and wiring order.

## Gotchas

- **Every fixture-field edit needs Apply + Caspar restart.** The restart-dirty affordance on
  the Apply button tracks this.
- **Native path is Art-Net only.** sACN and restart-free remapping exist only on the
  deprecated JS pipeline (`legacyJsPixelmap` flag) — see the comparison in
  [ARTNET_PIXEL_MAPPING.md](ARTNET_PIXEL_MAPPING.md).
- **One whole-frame fixture group per destination.** Multiple groups, partial regions,
  rotation, serpentine/mirroring are NOT modeled by the destination UI — hand-edit per
  [WALKTHROUGH_ARTNET_LED_WALL.md](WALKTHROUGH_ARTNET_LED_WALL.md) (and know regen loses
  hand edits) or split the wall across multiple Pixel Map destinations.
- **Serpentine wiring:** the consumer addresses the grid row-major left-to-right. If the tape
  snakes, fix it in the controller (most pixel controllers reverse alternate rows), not here.
- **Unicast:** packets go to the one Controller IP. Two controllers = two destinations.
