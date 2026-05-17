# Work Order 40a (sub of WO-40): Pixel mapping → GPU — what each head “gets”, xrandr, and Caspar alignment

> **AGENT COLLABORATION PROTOCOL**  
> Same rules as [WO-40](./40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md): dated work log at bottom, update checkboxes, instructions for next agent, do not delete prior log rows.

**Parent:** [WO-40](./40_WO_DEVICE_VIEW_GPU_XRANDR_SCREEN_DEST_SYNC.md) (GPU / xrandr / destinations / Override)  
**Related:** [WO-33h](./33_WO_DEVICE_VIEW_INDEX.md) (pixel mapping node), [GPU_SCREEN_CONSUMER_AND_XRANDR.md](./docs/GPU_SCREEN_CONSUMER_AND_XRANDR.md)  
**Status:** Draft  

**Hard boundary:** Do **not** implement anything listed under WO-40 **§4** (explicit rejections), especially implicit xrandr on every edit and Caspar **FILL** hacks to hide OS mismatch.

---

## 1. Problem statement

A **`gpu_out`** connector may be fed **either**:

- directly from a **screen destination** input (`dst_in_<id>` → `gpu_out`), or  
- from a **pixel mapping node output** (`pixel_map_out` → `gpu_out`).

Operators need the stack to know **what each physical head receives** (canvas size, slice within canvas, frame rate, logical placement on the X desktop) so that:

1. **`xrandr`** (or successor apply path) emits a **coherent multi-output** plan (`--output … --pos … --mode …`) per head.  
2. **Caspar** screen consumer geometry (position, size, windowed/borderless) **matches** that plan when the design is “one large logical framebuffer” spanning multiple physical outputs and/or additional heads cabled from destinations.

WO-40 today focuses on **destination → GPU** edges. **40a** covers **mapping → GPU**, **mixed** graphs (some heads from mapping, some from destinations), **inherited** “full canvas” modes on heads without a matching EDID mode, and **Override** when OS mode differs but the Caspar window must stay put.

---

## 2. Reference scenario (normative example)

**Caspar:** Channels **1 / 2** (PGM/PRV) use a single program **screen consumer** at **5120×1024 @ 50p** (custom video mode), **windowed**, **borderless**, spanning the mapped region.

**Pixel mapping node:** Input is that program feed. On an internal **1080p-class canvas**, the node **splits** into **three** GPU-bound outputs:

| Output | OS / xrandr intent | Slice / role (example) |
|--------|---------------------|---------------------------|
| A | **1920×1080** @ **pos 0,0** | First third of the mapped layout |
| B | **1920×1080** @ **pos 1920,0** | Second third |
| C | **1920×1080** @ **pos 0,3840** | Third region (**authoritative geometry is `node.settings.mappings` / outputs**) |

**Fourth physical output:** A **screen destination** is cabled **straight** to a **fourth** `gpu_out` (no mapping node). By default:

- **xrandr `--pos`:** immediately **after** the mapping group’s **axis-aligned bounding box** on the X desktop. In a **purely horizontal** 3×1920 strip, the fourth head starts at **5760,0**. If a head is at **(0, 3840)** instead, the bbox is not “width only” — the planner must use the **union** of all mapping heads’ rectangles plus margins.  
- **Default OS mode (“inherited”):** try to drive the panel with the **same timing family** as the Caspar canvas (**5120×1024 @ 50**), including **custom mode creation** when EDID does not advertise that mode (document operator-safe flow: `cvt` / `xrandr --newmode` / `--addmode` / `--mode`, with fallbacks and logging — exact commands are product/QA detail).  
- **Override:** operator chooses e.g. **5760×1080 @ 50** for that head’s OS mode, but the **Caspar screen consumer** for the destination-driven head remains placed at **(5760, 0)** with the **consumer pixel size** implied by the destination / channel (not silently stretched to “fix” OS — see WO-40 §4).

**Example xrandr shape** (illustrative only — connector names vary):

`DISPLAY=:0 xrandr --output HDMI-0 --pos 0x0 --mode 1920x1080 --output DP-0 --pos 1920x0 --mode 1920x1080 --output DP-2 --pos 0x3840 --mode 1920x1080`

**Caspar config** must agree: one **5120×1024** window whose **origin and desktop footprint** match how those outputs are tiled (and the fourth head’s consumer **x/y** align with **5760,0** in this example).

---

## 3. How this resolves **today** (code trace — gaps explicit)

This section is **descriptive of current code**, not the target behaviour.

### 3.1 OS layout (`calculateLayoutPositions`, `src/utils/os-layout-calculator.js`)

