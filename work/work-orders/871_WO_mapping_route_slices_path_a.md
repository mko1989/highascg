# WO-871 — Mapping route slices (WO-869 path a): SDI scaling/rotation/warp through a slice channel

**Area:** devices-config, amcp
**Status: OPEN (30.10) — split out of WO-869, whose v1 is path (b) plus SDI placement only (owner Q2 default); needs CasparCG #1814 in the fork first**

## 1. Investigation

### 1.1 Where this comes from
- WO-869 §2.2 designed path (a): one extra Caspar channel per output that needs it. Each slice is a `route://` layer with `CROP` / `FILL` / `PERSPECTIVE` (math in WO-869 §2.2), and the output's real consumer (`<decklink>` full frame, or a `<screen>` with gpu-texture) sits on that channel.
- WO-869 shipped path (b), slices inside the screen consumer, live over `APPLY`. It covers GPU heads only. SDI gets placement only: one 1:1 slice per DeckLink output, `<subregion>` src → dest-x/y (WO-869 Q2 default; `mapping-slices-plan.js` `REASONS.SDI_PLACEMENT_ONLY`).
- So today, scaling, rotation, keystone, flips, opacity, feather and several slices on an SDI output are refused, and the first slice is still placed 1:1.

### 1.2 What already exists
- **Planner:** `src/config/mapping-slices-plan.js` already models it.
  - With `caps.routeSlices === true`, a GPU output that cannot get a slice window becomes `route-slices`, within the channel budget (`DEFAULT_CHANNEL_BUDGET`, `REASONS.OVER_BUDGET`, WO-869 Q3).
  - Nothing sets `routeSlices`.
  - SDI outputs never reach that branch; they return earlier (`sink === 'decklink'`).
- **Caps:** `src/config/caspar-caps.js` + `src/engine/caspar-caps-probe.js` (WO-869 §7). A `routeSlices` flag belongs in the same record.
- **No generator** (`config-generator-slice-channel.js` in the WO-869 §2.2 plan) **and no apply code** (per-slice `PLAY C-L route://S`, `MIXER … CROP/FILL/PERSPECTIVE`).

### 1.3 Blockers and open points (from WO-869 §1.3 / §2.2)
- **CasparCG #1814 (crop leak)** must be in the fork (`~/caspar-build/src-v2`, branch `wo742-shm-producer`) before route layers with `CROP` are safe for long runs.
- `PERSPECTIVE` is a bilinear vertex displacement with q-correction. It is exact for convex quads; the planner already refuses non-convex ones (`isConvexQuad`).
- Route latency is +1 to 2 frames, and there is one extra channel per output (budget, Q3). This needs a flash-probe measurement (WO-869 §2.2 S3).

## 2. Plan
1. Cherry-pick or port #1814 into the fork; build; scratch-Caspar soak with CROP route layers.
2. Planner: SDI outputs that are refused today go `route-slices` when `caps.routeSlices`, within budget. The caps probe sets `routeSlices` from the fork version marker or a #1814 behaviour check.
3. Generator: the slice channel (custom video-mode = output raster at source fps) plus its consumer, and the DeckLink consumer moved off the PGM channel's subregion list.
4. Apply: per-slice layers on (re)connect and live edits, serialised like `mapping-slices-apply.js`.
5. Verify: math probe on the scratch Caspar (bad=0 like WO-869 §5), a DeckLink loop or capture on the box, latency probe.

## 3. What was done
Nothing yet.

## 4. What was VERIFIED
Nothing yet.
