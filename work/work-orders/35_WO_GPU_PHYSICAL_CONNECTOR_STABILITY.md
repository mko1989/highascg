# Work Order 35: GPU physical connector stability and deterministic mapping

> **AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the "Work Log" section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear "Instructions for Next Agent" at the end of their log entry
> 4. Do NOT delete previous agents' log entries

---

## Goal

Implement reboot-resilient GPU connector mapping so Device View always reflects real physical ports in fixed order, even when runtime DP IDs (for example `DP-0` vs `DP-1`) shift between boots.

Production requirement from field behavior:

- Physical GPU has 4 output connectors
- Each physical connector can surface 2 DP IDs over runtime/driver state
- Runtime connector IDs from X/DRM can move after reboot
- UI/cabling must remain tied to physical ports, not volatile runtime IDs

---

## Confirmed field topology (authoritative for this hardware profile)

Physical order requirement (bottom -> top):

1. physical port 0: pair `DP-6/DP-7` (connector/location `0/0`)
2. physical port 1: pair `DP-4/DP-5` (connector/location `1/1`)
3. physical port 2: pair `DP-0/DP-1` (connector/location `2/2`)
4. physical port 3: pair `DP-2/DP-3` (connector/location `3/3`)

Note: Runtime observations show this can present as different active subsets (for example `2,0,4,6` then `3,0,4,7`) across boots. This is expected and must not break mapping.

---

## Scope

### In scope

- Stable physical-port data model (`gpu_p0..gpu_p3`)
- Runtime probe merge (X + DRM + optional NVIDIA data)
- Pair-aware resolver (`DP-a/DP-b` -> one physical port)
- Device View rendering in exact physical order
- Cable graph migration from volatile IDs to stable physical IDs
- Debug endpoint/logs for resolver decisions

### Out of scope (this WO)

- Auto-heal of desktop layout/positions
- Full vendor-agnostic topology autodiscovery for unknown boards
- Multi-GPU routing policy beyond single target GPU profile

---

## Probe and evidence plan (must run before final resolver lock)

- [ ] **T35.1** Capture `xrandr --query` and `xrandr --verbose` over 3+ reboots
- [ ] **T35.2** Capture `/sys/class/drm/card*-*/{status,enabled,edid}` over same boots
- [ ] **T35.3** Capture EDID hashes per connector and monitor identity decode
- [ ] **T35.4** Capture optional NVIDIA metadata (`nvidia-settings`) when available
- [ ] **T35.5** Store snapshots in test artifact folder and compare drift patterns

Command pack to use (reference):

- `DISPLAY=:0 xrandr --query`
- `DISPLAY=:0 xrandr --verbose`
- `ls -1 /sys/class/drm | rg "^card[0-9]+-"`
- `for c in /sys/class/drm/card*-*/status; do echo "=== $c ==="; cat "$c"; done`
- `for e in /sys/class/drm/card*-*/edid; do [ -s "$e" ] && sha1sum "$e" || echo "$e no-edid"; done`
- `nvidia-settings -q dpys -q gpus -t` (optional)

---

## Implementation plan

### Phase 1 — Stable model + config profile
- [x] **T35.6** Add canonical physical GPU port model (`gpu_p0..gpu_p3`) to runtime snapshot layer
- [x] **T35.7** Add hardware profile config section for pair mapping and physical order (default from confirmed topology)
- [x] **T35.8** Add per-physical-port metadata (`pair`, `runtimeBinding`, `status`, `monitor`, `confidence`)

### Phase 2 — Pair-aware resolver
- [ ] **T35.9** Implement resolver that maps runtime DP IDs to physical port by pair and history
- [ ] **T35.10** Add ambiguity state handling (never silently remap on low confidence)
- [ ] **T35.11** Persist last-known-good runtime binding history for reboot reconciliation

### Phase 3 — Device graph and migration
- [x] **T35.12** Introduce stable connector IDs (`gpu_p0..gpu_p3`) in suggestion/graph layers
- [x] **T35.13** Add migration from legacy IDs (`gpu_DP-*`, index-based, placeholder forms) to stable physical IDs
- [x] **T35.14** Keep backward compatibility reads for old project files during transition

### Phase 4 — Device View UI
- [x] **T35.15** Render GPU ports strictly in configured physical order (bottom -> top)
- [x] **T35.16** Label each port as `P# (DPa/DPb)` and show current active runtime DP + monitor status
- [x] **T35.17** Ensure cable anchors attach to stable physical IDs only

