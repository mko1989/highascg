# WO-436 — Mapping-node inspector values revert on first entry (need several tries to stick)

**Status: DONE (2026-08-06 — suite 1844/0/2 incl. new WO-436 smoke, built + kiosk F5; owner QA on feel)**

Owner (todos06.08.26 item 1): "when inputing values into width height src x and others in a
pixel mapping node, they dont 'take' the first time and revert back to defaults, need to try
a couple times before they stick."

## Investigation

Deterministic, two stacked caches — both violations of the standing rule already smoke-pinned
for `device-view-events.js` ("a change-driven reload must never be answered from cache",
`smoke-device-view-reload-forces-refresh.test.js`), which was never applied to the mapping
inspector:

1. **The visible revert (every first try).** Every post-save handler in
   `client/components/device-view-inspector-mapping.js` (Src X/Y/W/H `saveRect`, custom
   W/H/FPS `saveCustom`, mode select, label, rename, propose, add/remove output,
   duplicate/delete node — 9 call sites) reloaded with **bare `load()`**. `ctx.load`
   (device-view-render.js:224-248) serves that from the 5-second payload cache
   (`shouldUseCache`), so the inspector re-rendered the PRE-EDIT snapshot and the input was
   rebuilt showing the old value. The fast-path `highascg-device-view-update-payload`
   dispatch some handlers fire updates only `state.lastPayload`, NOT the module-level
   `lastPayload` cache in the render closure — so the bare `load()` right after it clobbered
   the fast-path render with the stale cache. The value HAD saved server-side; it only
   looked reverted.

2. **The real server-side revert (fast retries).** `fetchDeviceView()` in
   `client/lib/mapping-node-service.js` is the read half of a read-modify-write: every
   mutation fetches the whole graph, mutates it, and POSTs the WHOLE graph back
   (`saveDeviceGraph`). The route sends `Cache-Control: private, max-age=3`
   (src/api/routes-device-view.js:125-131), so a retype within 3 s of the previous fetch is
   answered by the **browser HTTP cache** with the pre-first-save graph — mutating and
   saving that reverts the first edit for real. This is why it took "a couple times":
   only a retry slower than both windows (3 s + 5 s) stuck.

## What was done

- `mapping-node-service.js` `fetchDeviceView()`: cache-busted with `?_ts=${Date.now()}` —
  the same bust `Actions.loadDeviceView` uses for `bustCache` (WO-82 era). A read that
  feeds a whole-graph save must never be served stale.
- `device-view-inspector-mapping.js`: all 9 bare `load()` → `load({ forceRefresh: true })`.
- New smoke `tools/smoke/smoke-wo436-mapping-inspector-cache-revert.test.js` (registered in
  the curated FILES list): comment-stripped source asserts (a) zero bare `load()` in the
  inspector + the forced form present, (b) `fetchDeviceView` carries the `_ts` bust.

## Verified

- New smoke 2/2; full offline suite **1846 tests, 1844 pass, 0 fail, 2 skipped**.
- `npm run build:client` clean, kiosk reloaded (`DISPLAY=:0 xdotool key F5`).
- Owner QA: type a Width/Src X value once in a mapping-node output — it should stick on the
  first entry, including rapid consecutive edits across fields.

## Not touched (deliberate)

- The `max-age=3` on the route stays — it legitimately serves the read-only polling paths;
  the standing pattern is bust-at-the-caller for change-driven reads (same as WO-82).
- Other `api.get('/api/device-view')` consumers outside mapping-node-service were not
  audited here; if another inspector grows a read-modify-write it must use
  `MappingNode.fetchDeviceView`-style busting. Candidate follow-up if a similar revert is
  ever reported elsewhere.
