# WO-364 — PRV of a pgm_prv destination cannot be cabled to a GPU connector (todos28 follow-up, owner 28.07)

**Status: DONE (28.07.26 — built + verified offline and against the live server; owner presses Apply for the Caspar/X restart)**

Owner: "i tried connecting the prv of screen dest 1 to a gpu connector and it grabs the cable
from pgm always." / "in matrix view its not even split."

## 1. Investigation

The PRV output of a `pgm_prv` destination has NO server-side representation — the UI's PRV
port dot is cosmetic today:

- `client/components/device-view-destinations-ui.js` renders separate `pgm-out` / `prv-out`
  pair dots, but both drop handlers call the same callback with only `(connectorId,
  destination, intent)` — which half was hit is never passed on.
- `client/lib/device-view-gpu-source-inherit.js` `gpuOutputBindingFromCableSource()` maps a
  destination cable source (`dst_in_<id>`) to `{ type: 'screen', index: mainIdx + 1 }`
  unconditionally — that binding means "screen N's PGM screen consumer". A connector can hold
  one binding, so cabling the PRV dot rewrites the same binding → "grabs the cable from PGM".
- Server side, `src/config/device-graph-output-mapping.js` `destinationToVideoSource()`
  returns `program_<N>` for every pgm_prv destination; the `outputLayer` edge note (1=PGM,
  2=PRV, used for the "PRV:" labels on DeckLink edges) is only ever used to sort winners —
  nothing maps layer 2 to `preview_<N>`.
- `src/config/config-generator-consumer-attach-screen.js` `buildScreenPairChannels()`: the
  PRV channel gets only compose-preview/audio/rtmp consumers — there is no `<screen>`
  consumer option for the preview channel at all, and `src/utils/os-layout-calculator.js`
  allocates window rects only for PGM screen consumers.
- Matrix view: destinations enter the matrix through the same `program_N` source id, so a
  pgm_prv destination is one node — no PGM/PRV split (matches "in matrix view its not even
  split").

## 2. What implementing it needs (plan, not yet built)

1. Cable identity: pass the pair half into the drop/click path; PRV cabling writes a distinct
   binding (e.g. `{ type: 'screen_prv', index: N }`) or `outputLayer: 2` on the edge.
2. Generator: emit a `<screen>` consumer inside the PRV channel XML when a GPU port is bound
   to PRV; extend the OS layout calculator to place that window on the bound connector
   (xrandr rect + screen_count bookkeeping so PGM and PRV claim different ports).
3. Matrix + destination card: render PGM and PRV as separate sinks; keep DeckLink's existing
   `outputLayer` labels consistent with the new binding.
4. Guard: refuse cabling PRV when no preview bus exists for that main (pgm_only,
   previewEnabledByMain false).

Cost note: a PRV screen consumer is another GL output window on the single GPU — needs a
Caspar restart and a quick perf sanity check alongside the operator-GUI channel.

## 3. Build decisions (28.07)

- Source of truth for "this cable is PRV": the graph edge's note `{outputLayer: 2}` — the
  same convention the DeckLink destination edges already use for their "PRV:" labels. No new
  outputBinding type for identity; bindings stay derived.
- "Outside routing" landed first: `destinationToVideoSource()` now maps a pgm_prv destination
  edge with outputLayer ≥ 2 to `preview_<N>` (stream/record/RTMP/v4l2 all already resolve
  `preview_N` via `resolveInputTargetToChannel`). pgm_only/pixelmap stay program-only.
- Physical head: the box currently has DP-6 = PGM (2560x896), DP-0 = operator GUI, and DP-2
  connected but unconfigured — the owner's plugged PRV cable; live verification target.

## 4. What was built (28.07, commit 71aa5a1)

Server: edge note `{outputLayer:2}` identifies the PRV half everywhere. `destinationToVideoSource`
maps layer-2 pgm_prv edges to `preview_<N>` (stream/record/RTMP/v4l2 "outside routing").
Layout pipeline grew a PRV head class mirroring multiview: assign (binding `screen_prv` or
layer-2 edge) → place (same raster as the pair, packed after screens+mv) → mapping-GPU
merge/offset → xrandr apply + layout verify (canvas-expansion check included) + settings-os
`screen_N_prv_os_*` keys. `applyLayoutPositionsToMerged` writes `screen_N_prv_screen_consumer`
+ `_prv_x/_prv_y`; `buildScreenPairChannels` emits a `<screen>` consumer on the PRV channel
(own device number); PGM consumer gating uses a PGM-only reachability map so a PRV-only cable
never enables screen_N. Client: pair-dot half → cable arm/drop → edge note + `screen_prv`
binding; PRV cables skip PGM settings seeding; matrix view splits pgm_prv into PGM/PRV rows
(cell toggle reads/writes the note).

## 5. Verified

- Suite 1559/1559 incl. new `smoke-wo364-prv-output-routing.test.js` (videoSource mapping,
  edge threading, preview channel resolution).
- Dry-run against the box's real config + synthetic PRV edge: PRV head lands on DP-2
  2560x896@4480,0 (PGM DP-6 and operator DP-0 untouched), PRV channel XML gains the screen
  consumer at device 2, PGM channel unchanged.
- Live: staged the real cable via API (edge `dst_in_dst_mrzeocxh_1 → gpu_p1` note
  outputLayer 2 + `screen_prv` binding); the RUNNING server's
  `/api/caspar-config/generate` now emits the PRV head channel.
- NOT yet applied: Apply Caspar + OS layout (Caspar restart; DP-2 head extends the X canvas
  to 7040px → expect a session restart prompt). Left to the owner — box in active use.
