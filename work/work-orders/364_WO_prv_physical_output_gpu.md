# WO-364 — PRV of a pgm_prv destination cannot be cabled to a GPU connector (todos28 follow-up, owner 28.07)

**Status: OPEN (investigated 28.07.26 — root cause is a missing feature, not a wiring bug)**

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