- GPU assignments and destination-derived **`casparMode`** (WO-40) apply when an edge exists: **`sourceId = dst_in_*`**, **`sinkId = gpu_out`**.  
- There is **no** branch that treats **`pixel_map_out` → `gpu_out`** as a first-class signal source for mode, rate, or position.  
- **Implication:** mapping-fed heads rely on legacy **`screen_N_system_id`** keys and generic layout rules unless extended; they do **not** automatically inherit mapping slice **pos** or full-canvas **inherited mode** from this calculator.

### 3.2 Pixel mapping merge into generator config (`applyPixelMappingProgramScreens`, `src/config/pixel-mapping-config.js`)

Two relevant paths:

1. **DeckLink-only** (outputs cabled only to DeckLink): builds **`screen_${n}_decklink_tiles`** from **`node.settings.outputs`** + **`mappings`** rects; sets **`screen_${n}_mode = custom`** with merged width/height from tiles — aligned with “one wide channel, tiled SDI”.  

2. **Any non-Deck cable from mapping outputs** (`hasNonDeckCable`): for **GPU** sinks, the code loops **`pixel_map_out` → `gpu_out`** and, per edge, may set **`screen_${feed.screenIndex}_mode/custom_*`** from **`hardware.displays`** matched by the GPU connector’s **`externalRef`** — **not** from the mapping output’s slice rectangle on the canvas, and **not** from the full **5120×1024** canvas dimensions.  
   - **Multiple** mapping outputs that share the **same** program **`feed.screenIndex`** can **overwrite** the same **`screen_${n}_*`** keys in the merge loop (**last writer wins**).  
   - **Implication:** the reference scenario (three distinct heads + one consumer geometry + fourth destination head) is **not** faithfully represented end-to-end.

### 3.3 Graph reachability elsewhere (`build-caspar-generator-config.js`)

- **`resolveDestinationSourceForConnector`** can walk **`pixel_map_out` → `pixel_map_in`** for **DeckLink** source resolution.  
- **`reachesGpuFromSource`** includes **`pixel_map_in`** when deciding if a destination reaches a GPU (screen consumer enablement path).  

These paths help **cabling semantics** but do **not** replace a unified **per-head OS layout + Caspar geometry** model for mapping → GPU.

### 3.4 Summary gap table

| Need | Today |
|------|--------|
| Per **`gpu_out`**, know signal: mapping slice vs destination | Partially in merge; not in OS calculator |
| **`xrandr --pos`** from mapping rects + group bbox for “next” head | Not derived from mapping node |
| Inherited **5120×1024@50** on a head without EDID mode | Not automated; WO-40 custom/xrandr story is screen-destination-centric |
| One Caspar consumer + multi-head xrandr consistency | Split across merge + channels; no single planner |
| Override: OS 5760×1080, consumer at (5760,0) **5120×1024** | WO-40 Override for **destination** heads; mapping heads unspecified |

---

## 4. Target behaviour (acceptance-oriented)

- [x] **T40a.1** For every **`gpu_out`** with an incoming edge, resolve **provenance**: direct **`dst_in_*`** vs **`pixel_map_out`** (node id + output id / index). *(Calculator + apply-os now consume `pixel_map_out`→`gpu_out` via `buildMappingGpuLayoutArtifacts`; provenance fields `nodeId`, `mapOutId`, `outputId` on each `mappingGpuOutputs[]` row.)*
- [x] **T40a.2** From a pixel mapping node, derive **per output**: canvas-relative **rect**, **output mode** (or custom WxH×fps), and **contribution to X desktop bounding box** for ordering against other heads. *(Implemented: `mappings[].rect` + `STANDARD_VIDEO_MODES` for default WxH; `mappingGpuBBox` union bbox.)*
- [x] **T40a.3** **`calculateLayoutPositions`** (or a single shared planner consumed by it and Caspar generation) emits **one ordered multi-head plan** so mixed **mapping + destination** heads produce a valid **`xrandr`** argument sequence (naming outputs by stable connector → OS name mapping already used elsewhere). *(**Partial / v1:** `applyX11Layout` runs `mappingGpuOutputs` first (dedupe `sysId`), then screen/multiview; destination-only `results.screens`: **`x += mappingGpuBBox.maxX`** when bbox is **wider-or-square** vs tall, else **`y += mappingGpuBBox.maxY`** when taller (skip mapping feed screen(s); respect manual `screen_N_os_x` / `os_y`). **Still open:** single shared module with Caspar channel **pos** math, L-shaped bbox, `newmode`.)*
- [x] **T40a.4** **Default** mode for a mapping-fed head: **inherited canvas timing** when product chooses that policy; when the mode is absent from EDID, run a **documented, logged** custom-mode path (no silent failure). *(**Implemented:** `node.settings.osXrandrHeadMode === 'canvas'` (union WxH on each head’s planned `--mode`); **`os_xrandr_create_missing_modes`** on root or `casparServer` runs **`cvt` → `xrandr --newmode` → `--addmode`** when `WxH` is missing from the `xrandr --query` list, then applies that mode name. **Caveat:** persisted `/etc/highascg/apply-layout.sh` still records only the final `--output … --mode` line — modes may need re-creation after cold boot until a follow-up WO extends the script.)*  
- [ ] **T40a.5** **Override** on a mapping-fed or post-mapping destination head: OS **`--mode` / `--rate`** follow inspector; **Caspar `<x>/<y>` and consumer WxH** follow the WO-40 principle (consumer unchanged unless operator changes video mode / layout in Caspar settings — no **FILL** auto-fix per WO-40 §4).  
- [x] **T40a.6** **Caspar XML / merged config** for “one **5120×1024** window spanning mapped heads” stays **consistent** with the same planner (no last-writer overwrite of **`screen_${n}_*`** for unrelated heads). *(**Partial:** `applyPixelMappingProgramScreens` GPU path now sets **one** `screen_${feedN}_mode/custom_*` from the **union** of mapping output slices (fallback horizontal pack when rects missing). **Still open:** prove parity with `calculateLayoutPositions` / consumer `<x>` `<y>` for every edge case.)*
- [x] **T40a.7** **Tests:** fixture graph with **three** `pixel_map_out` → **three** `gpu_out` + **one** `dst_in_*` → **fourth** `gpu_out`; assert xrandr plan positions and fourth head **x**; assert merged Caspar screen keys match intended single-screen consumer layout. *(Covered by `tools/smoke-mapping-gpu-os-layout.js`: bbox + mixed layout + `applyPixelMappingProgramScreens` merge.)*

