# Walkthrough — LED wall on the native Art-Net consumer

**Badge:** [CONFIG+CASPAR-RESTART] — every step in this doc that changes fixtures requires a Caspar restart.
**Engine:** improved-artnet consumer compiled into `bin/casparcg` (highascg-build-v1, 2026-07-15). All schema below is read from the deployed source: `/home/casparcg/caspar-build/src-tree/src/modules/artnet/` — cites are `artnet_consumer.cpp:<line>` into `consumer/artnet_consumer.cpp` unless noted.
**Landscape / engine choice:** [ARTNET_PIXEL_MAPPING.md](ARTNET_PIXEL_MAPPING.md)

Scenario: an **8×4-panel LED wall** behind the stage, each panel driven as one RGB pixel-block, wall controller at `192.168.1.50`, Art-Net universe 0.

---

## 1. Dedicate a Caspar channel to wall content

Give the wall its own channel so wall looks/loops don't fight PGM. The consumer samples whatever the channel renders — media, HTML templates, a routed copy of PGM. A small video mode is fine (the consumer rescales per fixture region anyway); 8-bit only — the consumer refuses to attach to deep-color channels ("Artnet consumer only supports 8-bit color depth.", `artnet_consumer.cpp:745-746`).

On this rig channels come from the Device View generator (`config/casparcg.config` is generated). The `<artnet>` block is **not** emitted by the generator (no artnet-consumer support anywhere in `src/config/`), so it is added by hand — see step 4.

## 2. The real `<artnet>` consumer schema

Parsed by `create_preconfigured_consumer()` + `get_fixtures_ptree()` (`artnet_consumer.cpp:737-756, 566-735`). Everything the parser reads, with rules:

| Element | Required | Range / format | Default | Source |
|---|---|---|---|---|
| `<refresh-rate>` | no | int ≥ 1 (DMX sends/sec) | 10 | :748-751, :67 |
| `<fixtures>` → `<fixture>`… | yes | one `<fixture>` per group | — | :572-573 |
| `fixture/start-address` | **yes** | 1–512 (1-based DMX) | — | :577-583 |
| `fixture/host` | **yes** | valid IP literal (not hostname) | — | :585-593 |
| `fixture/port` | **yes** | 1–65535 (Art-Net = 6454) | — | :595-600 |
| `fixture/universe` | **yes** | 0–32767 | — | :602-607 |
| `fixture/fixture-count` | **yes** | `"N"` (1×N chain) or `"WxH"` grid | — | :609-631 |
| `fixture/type` | **yes** | `DIMMER` \| `RGB` \| `RGBW` (case-insens.) | — | :633-645 |
| `fixture/fixture-channels` | no | ≥ channels of type (1/3/4), ≤ 512 — pad for e.g. 4-ch RGB+strobe cells | = type size | :647-657 |
| `fixture/flux` → `<r><g><b><w>` | no | floats > 0; per-LED output compensation (value divides the channel) | 1.0 each | :659-667, fixture_calculation.h:45-53 |
| `fixture/brightness` | no | 0.0–1.0 master multiplier | 1.0 | :669-671 |
| `fixture/rotation` | no | degrees, clockwise about region center | 0 | :673-674 |
| `fixture/mirror-x`, `mirror-y` | no | bool — applied after rotation, in grid space | false | :676-677, :202-208 |
| geometry (pixels on the channel raster) | yes* | `<width>/<height>` + one of `<x>/<y>` (center) or `<left>/<top>` or `<right>/<bottom>`; or omit size and give both `<left>+<right>` / `<top>+<bottom>` to derive it. Priority center → left/top → right/bottom; conflicting specifiers log a warning | 0 | :679-729 |

*A missing/empty box is skipped with a warning at startup (:484-485); a box poking outside the frame is clamped with a warning (:453-470).

Sampling internals worth knowing: each fixture group is rescaled to exactly cols×rows pixels with libswscale `SWS_AREA` (true box average, every pixel counts, :512-525); rotated groups first go through a 4×-supersampled bilinear resample (:63, :371-410). `DIMMER` outputs luma `0.279R+0.547G+0.106B` (:429); `RGBW` extracts white as `min(r,g,b)` (:436-443).

