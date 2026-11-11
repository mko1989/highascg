# WO-1034 — One PGM destination on several GPU jacks (fill + key-only pair)
**Area:** devices-config, mapping
**Status: DONE (11.11 — box: cold start, DP-4 key-only shows alpha, DP-0 shows fill; suite green; 82a2e130)**

Owner, 11.11: *"i wanted to test … outputing a single pgm only screen destination and send it to 2 gpu output jacks,
with one set as key only. ive connected that, the key displays but the fill doesnt"*

## Investigation

- Device graph: destination `PGM 2` had two cables, `gpu_p2` (DP-4, port flag `key_only`) and `gpu_p0` (DP-0).
- The generated `casparcg.config` held ONE `<screen>` on the PGM channel (DP-4, key-only); DP-0 had no window.
- `src/utils/os-layout-calculator-assign.js`: `allGpuAssignments.set(n, …)` per connector — the last connector in the
  list replaced the first for the same screen. `src/config/screen-consumer-port-resolve.js`
  `resolvePhysicalPortIndexForDestination` returned the FIRST cabled jack for the port flags. One window, by design.
- After the generator wrote two windows: Caspar placed both right (log: "Windowed mode final position"), then
  `src/system/screen-consumer-placement.js` moved the fill onto the key's jack — it read one `<screen>` per channel
  and took the first window whose title matched; both windows of a channel share a title.

## What was done

- `device-graph-destination-wiring.js` `destinationPgmGpuConnectors`: the jacks a destination's PGM half is cabled to;
  [0] keeps `screen_N`, the rest are extra outputs.
- Layout: `extraScreenAssignments` → `results.screenExtra` (placed after every other head; absent without a fan-out, so
  existing layouts are byte-identical); xrandr apply / verify / offsets / operator plan know it.
- `screen-consumer-port-resolve.js` records `screen_N_extra_outputs` with each jack's own saved flags;
  `build-caspar-generator-layout-sync.js` gives them their head's geometry; `config-generator-extra-screens.js` writes
  one more `<screen>` per jack (device 61+, consumer index 660+ / 670+ key-only).
- `screen-consumer-placement.js`: every `<screen>` of a channel; a window standing on a rect is that rect's window, the
  rest pair by size, then by window id (= creation = config order).

## Verified

- `tools/smoke/smoke-wo1034-destination-fanout-gpu-jacks.test.js` (7 cases), full offline suite green.
- Box: forced Apply (Caspar restart) → three windows, none moved; half-opacity red box on PGM 2: DP-4 centre
  (127,127,127), DP-0 centre (127,0,0). Later re-checked at 3072×1024 on both jacks.
