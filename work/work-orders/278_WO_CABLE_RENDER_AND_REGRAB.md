# WO-278 — Cable render performance; re-grab a cable end and reconnect it

**Source:** todos19.07.26 — "the cable render needs performance work. the connections take a while
to apply, it should also be possible to grab a cable from a connection and connect it somewhere
else."

## Two separate problems

### A. Rendering / apply latency
Connections "take a while to apply" in the Devices-tab device graph. Establish which of these is
actually slow before optimising anything:
- the **render** itself (SVG/canvas redraw of all cables on every state change, layout thrash,
  re-creating DOM nodes instead of updating them),
- the **round trip** (the PATCH/POST that persists the connection, and whether the UI waits for a
  full state refetch before drawing),
- or **downstream work** the connection triggers (config regeneration, routing recompute).

Measure, then fix the one that dominates. A likely shape given this codebase: every graph mutation
re-renders every cable and re-reads layout (`getBoundingClientRect` per endpoint) synchronously.

### B. Re-grab an existing connection
Today a cable is presumably created endpoint-to-endpoint and can only be deleted and redrawn. The
operator wants to grab an existing cable **by one end** and drop that end on a different port —
the standard patch-bay interaction. Requirements:
- Grabbing an end detaches only that end; the other end stays anchored.
- Dropping on an invalid target restores the original connection (no silent disconnect).
- Dropping on empty space is a disconnect only if that is already the app's delete affordance —
  otherwise it restores. Do not invent a destructive gesture.
- The existing validation (what may connect to what) must run on the new target before commit.

## Constraints
- The device graph is the UI for real routing: a wrong commit re-cables live playout. Validate
  before persisting, and never persist an intermediate drag state.
- Note `client/components/device-view-selection.js` recently gained a `forceRefresh` on the
  post-mutation reload (WO-276) — a mutation must never be answered from the 5 s payload cache.
  Any new mutation path must do the same.
- Cable geometry may share the position-watch helper (`client/lib/element-position-watch.js`) and
  the shared hole/rect math (`client/lib/hole-rect.js`) rather than adding new observers.

## Acceptance
- A written before/after measurement of the dominant cost (numbers, not adjectives).
- Re-grab works with validation, restore-on-invalid, and no persisted intermediate state.
- No idle CPU cost added: no per-frame layout reads while nothing is being dragged.
- Offline smoke test for the pure parts (endpoint hit-testing, validation on re-target,
  restore-on-invalid decision logic). `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.

---

# Results (executed 2026-07-20)

## A — measured before optimising, and the guess in this WO was wrong

The WO speculated the cost was "re-render every cable + getBoundingClientRect per endpoint".
That shape is real but is **~4 orders of magnitude below the actual cost**, benchmarked against a
stub DOM at this box's real graph size (6 edges / 16 connectors, read from the live API):

| edges | render | rect reads | querySelectorAll |
|-------|--------|-----------|------------------|
| 6 | 0.048 ms | 25 | 24 |
| 24 | 0.186 ms | 97 | 96 |
| 96 | 0.560 ms | 385 | 384 |

Optimising the renderer would have been the wrong layer. It was left alone.

**The server round trip dominates.** Device-view requests needing a live-hardware snapshot are
gated by the xrandr cache (`XRANDR_CACHE_TTL_MS = 3000`, `src/utils/hardware-info.js`). 10 trials
against the live box:

| | median | min | max |
|---|--------|-----|-----|
| cold (>=3 s idle — i.e. a real operator click) | **274 ms** | 40 ms | **1770 ms** |
| pre-warmed (warm at arm, 600 ms reaction gap) | **43 ms** | 39 ms | 54 ms |

Applying one cable fires several snapshot-building requests back to back, so only the first pays
the cold price — and that first one is exactly the operator's click. Downstream config
regeneration was not a factor.

**Fix:** `client/lib/device-view-snapshot-prewarm.js` warms the snapshot when a cable is armed and
re-warms every 2500 ms (under the TTL) until commit/cancel. Zero idle cost by construction — the
interval exists only between `start()` and `stop()`; no observers, no polling.

Estimated destination→GPU apply: **~375 ms → ~144 ms** typical, **~1.87 s → ~0.15 s** worst case.

**Latent bug found while measuring (WO-276 class):** `tryAddCable`, `removeEdge` and
`resetCabling` ended in a bare `ctx.load()`. On a cache hit that reassigns `state.lastPayload` to
the object captured *before* the write, discarding the graph the POST just returned — the new
cable would vanish until a later fetch. All three now use `ctx.load({ forceRefresh: true })`.

## B — re-grab rules as implemented

Gesture: **select a cable → click either end to lift it → click a new port to commit.**

- Re-grab only starts if the cable is *already selected*. Deliberately strict: clicking a cabled
  output still means "start another cable from here", because an output legitimately fans out to
  several sinks and hijacking that click would re-cable live output on a gesture nobody asked for.
- **Nothing intermediate is persisted.** The original edge stays in the server graph for the whole
  gesture and is merely hidden from the overlay, so "restore" is a client-side redraw, no round trip.
- Validation (`orderEdgeForDeviceView` + `findGpuSinkCableConflict`) runs against the new target
  before commit, with UI ids canonicalised first.
- **Restores, never silently disconnects**, on: empty space, same port, its own far end, role or
  direction rejection, occupied sink, and any target that would reverse the cable.
- No destructive gesture was invented — delete remains select+Delete / the inspector button, and
  empty-space click already meant cancel. Escape also restores.
- Commit is remove-then-add (moving a *source* end reuses the same sink, which one-cable-per-sink
  would otherwise reject); if the add fails after the remove, the original edge is re-added.

## Known gap
The DOM wiring was never exercised in a real browser (no client build inside the agent run), so the
12 offline tests cover the pure logic only. **Worth a click-through after a client build.**
