# WO-834 — Timeline end holds the last frame (D8)

**Status: OPEN (30.10)**
**Source:** WO-828 D8, owner 30.10: *"the timeline should end on last frame always (unless it was ofcourse set manualy to
something different), but when timeline end equal clip end then last frame."*
**Related:** WO-828, WO-829.

## 1. Investigation

`_tick` (src/engine/timeline-playback-runtime.js) calls `this.stop(airId)` when a non-looping timeline reaches
`tl.duration`. `stop()` runs `_stopAll`, so every layer goes to black at the end. A clip that ends exactly at the
timeline end is therefore never seen on its last frame.