---

## 5. Implementation notes

- Prefer **one planner** shared by **`os-layout-calculator`** and **`build-caspar-generator-config` / channel builder** so Caspar **pos** and xrandr **--pos** cannot drift.  
- **Model risk:** today **`screen_N`** often lines up with “Caspar logical screen N”. Mapping scenarios may require **either** multiple logical screens with one consumer only on the feed screen, **or** a first-class **per-physical-output** layout list — decide explicitly in design before coding (document the choice in this WO’s work log).  
- **Custom xrandr modes:** keep operator-visible logging; never apply without the same **Apply GPU** / apply-os consent model as WO-40.  
- **Pixel mapping node `settings`:** optional **`osXrandrHeadMode`**: `'slice'` (default, per-output `--mode` from mapping rect) or **`'canvas'`** (each GPU head’s planned `--mode` is the **full canvas union** WxH — may require EDID override / `newmode`; see `pickBestAvailableMode` warnings in logs).  
- **Global / `casparServer`:** **`os_xrandr_create_missing_modes`** (`true` / `1`) — when **Apply GPU** runs, if a planned `WxH` mode is absent from EDID, run **`cvt`** + **`xrandr --newmode`** + **`--addmode`** for that output (logged). Default **false** (opt-in; avoids surprising systems).

---

## 6. Work log

| Date | Agent / role | Summary |
|------|----------------|--------|
| 2026-05-15 | Agent | WO-40a drafted: reference scenario (5120×1024 + 3 mapping heads + 4th destination head), current-code trace (`os-layout-calculator` vs `pixel-mapping-config`), gap table, acceptance tasks T40a.1–T40a.7. |
| 2026-05-15 | Agent | **Slice 1:** `mapping-gpu-os-layout.js` — `pixel_map_out`→`gpu_out` rows + `mappingGpuBBox`; `calculateLayoutPositions`; apply-os / `applyX11Layout` order + dedupe; mixed graph X offset (skip mapping feed screen; manual `screen_N_os_x`). |
| 2026-05-15 | Agent | **Slice 2:** `applyPixelMappingProgramScreens` GPU path — single union canvas via `outputs`+`mappings` (no per-connector last-writer); smoke merge test. |
| 2026-05-15 | Agent | **Slice 3:** `computePixelMappingCanvasUnion` shared helper; `osXrandrHeadMode` slice vs canvas; destination offset Y when bbox taller-than-wide; vertical + canvas smoke tests. |
| 2026-05-15 | Agent | **Slice 4:** `os_xrandr_create_missing_modes` + `cvt` / `xrandr --newmode` / `--addmode` (`xrandr-custom-mode.js`); empty mode-set for unknown outputs; `settings-os` + `SYSTEM_DISPLAY_KEYS`; `npm run test:xrandr-custom-mode`. |

### Instructions for next agent

- **Persisted startup script:** extend `/etc/highascg/apply-layout.sh` to prepend `newmode`/`addmode` lines when custom modes are used (cold boot).  
- **T40a.5:** Override / per-head OS flags for mapping outputs.  
- **T40a.3:** L-shaped bbox (both X and Y offsets).  
- Run `npm run test:xrandr-custom-mode`, `npm run test:mapping-gpu-os-layout`, `npm run test:os-layout-w40`.  
- Do **not** implement WO-40 §4 rejections.

---

*End of WO-40a*