### Phase 5 — Diagnostics and QA
- [x] **T35.18** Add `/api/device-view/gpu-map-debug` with raw probes + resolver output + confidence
- [x] **T35.19** Add startup log block summarizing physical mapping and runtime binding changes
- [x] **T35.20** Add reboot regression checklist and pass criteria

---

## Acceptance criteria

- Device View always shows exactly 4 physical GPU ports in configured physical order
- Cables remain attached to correct physical port after reboot even when runtime DP IDs change
- Runtime labels may change (`DP-6` -> `DP-7`), but physical cable target does not
- No placeholder/random GPU numbering appears in rear panel
- Ambiguous mapping is surfaced as explicit warning state (not silent remap)

---

## Reboot regression checklist (execution)

Run this across at least 3 reboot cycles with unchanged physical cabling:

1. Before reboot: run `DISPLAY=:0 ./tools/gpu-map-reboot-capture.sh` and save run path.
2. Reboot host and wait until `highascg.service` is active.
3. After reboot: run `DISPLAY=:0 ./tools/gpu-map-reboot-capture.sh` again.
4. Compare `gpu-map-debug.json` and `xrandr-query.txt` across runs:
   - verify same set/order of physical IDs: `gpu_p0..gpu_p3`
   - verify each `gpu_pN.pair` remains stable (`DP-a/DP-b`)
   - allow `runtime.activePort` changes only within configured pair
5. In Device View, verify cables remain on same physical ports without rewiring.
6. Check startup logs contain `[startup] gpu physical mapping:` line and capture it.

Pass criteria:

- `gpu_p0..gpu_p3` always present in same physical order.
- Any runtime DP change stays in-port-pair (for example `DP-6 -> DP-7` for same `gpu_p0`).
- Existing cables still terminate at same physical ports after every reboot.
- No pseudo connectors (`card0`, duplicates, random placeholders) appear in rear panel.
- No resolver ambiguity silently remaps cable endpoints.

---

## Risks / notes

- Some driver states may expose incomplete connector metadata early in boot
- MST/bridge chains can alter runtime naming behavior
- EDID can be missing on disconnected ports; resolver must still preserve physical slot identity
- If multiple boards are introduced later, profile selection rules must be extended

---

## Work Log

### 2026-04-27 — Agent (WO creation from field report)

**Work Done:**
- Created WO-35 to formalize stable physical GPU connector mapping work.
- Captured confirmed physical port order and DP pair behavior from user report.
- Added phased tasks for probes, resolver, migration, UI, diagnostics, and QA.
- Added command checklist and acceptance criteria aligned to reboot ID drift problem.

**Status:** Work order created. Implementation not started.

**Instructions for Next Agent:** Start with **Phase 1 + T35.1-T35.5** to collect real probe artifacts across reboots, then implement resolver prototype behind a non-breaking compatibility path.

### 2026-04-27 — Agent (Phase-1 scaffold + debug endpoint)

**Work Done:**
- Added new utility `src/utils/gpu-physical-map.js` implementing:
  - default physical topology (`gpu_p0..gpu_p3`) with DP pair mapping from field report
  - config override hook (`config.gpuPhysicalTopology`)
  - runtime resolver combining displays + connector inventory into per-physical-port status
- Wired physical map into live snapshot:
  - `src/api/device-view-snapshot.js` now returns `live.gpu.physicalMap`
- Added diagnostics endpoint:
  - `GET /api/device-view/gpu-map-debug`
  - returns `displays`, `connectors`, `physicalMap`, and warnings
- Updated router to dispatch the new debug endpoint.

**Status:** Scaffold delivered; stable graph IDs + migration not yet implemented.

**Instructions for Next Agent:** Implement **T35.7/T35.8/T35.12/T35.13**:
1) expose `gpuPhysicalTopology` in settings get/post,
2) switch suggestion/graph GPU connectors to stable `gpu_p*` IDs,
3) add migration from existing `gpu_DP-*` edges using current physical map confidence.

### 2026-04-27 — Agent (Stable IDs + edge migration)

**Work Done:**
- Updated `src/config/device-graph-suggest.js` to prefer `live.gpu.physicalMap.ports` and emit stable GPU connectors with IDs `gpu_p0..gpu_p3`.
- Added GPU physical metadata to suggested connectors (`gpuPhysical.pair`, `slotOrder`) for downstream UI/migration.
- Added non-destructive migration in `mergeHardwareSync()`:
  - remaps legacy GPU endpoints (`gpu_DP-*` / older labels/refs) in existing edges to new `gpu_p*` IDs before connector filtering.
