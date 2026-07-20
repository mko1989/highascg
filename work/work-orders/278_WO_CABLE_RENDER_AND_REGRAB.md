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