**Universe math / auto-spill:** sub-fixtures are addressed sequentially from `start-address`; when the next one would cross channel 512 it spills to `universe+1` at channel 1, same host/port (:318-333). So with `fixture-channels` = 3: `floor(512/3)` = **170 fixtures per universe**. An 8×4 wall (32 × 3 = 96 ch) fits in one universe; a 48×27 pixel grid (1296 px) needs `ceil(1296/170)` = **8 universes** (0–7) automatically.

## 3. Config for the 8×4 wall

Inside the wall channel's `<consumers>` in `config/casparcg.config`:

```xml
<channel>
    <video-mode>1080p5000</video-mode>
    <consumers>
        <!-- ... existing consumers for this channel ... -->
        <artnet>
            <refresh-rate>30</refresh-rate>
            <fixtures>
                <fixture>
                    <type>RGB</type>
                    <start-address>1</start-address>
                    <fixture-count>8x4</fixture-count>
                    <fixture-channels>3</fixture-channels>
                    <host>192.168.1.50</host>
                    <port>6454</port>
                    <universe>0</universe>
                    <!-- sample the full 1920x1080 raster -->
                    <x>960</x>
                    <y>540</y>
                    <width>1920</width>
                    <height>1080</height>
                    <brightness>1.0</brightness>
                </fixture>
            </fixtures>
        </artnet>
    </consumers>
</channel>
```

That one `<fixture>` element is the whole wall: an 8-col × 4-row grid, row-major, panel (0,0) = channels 1-3 of universe 0, panel (7,3) = channels 94-96. Wall wired differently? Flip with `<mirror-x>true</mirror-x>` / `<mirror-y>`, or split into multiple `<fixture>` groups (one per daisy-chain) each with its own region + start address — per-fixture `host`/`universe` means different chains can even go to different controllers.

Add `<flux>` if the wall's red LEDs run visibly hot: e.g. `<flux><r>1.2</r></flux>` divides red by 1.2 (fixture_calculation.h:45-53).

## 4. Applying on this rig

The generator will overwrite hand edits, so use the one-shot editor flow:

1. Device View → toolbar pencil icon (**"View or edit generated Caspar config (advanced)"**, `client/components/device-view-toolbar.js:26-31`).
2. **✏️ Edit** → paste the `<artnet>` block into the wall channel's `<consumers>` → **Apply & restart** (`client/components/caspar-config-modal.js:28-40`). This writes the config and restarts Caspar — brief output interruption on all channels, do it in a maintenance window.
3. Alternatively edit `config/casparcg.config` on disk and use Settings → **Restart CasparCG** (`client/components/settings-modal-templates.js:317`), the same WO-236-style restart affordance (Device View's **Apply Caspar config (restart)** button turns orange when config-affecting settings are dirty, `client/components/device-view-selection.js:30-31`).

**Caveat (repeat it to yourself):** any later Device View regen/apply regenerates the file **without** the `<artnet>` block — re-add it afterwards. Generator support is [PLANNED] (drafted WO-230, see WO-233's retarget note).

## 5. Verification

- Startup: the consumer registers as `artnet` (module init, `modules/artnet/artnet.cpp:36`) and appears in channel INFO/OSC state with `artnet/fixtures`, `artnet/computed-fixtures`, `artnet/output-universes`, `artnet/refresh-rate` (`artnet_consumer.cpp:242-254`).
- Misconfig warnings in the Caspar log (exact strings from source):
  - `artnet: fixture box extends outside the frame; clamping to the nearest point inside it.` (:463-464)
  - `artnet: fixture group has no sub-fixtures; skipping.` (:475)
  - `artnet: fixture box is empty or outside the channel; skipping.` (:485)
  - `artnet: fixture box is smaller than a pixel; skipping.` (:504)
  - `artnet: fixture has conflicting horizontal specifiers. …` (:700-703, same for vertical :706-709)
- Bad config aborts consumer creation with explicit user errors, e.g. `Fixture <start-address> must be between 1 and 512` (:581), `Fixture <host> must be a valid IP address` (:592-593), `Fixture count must be 'N' or 'WxH'` (:624), `Refresh rate must be at least 1` (:751).
- Per-packet trace (only at trace log level): `Sent DMX data to Artnet, universe: N` (:560).
- On the wall: play bars/a grid ident on the wall channel; each panel should show the area-average of its region. Full 512-channel ArtDMX frames go out every `1000/refresh-rate` ms per universe (:140-218, :533-563) even when video is static — sniff with Wireshark (`udp.port == 6454`) if the controller shows nothing.

---

## Variant — `<pixel>` consumer (raw full-frame grid)

**When to prefer it:** the wall/processor wants a raw pixel raster (1 video pixel = 1 LED) and you'd rather author content at the LED resolution than define regions — LED processors, Madrix-style software, seat/audience surfaces. No regions, no averaging, no per-fixture placement.

Source: `/home/casparcg/caspar-build/src-tree/src/modules/pixel/` — registered preconfigured-only as `pixel` (`pixel.cpp:29-31`), config parsed in `consumer/pixel_consumer.cpp:134-190`:

| Element | Required | Range | Default | Source |
|---|---|---|---|---|
| `<protocol>` | **yes** | `artnet` (only value accepted) | — | :148-150 |
| `<host>` | no | IP | 127.0.0.1 | :152 |
| `<port>` | no | uint16 | 6454 | :153 |
| `<universe>` | no | 0–32767 | 0 | :155-157 |
| `<start-address>` | no | 1–512 | 1 | :159-161 |
| `<type>` | **yes** | `luma` \| `rgb` \| `rgbw` \| `rgbx` | — | :166-174 |
| `<coef>` → `<r><g><b><w>` | no | > 0, normalized to max(r,g,b) | 1.0 | :176-182, color_grader.h:46-53 |
| `<gamma>` | no | 0.1–10 | 1.0 | :179, :184-185 |

Behavior: **every frame** (no refresh-rate), every pixel row-major → 1/3/4 bytes per pixel (`pixel_consumer.cpp:96-102`), gamma LUT then coefficients (color_grader.h:56, `rgbw` white = `min(r,g,b)` :72-80, `rgbx` pads a zero byte :82-86), packed into consecutive 512-channel ArtDMX universes auto-incrementing from `<universe>` (`artdmx_sink.h:97-108`). 8-bit channels only (:140-141).

**The grid is the video mode** — so give the wall channel a custom mode matching the LED grid. Example: 96×54 wall, RGB = 15,552 channels = 31 universes starting at universe 0:

```xml
<channel>
    <video-mode>96x54p50</video-mode>   <!-- custom mode; generator supports custom modes
                                             (src/config/config-generator-custom-modes.js) -->
    <consumers>
        <pixel>
            <protocol>artnet</protocol>
            <host>192.168.1.50</host>
            <port>6454</port>
            <universe>0</universe>
            <start-address>1</start-address>
            <type>rgb</type>
            <gamma>2.2</gamma>
        </pixel>
    </consumers>
</channel>
```

Sizing rule: `universes = ceil(W × H × bytes_per_pixel / 512)`. Keep it sane — this sends at full channel rate; 50 fps × 31 universes is ~1,550 packets/s, fine on a dedicated lighting VLAN, silly over WiFi. Do **not** point it at a 1080p mode (12,150 universes/frame).

Verification: on send failure it logs one error with the consumer tag `pixel[<ch>|<mode>]` and later `: Connection restored` when the socket recovers (`pixel_consumer.cpp:104-112,118-121`). Config errors abort startup: `Unsupported or unspecified protocol.` (:150), `Unsupported or unspecified pixel type.` (:174), `Invalid universe number.` / `Invalid start address.` / `Invalid gamma value.` (:157,161,185).

Applying = same restart flow as step 4, same regen caveat.