- Kept fallback path for environments without physical map data.

**Status:** Stable suggested IDs and edge remap are in place; settings/UI migration controls still pending.

**Instructions for Next Agent:** Complete **T35.7/T35.8/T35.14/T35.15** by exposing topology config in settings API and updating Device View labels/order to explicitly show physical ports (`P0..P3`, pair and active runtime DP).

### 2026-04-27 — Agent (Settings plumbing + physical-order UI)

**Work Done:**
- Added `gpuPhysicalTopology` defaults to `config/default.js`.
- Exposed `gpuPhysicalTopology` via settings API:
  - `src/api/settings-get.js` now returns it.
  - `src/api/settings-post.js` now validates/normalizes and persists it through `configManager`.
- Updated rear-panel GPU rendering:
  - `web/components/device-view-caspar-render.js` now prioritizes `live.gpu.physicalMap.ports`.
  - GPU ports are rendered in `slotOrder` (configured physical order) with `P# (DPa/DPb) -> active` style labels.

**Status:** Physical topology is now configurable and used in Device View ordering; stable ID display semantics are in place.

**Instructions for Next Agent:** Complete **T35.14/T35.16/T35.17**:
1) harden backward compatibility reads for old configs/projects,
2) include monitor identity/status details in labels/tooltips,
3) verify all cable anchor paths use only `gpu_p*` IDs and remove remaining legacy assumptions.

### 2026-04-27 — Agent (Monitor/status labels + anchor preference)

**Work Done:**
- Improved GPU connector resolution path (`web/components/device-view-helpers.js`):
  - `resolveConnectorId('gpu', ...)` now prefers `live.gpu.physicalMap.ports` active runtime mapping first.
  - Added slot-order fallback for physical connectors.
- Updated friendly GPU labels for stable IDs:
  - `gpu_p*` now displays as `gpu_pN (DPa/DPb)` where available.
- Enhanced rear-panel GPU tooltips (`web/components/device-view-caspar-render.js`) with:
  - connected/disconnected status
  - monitor name
  - resolution and refresh rate

**Status:** Physical-order rendering and monitor/status context are now visible; final anchor audit remains.

**Instructions for Next Agent:** Complete **T35.17/T35.14** by doing a full endpoint/connector audit for remaining `gpu_DP-*` assumptions and adding compatibility cleanup for old saved graphs where legacy IDs still appear.

### 2026-04-27 — Agent (Legacy read compatibility cleanup)

**Work Done:**
- Added backward-compatible normalization in `src/config/device-graph-core.js`:
  - legacy GPU connector IDs (`gpu_DP-*`) are auto-mapped to stable `gpu_p*` IDs during graph normalization using configured default topology.
  - edge endpoints (`sourceId`/`sinkId`) are remapped the same way.
  - dedupe pass added for connectors after ID normalization.
- This ensures old saved projects/configs load into stable physical connector IDs without requiring immediate manual rewire.

**Status:** Compatibility read path and stable anchor normalization completed.

**Instructions for Next Agent:** Execute reboot regression pass (`T35.20`) and add startup mapping summary log (`T35.19`) with physical-port to runtime-port deltas.

### 2026-04-27 — Agent (Startup mapping log + reboot checklist artifact)

**Work Done:**
- Implemented startup GPU mapping summary logging in `src/bootstrap/system-inventory-file.js`:
  - inventory build now includes `gpu.physicalMap` via `buildGpuPhysicalMap(...)`
  - startup logs now emit `[startup] gpu physical mapping: ...` with per-port `physicalId:pair=>active(state)` summary.
- Wired config-aware inventory writes in `index.js`:
  - `writeSystemInventoryFile(appCtx.log, config)` for startup and periodic refresh.
- Added reboot evidence capture script:
  - `tools/gpu-map-reboot-capture.sh` captures `xrandr`, DRM status/enabled/EDID hashes, optional NVIDIA metadata, and `/api/device-view/gpu-map-debug` JSON.
- Added explicit reboot regression checklist and pass criteria in this WO (section above).

**Status:** T35.19 and T35.20 implementation artifacts are complete; only on-target reboot execution remains.

**Instructions for Next Agent:** Run the checklist on target hardware (3+ reboot cycles), attach artifacts, and confirm acceptance criteria.

---
*Work Order created: 2026-04-27 | Series: device-view GPU stability*
