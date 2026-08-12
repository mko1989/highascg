# WO-491 — Deleting a destination leaves its DeckLink bound, and the next destination inherits it

**Status: DONE (12.08, reproduced end-to-end then fixed; 4 new smokes, suite 1986/1984/0, eslint 0 errors) — owner QA owed on the live delete**

Split out of [WO-490](./490_WO_REMOVED_DESTINATION_STAYS_UNTIL_NEXT_ADD.md) §1.4, which found this
while diagnosing "removing a screen destination doesn't make it go away". WO-490 fixed the *UI*
staleness; this is the *config* half, and it has a worse failure mode than a stale list row.

## 1. Investigation

### 1.1 Cabling writes POSITIONAL state in two places

`applyDecklinkOutputOnDestinationEdge` (`src/api/device-view-decklink-wiring.js`) records a
DeckLink→destination cable twice:

```js
const outputBinding =
    mode === 'multiview' ? { type: 'multiview' } : { type: 'screen', index: Math.max(1, mainIdx + 1) }
…
connectors: …{ ...c, caspar: { ...c.caspar, ioDirection: 'out', outputBinding, bus, mainIndex: mainIdx } }
…
cs[`screen_${screen}_decklink_device`] = devNum
```

Both are keyed by **screen position**, not by destination id.

### 1.2 Deleting the destination prunes only the edge

`handleRemoveDestination` (`src/api/device-view-crud.js`) called `pruneDestinationFromGraph`, which
(`src/config/device-graph-edges.js:123-134`) drops the destination's own connectors and any edge
touching them — and nothing else. The DeckLink connector keeps `outputBinding`, and
`casparServer.screen_N_decklink_device` is never touched.

### 1.3 …and `mainScreenIndex` is compacted, so a survivor inherits it

`normalizeScreenDestinations` → `compactMainScreenIndices` re-ranks the survivors densely. Delete the
destination at index 0 and the one at index 1 slides into index 0 — i.e. onto `screen_1` — where a
dead `screen_1_decklink_device` is waiting for it. **The survivor gets an SDI output it was never
cabled to.**

### 1.4 Why clearing the flat key alone would NOT have worked

The generator's DeckLink projection has a legacy fallback for a port with no incoming edge
(`src/config/build-caspar-generator-config-decklink.js`):

```js
const incomingEdge = edges.find((e) => e.sinkId === c.id)
if (!incomingEdge) {
    const binding = c.caspar?.outputBinding
    if (binding?.type === 'screen') assignDecklinkToScreen(n, devNum, c)   // ← re-asserts it
```

Pruning the edge is exactly what puts the port into that branch, so the stale `outputBinding`
**re-writes** `screen_1_decklink_device` on the very next generate. Both pieces had to go.

### 1.5 Why WO-275 did not already cover it

WO-275 fixed the *rebinding* case with `releaseDecklinkDeviceFromOtherTargets(devNum, keep)`, which
only fires when some **other** target claims the same device. Nothing claims a deleted destination's
DeckLink, so that path never ran. Note WO-275 also deliberately established that a binding on a
device the graph does not mention must be **left alone** (`smoke-wo274-config-generator-stale.test.js`,
"an untouched DeckLink binding on another device is left alone") — so a blanket "clear everything the
graph does not assert" sweep in the generator was *not* an acceptable fix, and is not what was done.

### 1.6 Reproduction (written before the fix, failed as predicted)

`tools/smoke/smoke-wo491-remove-destination-releases-decklink.test.js` — two PGM/PRV destinations,
DeckLink 3 cabled to the first, then `handleRemoveDestination('dst_a')`. Against the pre-fix code:

```
screen_1 must not keep pointing at DeckLink 3 …   actual: 3, expected: 0
the DeckLink connector loses its stale …          actual: { type: 'screen', index: 1 }, expected: null
no <decklink> consumer may be emitted on it …     actual: 1, expected: 0
```

The third is the one that matters: the regenerated Caspar XML really did emit a
`<decklink><device>3</device></decklink>` consumer under the **survivor's** channel.

## 2. What was done

New `releaseDecklinkOutputsForDestination(ctx, graph, destinationId)` in
`src/api/device-view-decklink-wiring.js` (the module that already owns this concern), called from
`handleRemoveDestination` **before** pruning, since it reads the edges pruning is about to drop:

- finds every `decklink_out` / `decklink_io` connector cabled to the destination being removed;
- clears each one's `caspar.outputBinding` / `bus` / `mainIndex`, keeping the connector and its
  `ioDirection: 'out'` — the physical port survives, only the destination binding goes;
- clears `screen_N_decklink_device` / `_key_device` / `_replace_screen` (and the multiview pair)
  **only where they still name that same device**, so a target another destination legitimately owns
  is never stomped;
- skips tiled LED-wall screens (`screen_N_decklink_tiles`), which own their device through that key
  — the same carve-out `releaseDecklinkDeviceFromOtherTargets` makes.

`handleRemoveDestination` now persists `casparServer` when the release changed it, and reports
`casparRestartNeeded` so the operator's Apply button goes orange (the generated XML has changed).

Deliberately NOT done: a generator-side sweep clearing every target the graph does not assert. That
would regress WO-275's "untouched binding on another device is left alone" contract (§1.5).

## 3. What was VERIFIED

- 4 new smokes in `tools/smoke/smoke-wo491-remove-destination-releases-decklink.test.js`, all
  **failing before / passing after**:
  1. the flat `screen_1_decklink_device` is released;
  2. the connector loses its stale positional `outputBinding`;
  3. after compaction the survivor emits **no** `<decklink>` consumer on device 3;
  4. **control** — deleting an *unrelated* destination leaves DeckLink 3 bound to its real owner,
     binding intact and exactly one consumer emitted.
- Registered in the curated CI list (`tools/ci/run-offline-tests.js`) as this repo requires.
- Full offline gate → **1986 tests, 1984 pass / 0 fail / 2 skip** (was 1982/1980/0/2 — the four new
  tests, nothing regressed). The WO-274/275 stale-config suite still passes.
- `npx eslint` on both changed sources + the new test → 0 errors (1 pre-existing unused-import
  warning in `device-view-crud.js:6`, untouched). `check-max-file-lines` → 0 files over 500.

**NOT verified live:** deleting a real destination on this box rewrites the Caspar config and implies
a restart, so the end-to-end delete was not exercised on the running system. The live config is
currently benign anyway — every `screen_N_decklink_device` is `0` and only `multiview_decklink_device`
is set (`1`), so there is no dead binding to trip over today. **Owner QA:** cable a DeckLink to a
destination, delete that destination, then confirm the regenerated config has no `<decklink>` consumer
on that device and the surviving destination did not inherit it.
