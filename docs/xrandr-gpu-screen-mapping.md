# xrandr GPU ↔ screen mapping (Device View)

This document is the **implementation-facing** companion to the product narrative in [`work/docs/GPU_SCREEN_CONSUMER_AND_XRANDR.md`](../work/docs/GPU_SCREEN_CONSUMER_AND_XRANDR.md). It describes how HighAsCG picks **screen index `N`**, **`screen_N_*` settings**, and the **xrandr plan** so **Apply GPU** / `POST /api/settings/apply-os` does what operators expect.

---

## 1. Screen index `N` (must be consistent everywhere)

`N` is the **1-based Caspar main screen index** (`screen_1_*` … `screen_4_*`). It must match between:

- `calculateLayoutPositions` (`src/utils/os-layout-calculator.js`) for graph-bound `gpu_out`, and  
- Device View GPU inspector (`web/components/device-view-inspector-gpu.js`), which reads/writes `screen_${N}_*`.

**Resolution order (same as the layout calculator):**

1. **`gpu_out.caspar.outputBinding`** — if `type === 'screen'`, use **`outputBinding.index`** (already 1-based).
2. Else **incoming graph edge** `dst_in_<destinationId>` → `gpu_out.sinkId` — use that destination’s **`mainScreenIndex + 1`** (PGM/PRV routable destinations only; not stream/multiview).
3. Else **`gpu_out.caspar.mainIndex`** (0-based) → `N = mainIndex + 1`.
4. Else **fallback**: order of `gpu_out` in the suggested connector list (legacy only).

If the UI used a different rule (e.g. suggested list order), operators could set **`screen_2_*`** while the head was really **screen 1** — override and OS mode would never apply to the head that xrandr moves.

---

## 2. Default vs override (what drives `--mode`)

| Override (`screen_N_force_os_resolution`) | Source of xrandr `--mode` / width |
|---------------------------------------------|-------------------------------------|
| **Off** | Bound **destination `videoMode`** (and custom WxH×fps) wins over a “stale” explicit `screen_N_os_mode` when they disagree — see `explicitPixelOsMode` branch in `os-layout-calculator.js`. |
| **On** | **Caspar video mode** for that screen (`screen_N_mode` in `casparServer`, or connector default) maps through `mapCasparModeToXrandrRes`. **Additionally**, if `screen_N_os_mode` is already an explicit pixel string (`1920x1080`), that value is used as **`modeForXrandr`** (operator / UI set the OS line explicitly). |

Refresh / rate: `screen_N_os_rate` when set; else inferred from the Caspar mode id where applicable (`inferRefreshHzFromCasparMode`).

---

## 3. `POST /api/settings/apply-os` contract

Handler: `src/api/settings-os.js` → `handleOsPost`.

1. **`mergeSystemDisplaySettings(ctx, s)`** — merges **root** keys in `SYSTEM_DISPLAY_KEYS` from the JSON body `s` into **`ctx.config`** (`screen_N_system_id`, `screen_N_os_mode`, `screen_N_os_rate`, `screen_N_force_os_resolution`, timing source, etc.).

2. **`s.casparServer`** — if present, merged into **`ctx.config.casparServer`** (so **`screen_N_mode`**, custom WxH, override mirror in `casparServer`, etc. exist before layout). `mergeSystemDisplaySettings` alone does **not** touch `casparServer`.

3. **Persistence** — when writing modular config, **`SYSTEM_DISPLAY_KEYS` are copied from `ctx.config` (`cfg`) into `newConfig` not only when a key appears in `s`, but also when `cfg[k] !== cur[k]`** (`cur` = previous `configManager.get()`). Otherwise a flag set only in memory (or omitted from a minimal client body) could be **lost on save**, and the next reload would revert to destination-driven **720p** while logs still showed **1920x1080** for `os_mode` on the in-memory merge.

4. **`calculateLayoutPositions(ctx.config)`** then **`applyX11Layout`** — logs `[settings-os] plan id=…` lines; xrandr runs with resolved modes (including EDID fallback / CVT create when enabled).

Device View **Apply resolution** sends **`apply-os`** a body that includes both **root OS keys** and a **`casparServer` slice** for the active screen so steps 1–2 are satisfied in one request.

---

## 4. UI ↔ server keys (GPU inspector)

- **Override checkbox** → root **`screen_N_force_os_resolution`** and **`casparServer.screen_N_force_os_resolution`** (kept in sync on save/apply).
- **Video mode** (Caspar) → **`casparServer.screen_N_mode`** (+ custom width/height/fps keys when `custom`).
- **With override on**, OS apply uses **Caspar video mode** mapped to **`screen_N_os_mode` / `screen_N_os_rate`** (see `casparVideoModeToOsModeAndRate` in `web/components/device-view-destinations-inspector.js`) so xrandr is not accidentally driven only by the EDID dropdown (which still reflects the **current** link).

---

## 5. Code map

| Concern | Location |
|---------|----------|
| Layout / `modeForXrandr`, override, topology | `src/utils/os-layout-calculator.js` |
| xrandr execution, mode availability, CVT | `src/utils/os-config.js`, `src/utils/xrandr-custom-mode.js` |
| apply-os merge + save | `src/api/settings-os.js` |
| Full settings merge | `src/api/settings-post.js` (`mergeSystemDisplaySettings`) |
| GPU inspector screen index + apply payload | `web/components/device-view-inspector-gpu.js` |
| Caspar mode ↔ OS WxH helper (web) | `web/components/device-view-destinations-inspector.js` (`CASPAR_VIDEO_MODE_SPECS`, `casparVideoModeToOsModeAndRate`) |
| Regression tests | `npm run test:os-layout-w40` → `tools/smoke-os-layout-w40.js` |

---

## 6. Operator checklist

1. Cable **destination** → **`gpu_out`**; confirm **screen `N`** in the inspector title matches the destination **main index** you intend.  
2. **Override off** — xrandr follows **destination video mode**; EDID row is a hint / alternate OS apply path (“Use detected display mode”).  
3. **Override on** — set **Video mode** (and optional custom timing); **Apply resolution**; confirm logs show **`plan id=<connector> mode=<WxH>`** matching **1080p** (or your choice), not the old link resolution.  
4. If the monitor has no matching mode line, enable **`os_xrandr_create_missing_modes`** and appropriate **timing source** (CVT/GTF) so the server can create a line before applying.

---

*Last updated: 2026-05-15 — documents behaviour verified after Device View + `apply-os` persistence and layout calculator fixes.*
