**Status: IN PROGRESS (root-caused, fixed, verified by reproduction and full offline suite; highascg service restart still owed to take effect live)**

## Investigation

Owner report (`work/work-orders/todos07.09.26`): after rewiring PGM1's screen output to "nothing"
(disconnecting its GPU-port binding in Device View so only the operator monitor is active), the
generated `casparcg.config`'s operator-GUI `<screen>` consumer still carried `<x>2048</x>` — PGM1's
old custom-mode width — instead of `0`, so it no longer displays correctly on the one remaining
physical output.

Live config on the box at time of report (`config/device_graph.json`):
```
connectors: dst_in_dst_mtmwzq3a_1 (Operator GUI), dst_in_dst_mtmx016d_1 (PGM/PRV 1), gpu_p0..gpu_p3
edges:      dst_in_dst_mtmwzq3a_1 -> gpu_p0        (only edge in the graph)
```
PGM/PRV 1's destination object still exists (`config/screen_destinations.json`, width 2048 height
1280) — "output = nothing" only removed its device-graph edge to a GPU port, exactly as intended.
`gpu_p1`/`gpu_p2`/`gpu_p3` have no edge at all (no monitor connected there); their `caspar` metadata
is `{ bus: 'pgm', mainIndex: 0 }` on **all three**, not per-port distinct values.

Traced with a live-config reproduction (loaded `config/` for real via `ConfigManager`, called
`calculateLayoutPositions(config)` directly — see repro script, not deleted, ran against the
actual box config both before and after the fix):

Before the fix, the plan showed a phantom `screens[1]` at `x=0, width=2048` — a slot for a screen
that has no destination, no edge, and no reason to exist — and the operator's real `multiview[1]`
entry landing at `x=2048` right after it. Both resolved to the same underlying output (`sysId:
"DP-1"` on both), meaning the generator was placing two windows side-by-side on what is actually
one single physical monitor.

**Root cause, `src/utils/os-layout-calculator-assign.js`'s `collectGpuLayoutAssignments`:**
`device-graph-suggest.js` stamps every auto-suggested `gpu_out` connector with
`caspar: { mainIndex: Number.isFinite(displayIdx) ? displayIdx : 0 }` — `displayIdx` is only set
when that exact port currently has a live connected display; every disconnected port defaults to
`mainIndex: 0`. That's harmless as long as it's only trusted when there's no better information —
but `collectGpuLayoutAssignments` reads `mainIndex` off the connector unconditionally
(`let mainIndex = c.caspar?.mainIndex`, `os-layout-calculator-assign.js:81`) and, when the
connector has **no inbound edge at all**, nothing overwrites it before the
`isLegacyMainIndexOnly = !binding && mainIndex != null` check fires. Once the graph has ANY real
edge-bound destination anywhere (`graphHasDestinationGpuBinding`, meant to make the graph the sole
source of truth — it already clears the operator-override maps for exactly this reason, lines
71-75), an unwired port with this stale `mainIndex: 0` default still slipped through as "screen 1",
carrying forward `screen_1`'s own leftover Caspar-side settings (`screen_1_mode: custom`,
`screen_1_custom_width: 2048`) purely because nothing else was using array slot 1 yet — first
unwired port to be iterated wins the collision guard at line 151. `os-layout-calculator-place.js`
places all `screens[*]` before `multiview[*]`/operator, summing widths left-to-right
(`cumulativeX`), so the phantom's 2048px width landed the real operator head immediately to its
right instead of at 0.

There was already a narrower patch for a sibling collision (WO-242 era): line 158 used to read
`if (isLegacyMainIndexOnly && graphHasDestinationGpuBinding && graphHasPixelMapToGpu) return` —
correctly recognizing the general shape of the problem, but only guarding the one case that had
actually been hit at the time (a pixel-map edge coexisting with a destination edge), not the
general "graph is authoritative, an edgeless connector's cached metadata isn't a binding" case the
owner just hit.

## What was done

**Fix 1** (the confirmed live bug) — `os-layout-calculator-assign.js`, broadened that guard to the
general case: `if (isLegacyMainIndexOnly && graphHasDestinationGpuBinding) return`. Once the graph
has a real destination-to-GPU edge anywhere, an edgeless connector's leftover `mainIndex` default
is never trusted as a screen binding — it's simply left unassigned, which is what "output =
nothing" actually means. Removed the now-unused `graphHasPixelMapToGpu` (only consumer was the old
narrower guard).

**Fix 2** (same class of bug, found while auditing "similar edge cases" per the owner's ask, not
yet manifesting on this box but structurally identical) — the `operatorScreenAssignments` merge
block a bit further down (legacy per-screen "Apply OS" `screen_N_os_x`/`os_y` fields, set by a
manual OS-layout override flow, independent of the device graph and never cleared by disconnecting
a destination in Device View). Its non-`force_os_resolution` branch did
`const base = allGpuAssignments.get(n) || assign` — if main `n` has no real graph-derived
assignment this run (nothing routed there), it fell back to `assign`, the stale override object
alone, fabricating the exact same kind of phantom screen entry from nothing but old x/y numbers.
Changed to `if (!allGpuAssignments.has(n)) continue` before merging — a leftover manual x/y only
ever adjusts a screen the graph pass actually placed, never conjures one. Left the
`force_os_resolution` branch as-is: that flag is a deliberate, currently-set "I want this specific
port's OS resolution forced regardless of routing" operator action, not incidental leftover
residue, and changing it wasn't backed by a reproduced failure the way both fixes above were.

## What was VERIFIED

- **Reproduced the exact live bug** with a script (`/tmp/.../scratchpad/repro-op-x.js`, not part of
  the repo) that loads the real `config/` directory via `ConfigManager` and calls
  `calculateLayoutPositions()` directly — before the fix: `screens: { "1": { x:0, width:2048,
  sysId:"DP-1" } }`, `multiview: { "1": { x:2048, sysId:"DP-1" } }` (both on the same physical
  output). After the fix: `screens: {}`, `multiview: { "1": { x:0, y:0, width:1920, height:1080,
  sysId:"DP-1" } }`.
- **Reproduced at the actual XML level** (`buildConfigXml(config)` against the real live config):
  the Operator GUI `<channel>`'s `<screen>` consumer now emits `<x>0</x><y>0</y>` where it
  previously would have carried the stale `2048`.
- `node tools/ci/run-offline-tests.js` — full suite, before and after: byte-identical failure set
  (the same 7 pre-existing, unrelated `smoke-wo283`/`smoke-wo308` operator-monitor-port tests that
  are hardware-detection-coupled and fail in this dev environment regardless — confirmed via diff
  of both runs' failure lists). No new failures, nothing newly passing masked a break.

**Not yet done: `kill -TERM $(systemctl show -p MainPID --value highascg)` to regenerate the live
`casparcg.config` and actually move the operator window.** This is a live playout box; restarting
the service is a deliberate owner action per this repo's standing convention, not something to do
unprompted mid-investigation. The fix is proven correct against the real config offline — the
restart is the only remaining step to see it on screen.
