# GPU output, screen consumers, and X11 (xrandr) — intended interaction

This document describes how **screen destinations**, **CasparCG channel / screen consumers**, **Device View cabling**, and **OS-level display layout (xrandr)** are meant to work together in HighAsCG. It is normative for product behaviour; implementation may lag until the linked work order is complete.

---

## 1. Roles of each layer

### 1.1 Screen destinations (tandem / routing config)

- **Screen destinations** define logical program outputs: which **CasparCG channels** exist, their **video mode** (e.g. `720p50`, `1080p5000`, or custom width × height × fps), and **layout metadata** such as **position** on the virtual canvas (e.g. `0,0` for the first main screen, then horizontal tiling for additional mains).
- Persisted settings drive **Caspar config generation** (`<screen>` consumers, channel map, etc.) so the **Caspar “screen consumer” window** for a bound channel matches that destination’s mode and placement **inside Caspar’s coordinate system**.

### 1.2 Device graph: channel → GPU connector

- The user **cables** a **channel output** (or logical screen sink) to a **`gpu_out`** connector on the rear panel.
- That edge means: *this physical output (HDMI/DP via X)* is **bound** to **display that screen’s consumer*** — i.e. the Caspar window for the channel tied to that destination should appear on that connector’s monitor.
- Binding must resolve which **main screen index** (`mainScreenIndex` / Caspar screen index) the GPU output carries, so server-side layout code can map **one logical screen → one `xrandr` output** (`screen_N_system_id`, e.g. `HDMI-0`).

### 1.3 Default behaviour (override **off**)

When **Override** is **not** enabled for that screen:

1. **xrandr `--mode`** (pixel resolution) should follow the **bound screen destination’s** effective format: standard mode tokens map to WxH (e.g. `720p50` → `1280x720`), custom modes use destination width × height; refresh where applicable should align with destination fps / mode naming.
2. **xrandr `--pos`** for that head should follow the **channel / destination position** used for that screen in the tandem layout (e.g. first screen at `0x0`, next screen to the right of the previous head’s width so physical desktop matches logical canvas tiling).
3. Applying layout (**Apply GPU** / `POST /api/settings/apply-os`) should **recompute** the full horizontal plan so **all** bound GPU heads stay consistent after any one destination or cable change.

### 1.4 Override behaviour (override **on**)

When the physical monitor **cannot** or **should not** match the channel’s native format (operator wants 1080p on a 720p channel path, lab test, EDID mismatch, etc.):

1. The user enables **Override** for that GPU / screen row in Device View.
2. They choose **resolution** from the EDID-backed dropdown and/or **custom** width × height × fps (same controls as today), then **Apply GPU** (or the combined save + apply path).
3. **xrandr** must use that **chosen** mode and rate, **not** the destination’s pixel mode.
4. **Positions of subsequent heads** must still be recalculated so the X desktop tiling matches the **actual** widths applied (override may change width; following screens’ `--pos` must shift).

### 1.5 Caspar vs OS

- **Caspar** continues to render the **screen consumer** at the **destination’s** mode (unless the operator separately changes Caspar screen settings). Override affects **OS framebuffer layout** seen by the window manager and the monitor — it does not by itself rescale Caspar’s internal buffer unless separate consumer/stretch settings are used.
- Document this distinction in UI copy where confusion is likely.

---

## 2. Data flow summary

```
Screen destinations  ──►  Caspar config (channels, screen consumers, positions)
        │
        │  (default) same WxH + tiling hint
        ▼
Device graph edge  ──►  screen index N  ──►  xrandr: output=sysId, --mode, --pos
        │
        │  (override on)
        ▼
Inspector Override + dropdown/custom  ──►  xrandr --mode / --rate from user choice
```

---

## 3. Related code (current anchors)

- **Implementation method (screen index, apply-os, override):** [`docs/xrandr-gpu-screen-mapping.md`](../../docs/xrandr-gpu-screen-mapping.md) (repo root `docs/`).  
- Layout planning: `src/utils/os-layout-calculator.js`, `src/utils/os-config.js` (`applyX11Layout`).
- Apply pipeline: `src/api/settings-os.js` (`POST /api/settings/apply-os`).
- UI: `web/components/device-view-inspector-gpu.js`, `device-view-bands-render.js`, `device-view-caspar-render.js`.
- Destination definitions: `src/config/screen-destinations.js` and persisted `screenDestinations` in config.

---

## 4. Glossary

| Term | Meaning |
|------|--------|
| Screen destination | Logical output definition (mode, position on canvas, main index). |
| GPU connector (`gpu_out`) | Physical video output; bound to a screen via graph edge. |
| Override | User flag: OS xrandr mode/rate come from inspector, not from destination topology. |

---

*Last updated: 2026-05-15 — authored for HighAsCG Device View / OS layout alignment.*
