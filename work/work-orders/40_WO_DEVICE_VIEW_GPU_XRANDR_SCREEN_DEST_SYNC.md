# Work Order 40: Device View — GPU xrandr sync with screen destinations and override

> **AGENT COLLABORATION PROTOCOL**  
> Every agent that works on this document MUST:  
> 1. Add a dated entry to the **Work Log** section at the bottom.  
> 2. Update task checkboxes to reflect current status.  
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.  
> 4. Do **not** delete previous agents’ log entries.

**Parent / context:** [WO-33 Device View index](./33_WO_DEVICE_VIEW_INDEX.md); design reference [GPU / screen consumer interaction](./docs/GPU_SCREEN_CONSUMER_AND_XRANDR.md)  
**Sub work orders:** [WO-40a — Pixel map → GPU, xrandr, Caspar alignment](./40a_WO_PIXEL_MAP_GPU_XRANDR_CASPAR_ALIGNMENT.md) (mapping-fed `gpu_out`, mixed heads, inherited canvas modes)  
**Status:** Draft  
**Prerequisites:** [33a](./33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md) (graph + settings); [35](./35_WO_GPU_PHYSICAL_CONNECTOR_STABILITY.md) (stable `gpu_out` IDs)

---

## 1. Goal

Implement the **intended workflow** for Device View so that:

1. **Screen destinations** define CasparCG channels and their placement in generated config.
2. **Cabling** a channel / screen output to a **GPU connector** binds that connector to **that** logical screen’s consumer.
3. **By default (Override off):** `POST /api/settings/apply-os` / **Apply GPU** drives **xrandr** so that each bound head uses:
   - **`--mode`** (and rate where applicable) derived from the **bound screen destination’s** video mode (including custom WxH×fps).
   - **`--pos`** equal to the **destination’s layout position** (and horizontal tiling for multi-screen matches cumulative widths from **actual** modes).
4. **With Override on:** the user’s **inspector** choice (EDID dropdown and/or **custom** fields) drives **`--mode` / `--rate`** for that head only; **positions of all subsequent heads** are recomputed from **applied** widths so the X desktop stays coherent.

---

## 2. Normative behaviour (acceptance-oriented)

### 2.1 Binding resolution

- [ ] **T40.1** Given an edge from a **destination input** (`dst_in_<id>`) to `gpu_out`, resolve **screen index `N`** consistently with Caspar generator / `outputBinding` rules (no off-by-one between UI screen number and `screen_N_*` keys).
- [ ] **T40.2** If multiple edges conflict, surface a **warn** state in Device View API + inspector (do not silently pick).

### 2.2 Default layout (Override off)

- [x] **T40.3** `calculateLayoutPositions` (or successor) uses **destination videoMode + width/height/fps** for head `N` tied to that GPU, not only topology from “first PGM destination” when a **specific** screen is bound.
- [ ] **T40.4** **`--pos`** for screen `N` uses **screen destination position** fields (same coordinate space as tandem / consumer layout); multi-screen **cumulative X** uses each head’s **resolved xrandr width** after mode resolution.
- [ ] **T40.5** Changing a destination’s mode or position in Settings → **Apply GPU** (or apply-os) updates **all** affected heads in one plan (log shows full command preview per head).

### 2.3 Override path

- [x] **T40.6** With **`screen_N_force_os_resolution`** true, **ignore** destination-derived WxH for **that** `N` only; use inspector EDID/custom selection for `--mode` / `--rate` (existing partial implementation — verify end-to-end after T40.3–T40.5).
- [x] **T40.7** After override mode apply, **re-tile** following heads’ `--pos` using **effective** widths (override may differ from destination width).

### 2.4 UI / UX

- [ ] **T40.8** Short copy in inspector: **Override** = “OS monitor mode differs from channel; Caspar consumer mode unchanged unless you change Video mode.” (Link to [design doc](./docs/GPU_SCREEN_CONSUMER_AND_XRANDR.md).)
- [ ] **T40.9** When Override off, optionally **dim or label** EDID row as “hint / apply to OS only” vs primary driver (destination) — avoid implying two masters without explanation.

