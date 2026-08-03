# WO-410 — Operator GUI holes empty after a caspar restart (stale skip-unchanged route cache)

**Status: DONE (2026-08-03 — fix live-verified: reconnect re-PLAYed 3-10/3-11, producers back on all compose layers; suite 1782/0/2)**
**Priority:** High (owner 03.08: "the operator gui has no preview from the operator channel")
**Source:** live regression during the WO-406 apply/restart cycle; latent since WO-243/338
**Related:** WO-243 (operator GUI channel), WO-338 (apply debounce), WO-406 (the applies that exposed it)

## 1. Investigation

Log timeline (03.08): the config-apply flow re-played the compose routes at 11:06:33–35 —
**into the dying caspar instance** (the restart finished at 11:06:48). The genuine reconnect
re-apply (`ensureOperatorGuiChannel` via routing-setup) then sent MIXER FILLs for layers
10/11/12 but **zero PLAYs**: `lastAppliedRouteByChannel` (module memory,
`operator-gui-channel.js:46`) still recorded those routes as applied, so the skip-unchanged
optimization skipped every PLAY. Raw OSC confirmed: ch 3 had a producer only on L12
(re-played later by another path); L10/L11 were fill-positioned and empty → GUI holes black.

The cache design assumed the inverse restart (node bounces, caspar keeps its stage — the
documented WO-243 scenario). A caspar restart while node stays up left the cache describing
a dead instance. Multiview checked for the same pattern: safe (`lastAppliedDebug` is
debug-only; it re-applies unconditionally).

## 2. What was done

`ensureOperatorGuiChannel` now deletes the channel's `lastAppliedRouteByChannel` and
`lastMaxLayerByChannel` entries before re-applying — on (re)connect the cache is never
trusted. Re-PLAYing an already-live route is harmless; skipping a needed one blanks the GUI.
Test appended to `smoke-operator-gui-reconnect-reassert.test.js` (16/16).

## 3. What was VERIFIED to work

Node service restarted with the fix: reconnect fired `PLAY 3-10 route://2` / `PLAY 3-11
route://1` (log 11:15:33) and raw OSC now shows ch 3 producers on layers 10, 11, 12 (+
chrome 100/980). Owner eyeball on the glass owed. Note: the tile that pointed at the NDI
host channel (`route://5`) now routes the monitor channel — expected after WO-406's
channel-5 reassignment; remove/re-source that tile.
