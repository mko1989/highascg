# WO-478/479/480 — device view: stale after Add, cables ignore the inspector, DeckLink inspector

**Status: DONE (11.08.2026, verified: offline suite 1957/1955 pass/0 fail/2 skip, WO-313 guard
repointed and strengthened, dist-web rebuilt) — owner QA: all four in the GUI**

Four defects from the owner's 11.08 list, all in device view, filed together because they share the
render path. Sub-numbers are the ones cited in the code comments.

## WO-480 — the view does not always refresh after adding an output

*"the devices view doesnt refresh always when adding an output"*

Every Add handler in `device-view-bands-render.js` already ended with `await load()`, which is why
it worked *sometimes*. `ctx.load()` (`device-view-render.js:220`) serves a **5-second cache**:

```js
const isCached = lastPayload && (now - lastPayloadAt) < 5000
const shouldUseCache = !forceRefresh && isCached && lastPayload
…
if (shouldUseCache) { /* render from cache and skip the fetch entirely */ }
```

Right after a save, that cache is always warm — you were interacting with the view seconds earlier —
so `load()` re-rendered the **pre-save payload** and never fetched. Wait more than five seconds
between adds and it worked, which is exactly the "not always" the owner saw.

Fixed by making all 11 post-mutation reloads in that file `load({ forceRefresh: true })` — the same
form the Caspar-config modal already used. Add, remove, mapping-node and virtual-cam paths included.

## WO-478 — cables stay put when the inspector is resized

*"when i resize the inspector the cable connections stay in the same place instead of moving with
their end points"*

`device-view-events.js` redrew the overlay from `window.onresize` and nothing else. Dragging the
inspector splitter resizes the *surface*, not the window: no event, no redraw, so the ropes stayed
where they were last drawn while their ports moved out from under them. There was no `ResizeObserver`
anywhere in the device-view client.

Fixed with a `ResizeObserver` on the surface (`refs.wrap`) and the external inspector host
(`#panel-inspector-scroll` / `#panel-inspector-body`), sharing the **same** `rafThrottle`d redraw as
`window.onresize`. Sharing matters: the Verlet rope cache is keyed on exact pixel coordinates, so an
unthrottled observer would re-run the full simulation per resize event — the WO-313 regression.

WO-313's guard pinned the literal `window.onresize = rafThrottle(`, which the named-function form
no longer matches. Repointed to assert the wrapper exists, that `window.onresize` **is** it, and —
new — that the observer shares it, so the throttle cannot be bypassed by the new path.

## WO-479 — DeckLink output inspector

*"the inspector for the decklink ouputs is baddly formated, make the options appear in one column
with the dropdowns under the option"* and *"i connected a mapping node output to 2 decklinks
connectors and in their inspector it still says unassigned sdi port"*

**Layout.** `renderDecklinkConsumerSettingsControls` laid its fields out
`grid-template-columns: 1fr 1fr`. The captions were already above their controls, but at half the
inspector width a caption wrapped and a select clipped its own value (`3072x1536p50`). Now one
column, fields `display:block; width:100%`, and `.device-view__destinations-type` gained
`width:100%; box-sizing:border-box` so a dropdown fills its field instead of sizing to its longest
option.

**"Unassigned SDI port".** The note keyed on `normalizeDecklinkIoDirection(conn.caspar)`. Nothing
sets `ioDirection` when a cable is drawn — `device-graph-suggest.js` derives it from the **applied**
config (`screen_N_decklink_device`, `decklink_input_N_direction`). So a port with a mapping-node
output patched into it kept reading *"Unassigned SDI port. Cable a screen destination here…"* with
the cable visible on screen. New shared `connectorCableCount(lastPayload, connectorId)` counts edges
in `payload.graph.edges` touching the connector (either end — a cable can be drawn from either
side); when a port is unassigned **but cabled**, the note now reads *"Cabled (N connections) —
becomes a program output on Apply."* Both copies of the note were fixed: the live one in
`device-view-inspector-decklink.js` and `renderDecklinkOutputSection` in the -output module.

The added lines pushed `device-view-inspector-decklink-output.js` to 504 lines, over the CI limit,
so the rear-panel order editor moved to `device-view-inspector-decklink-rear-order.js` (its imports
travelled with it; the three that no longer had a user were dropped).

## What was verified

- Offline suite **1957 tests, 1955 pass, 0 fail, 2 skip**; eslint 0 errors (218 warnings, at the
  configured cap, none from the touched files); 0 files over 500 lines; `npm run build:client` OK.
- WO-480's cause read straight out of `device-view-render.js:226` — the cache window and the
  `shouldUseCache` early return are explicit, and every changed call site is a post-mutation reload.

**Not verified live:** the server is not running here, so none of the four was watched in a browser.
Owner QA: add an output (band appears immediately), drag the inspector splitter (cables follow),
open a DeckLink output (one column, dropdowns full width), and open a cabled-but-unapplied SDI port
(reads "Cabled …", not "Unassigned").
