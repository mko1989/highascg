# WO-239 — OSC variables parser still broken AFTER the WO-235 fixes went live

**Status:** Planned | **Priority:** HIGH | **Date:** 2026-07-15
**Source:** owner: "still something is broken in the osc variables parser" — VERIFIED REAL: service restarted 12:57 (after the 12:36 WO-235 deploy), so the type-leaf fix is active and something else remains.

## Tasks (investigation-first, live)
- [ ] T239.1 Reproduce concretely: read src/osc/osc-variables.js end-to-end (what variables it derives: ${'$'}(highascg:...time/remaining/...) from f.elapsed/f.duration/layer.type); with media playing, dump the CURRENT variable store live (find the API/WS that exposes variables — grep variable-state/getVariableStore server side) and list which variables are wrong/missing/NaN vs expected.
- [ ] T239.2 Cross-check remaining 2.6-dev OSC diffs the WO-235 pass may have missed for the VARIABLES path specifically: paused flag (layer.paused vs foreground/paused), loop, frame leaves, per-channel profiler/format leaves — grep every state_[" emission in /home/casparcg/caspar-build/src-tree that osc-variables consumes and diff address+arg shape against osc-state.js/osc-variables.js expectations (WO-235's report says paused moved? verify).
- [ ] T239.3 Fix rollback-safe (both formats); extend smoke-wo235-osc-compat.test.js with variable-derivation cases (synthetic packets old+new → expected variable values).
- [ ] T239.4 Gate; needs another highascg restart — say so in the final report. A239.1 owner: variables correct in UI/companion.