### 2.5 Tests

- [x] **T40.10** Unit tests for layout: single GPU + one destination `720p50` @ `0,0` → mode `1280x720`, rate `50`, pos `0,0`.
- [x] **T40.11** Two destinations, two cables, two system IDs → positions `0,0` and `1280,0` (example) after first head width 1280.
- [x] **T40.12** Override on + custom 1920×1080 @ 50 → first head 1920×1080; second head’s **pos** shifts if second screen still destination-driven.

---

## 3. Implementation notes (for implementers)

- **Single source of truth** for “what mode does destination `D` imply?” should match **Caspar XML generation** (reuse `getModeDimensions` / `STANDARD_VIDEO_MODES` / same helpers as `os-layout-calculator` today).
- **Root vs `casparServer` keys:** keep `screen_N_force_os_resolution` and OS pixel fields consistent with `settings-os` / `SYSTEM_DISPLAY_KEYS` patterns established in prior patches.
- **apply-os** body from companion may only send partial OS fields — ensure **reload** path (`configManager` `change` → `syncRuntimeConfigFromManager`) does not drop flags mid-request (see WO log if regressions).

---

## 4. Do **not** implement (explicit rejections)

The following are **not** deferred features and **must not** be implemented under WO-40 or as follow-on work without a new product decision. They are brittle, surprising for operators, or blur responsibility between OS and Caspar.

- **Implicit OS apply:** Never run xrandr (or equivalent) automatically on every destination/settings edit. The user must deliberately **Apply GPU** / apply-os so display changes stay predictable and reviewable.
- **NVIDIA parity chase:** Do not expand scope to match `nvidia-settings` behaviour or parity; stay **xrandr-first** unless the project explicitly adopts a different policy elsewhere.
- **Caspar-side rescaling / FILL to “fix” OS mismatch:** Do not add logic to rescale the screen consumer or force **FILL** to paper over OS vs channel resolution differences as part of this workflow—that couples two layers and hides misconfiguration.

---

## 5. Acceptance criteria (summary)

1. With Override **off**, xrandr plan matches **bound** screen destination **mode + position** for each cabled GPU head.  
2. With Override **on**, xrandr plan matches **inspector** choice for that head; **other** heads still layout correctly.  
3. Multi-head **horizontal** positions always consistent with **resolved** mode widths.  
4. Device View shows **warn** on binding conflicts, never silent wrong screen index.

---

## 6. Work log

| Date | Agent / role | Summary |
|------|----------------|--------|
| 2026-05-15 | — | WO created from product workflow description; linked design doc added under `work/docs/`. |
| 2026-05-15 | Agent | Graph `gpu_out` ← `dst_in_*`: `casparMode` for OS layout prefers bound destination `videoMode` unless `screen_N_force_os_resolution` (Override) is on; stream edges no longer infer a PGM screen binding. Topology-derived WxH skipped when Override is on; inferred refresh used when `os_rate` unset. Added `npm run test:os-layout-w40` (`tools/smoke-os-layout-w40.js`). |
| 2026-05-15 | Agent | Documented implementation method in repo `docs/xrandr-gpu-screen-mapping.md` (screen `N` resolution, apply-os + persistence, override + explicit `screen_N_os_mode`); linked from `work/docs/GPU_SCREEN_CONSUMER_AND_XRANDR.md`. |

### Instructions for next agent

- **T40.4 / T40.5:** Destinations still have no persisted `x`/`y`; horizontal strip uses placement order + resolved widths (matches cumulative consumer strip when origins are 0). Add destination layout fields + generator parity if product requires non-zero origins.  
- **T40.1–T40.2:** Binding conflict detection + API/inspector warn.  
- **T40.8–T40.9:** Inspector copy + EDID row hint.  
- Run `npm run test:os-layout-w40` after layout changes.  
- Do **not** implement anything listed in §4 (explicit rejections).

---

*End of WO-40*
