# WO-451 — GPU layout editor: one-step drag works; mismatch banner only on real wiring change

**Status: DONE (06.08.26 — client + server fixed, smokes repointed; build + restart in batch tail)**

Owner (todos06.08 line 26): *"i edited layout of gpu ports so it reflects my actual ports on
the card, first of all rearenging the ports doesnt take with first try, second i get an
error: Detected GPU wiring differs from saved layout — open a GPU port in the inspector and
use the layout editor to review."*

## 1. Investigation

1. **Reorder no-op**: the layout editor's drop handler
   (`device-view-inspector-gpu-layout-editor.js`) always inserted BEFORE the drop target
   (`insertAt = index - 1` when dragging down). Dragging a socket ONE slot down — the most
   common gesture — removed and reinserted it at its own position: a silent no-op. Dragging
   two slots "worked", hence "doesnt take with first try". The save path itself is sound
   (POST `/api/settings` → `gpuPhysicalTopology` + operator-saved marker → snapshot rebuilds
   `physicalMap` from config per request, no stale cache involved).
2. **Permanent banner**: `buildGpuPhysicalMap` raised `topologyMismatch` via
   `topologyDiffers(savedConfig, discoveredRows)` which compared rows INCLUDING slotOrder
   and per-row port assignment (`topologyRowsEqual`). Any deliberate operator reorder
   therefore differed from DRM-discovery order forever — the WO-108 banner (meant for
   xrandr enumeration changes after reboot) became a permanent false alarm exactly when the
   operator did what the banner asks for.

## 2. What was done

- Editor drop: insert-before/after by pointer half (border-top/bottom indicator follows);
  `insertAt` arithmetic fixed so a one-step drag lands where the indicator shows.
- `topologyDiffers` replaced by `topologyPairSetDiffers`
  (`src/utils/gpu-topology-reconcile.js`): order-insensitive compare of the SET of physical
  jack pair-keys (dpA/dpB). Reordering the same jacks → no banner; discovery seeing a
  different jack set (rewired card, new GPU) → banner as before.

## 3. What was VERIFIED

- `smoke-gpu-topology-ssot.test.js` 9/9 — the pair-change assertion REPOINTED (reason
  inline): same jacks reordered → no mismatch; a genuinely different jack (HDMI-0 replacing
  DP-2/DP-3) → mismatch. eslint clean; no new orphan exports (topologyDiffers fully
  replaced, not orphaned).
- Owner QA: drag a socket one slot — it must land there on the first try; the "Detected GPU
  wiring differs" banner must clear after reload (service restart pending in batch tail)
  and stay gone for reorders of the same jacks.
