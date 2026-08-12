# WO-496 — Apply Caspar config must emit what is actually cabled

**Status: DONE (12.08 — 9 new smokes, suite 2019/2017/0, eslint 0 errors) — NOT deployed: needs a `highascg` restart**

Owner 12.08 (`todos12.08.26`), answering WO-494 §4: *"yes, cabling can change dynamically, but when
hitting apply caspar config it needs to read what is actually connected."*

## 1. Investigation

WO-491/494 fixed two *deletion* paths. The owner's answer rules out chasing the rest
(`handleRemoveEdge`, `handleRemoveAllEdges`, `removeMappingOutput`) that way and states the invariant
instead: **Apply describes the graph.**

The generator's fallback for a port with no cable honoured the stored binding unconditionally
(`build-caspar-generator-config-decklink.js`):

```js
const incomingEdge = edges.find((e) => e.sinkId === c.id)
if (!incomingEdge) {
    const binding = c.caspar?.outputBinding
    if (binding?.type === 'screen') assignDecklinkToScreen(n, devNum, c)
```

A blanket "no cable ⇒ no consumer" rule is WRONG, and this is the load-bearing finding: **dropping a
DeckLink onto a destination's output dot binds it with NO edge at all**
(`device-view-cable-outputs.js` `setDecklinkAsDestinationOutput` → `updateConnector` only; the drop
handler in `device-view-destinations-ui.js` adds no edge). That is a live UI flow, so a blanket rule
would silently kill those outputs.

Worse, `handleUpdateConnector` **synthesizes** a binding when an SDI port is saved as an output with
none supplied — defaulting to `screen_{mainIndex+1}`, i.e. `screen_1`. So merely saving SDI settings
on an uncabled port (picking a pixel format, WO-493) invents a `screen_1` binding out of nothing.

So the question is not "is there a cable" but **"where did this binding come from"**.

## 2. What was done — provenance, not per-unplug release

`connector.caspar.bindingSource` is now recorded when a binding is created:

| value | set by | Apply rule |
|---|---|---|
| `cable` | `applyDecklinkOutputOnDestinationEdge` (a cable was drawn) | emits **only while that cable exists** |
| `auto` | `handleUpdateConnector` synthesizing one from bus/mainIndex | same — it was never a real connection |
| `manual` | operator supplied the binding (drop on a destination's output dot) | always honoured; has no cable by design |
| *absent* | pre-WO-496 config | always honoured — unknown must never blank a live SDI |

In the generator, a `cable`/`auto` binding with no incoming edge is skipped **and** its device is
released from every target via `releaseDecklinkDeviceFromOtherTargets(devNum, null)`. That second
half is essential and is the same lesson as WO-491/494: `merged` is seeded from the persisted
`casparServer`, so skipping the connector alone leaves `screen_N_decklink_device` in place and
`config-generator-consumer-attach-screen` emits from it regardless.

Provenance is preserved on re-save (`priorSource === 'cable'` wins), so changing a setting on a
cabled port does not downgrade its origin. `releaseDecklinkSinksOfSources` also clears
`bindingSource` alongside the binding.

**Nothing is released on unplug.** Pull a cable and Apply: no consumer. Plug it back and Apply: it
returns. Cabling stays dynamic; only the *generated config* tracks reality.

Split for the 500-line limit: the mapping-node handlers moved to `src/api/device-view-crud-mapping.js`,
and the shared `saveConfig` to `src/api/device-view-crud-save.js` so neither CRUD module requires the
other. `smoke-wo494`'s require was repointed (never weakened).

## 3. What was VERIFIED

`tools/smoke/smoke-wo496-apply-reads-actual-cabling.test.js` — **9 tests, all passing**, registered in
the curated CI list: cable binding emits when cabled and stops when pulled; **pull + re-plug is
non-destructive** (the consumer returns); `auto` behaves like `cable`; **`manual` keeps working with
no cable**; **absent provenance is still honoured**; provenance is stamped by the cabling path;
`handleUpdateConnector` records `manual` vs `auto` correctly; and re-saving settings on a cabled port
does not downgrade `cable`.

Full offline gate → **2019 tests, 2017 pass / 0 fail / 2 skip**. eslint 0 errors;
`check-max-file-lines` 0 over 500.

A first draft of two tests failed because they used `updateConnector: { id, caspar }` — the real
payload is `{ id, patch }` (`client/components/device-view-actions.js:217`). The test was wrong, not
the code; fixed and noted inline.

**NOT verified live** — `src/**` changes need a service restart, and `highascg.service` is currently
stopped. **Owner QA:** pull a DeckLink cable, Apply, confirm that consumer is gone; re-plug, Apply,
confirm it returns; and confirm a drop-bound (cable-less) DeckLink still emits.
