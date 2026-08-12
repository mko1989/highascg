# WO-494 — Deleting a pixel-mapping node leaves its DeckLinks in the Caspar config

**Status: DONE (12.08 — reproduced end-to-end then fixed; 7 new smokes, suite 2010/2008/0, eslint 0 errors; client built + kiosk reloaded) — owner QA owed on the live delete**

Owner 12.08: *"i had a pixelmapping node connected to screen dest 1 and decklink 1 and 2, when i
removed the pixelmapping node, the decklink out 2 still was present in the caspar config"*

Third in the lineage **WO-275 → [WO-491](./491_WO_REMOVE_DESTINATION_LEAVES_DECKLINK_BOUND.md) → this**.
Not covered by WO-491: that fix hooked `handleRemoveDestination`, and this path had no handler to
hook.

## 1. Investigation

### 1.1 There was no server handler at all

Deleting a mapping node was a pure client-side graph rewrite POSTed as a whole graph —
`client/lib/mapping-node-service.js` `deleteMappingNode()` filtered the node, its connectors and
their edges, then `saveDeviceGraph(next)`. That lands in the generic branch of
`src/api/routes-device-view.js`:

```js
else if (j.deviceGraph && typeof j.deviceGraph === 'object') {
    const next = normalizeDeviceGraph(j.deviceGraph)
    …
    persistConfigPatch(ctx, { deviceGraph: next })
```

Persist and nothing else: no DeckLink release, no `casparServer` touch, no `casparRestartNeeded`.
**A whole-graph POST can never be made safe** — the server cannot tell a deletion from any other
edit, so it cannot know a DeckLink just lost its feed.

### 1.2 What survived, and why it was invisible until the node went

Marking an SDI port as an output (`handleUpdateConnector`) writes the same two pieces of positional
state as in WO-491: `connector.caspar.outputBinding = { type:'screen', index }` and
`casparServer.screen_N_decklink_device`.

The reason nobody noticed while the node existed is that **`screen_N_decklink_tiles` is generate-time
only**. `src/config/pixel-mapping-config.js:131-132` writes it into the `merged` blob and deletes the
flat device key on the same pass:

```js
merged[`screen_${n}_decklink_tiles`] = tiles
delete merged[`screen_${n}_decklink_device`]
```

and the DeckLink projection then refuses to touch a tiled screen
(`build-caspar-generator-config-decklink.js:101-103`). It is never persisted — only
`ctx.config.casparServer` is. So the stale key sat in the saved config, **masked** at every generate.
Delete the node and the mask disappears with it.

### 1.3 Why DeckLink 2 and not DeckLink 1

Both survive; they collide and 2 wins. A mapping node's outputs are subregions of **one** program
channel (`resolvePixelMapFeedToProgramScreen` returns a single `screenIndex`), so `dlsdi_1` and
`dlsdi_2` both carry `outputBinding {type:'screen', index:1}` and there is exactly one
`screen_1_decklink_device` slot. After the node is gone neither port has an incoming edge, so both
take the generator's legacy fallback: `assignDecklinkToScreen(1, 1, …)` then
`assignDecklinkToScreen(1, 2, …)`, and the second call's
`releaseDecklinkDeviceFromOtherTargets(2, keep=1)` skips `n === keep`, so device 2 simply overwrites
device 1. It is **last-connector-in-the-array wins**, not device-number: reversing the connector
order makes DeckLink 1 the survivor.

### 1.4 Reproduction (written first; the baseline case documents the mask)

`tools/smoke/smoke-wo494-remove-mapping-node-releases-decklink.test.js`. The baseline test passes
against the *unfixed* code and pins the masking behaviour:

```
--- WITH the node ---   screen_1_decklink_device = undefined, tiles = 2, consumers on devices [1,2]
--- AFTER removal ---   screen_1_decklink_device = 2,        tiles = undefined, consumer on device 2
```

which is the owner's report verbatim. As in WO-491 §1.4, clearing **one** half is not enough: with
only the flat key cleared, the legacy `!incomingEdge` fallback re-asserts it from the surviving
`outputBinding`; with only the bindings cleared, `device-graph-suggest.js:167-172` re-derives a
`decklink_io` connector *from* `screen_i_decklink_device` and `mergeHardwareSync` folds it back in.

## 2. What was done

- **`releaseDecklinkSinksOfSources(ctx, g, srcIds)`** — WO-491's release body factored out of
  `releaseDecklinkOutputsForDestination` so there is one copy: clears each fed DeckLink port's
  `caspar.outputBinding`/`bus`/`mainIndex` (keeping the port and its `ioDirection:'out'`), and clears
  `screen_N_*` / multiview keys only where they still name that same device, skipping tiled screens.
- **`releaseDecklinkOutputsForMappingNode(ctx, graph, nodeId)`** — collects the node's
  `pixel_map_out` connector ids and runs that shared body. Must run before the prune, since it reads
  the edges the prune drops.
- **`handleRemoveMappingNode(j, ctx)`** in `device-view-crud.js`, dispatched in
  `routes-device-view.js` **above** the generic `j.deviceGraph` branch. Rejects an unknown id,
  persists `casparServer` when the release changed it, and returns `casparRestartNeeded` so Apply
  goes orange (no auto-restart — WO-303).
- **Client**: `deleteMappingNode` now POSTs `{ removeMappingNode: { id } }` instead of a rewritten
  graph.

## 3. What was VERIFIED

7 smokes, all **failing before / passing after** (except the baseline, which passes both sides by
design — it is the mask, not the bug), registered in the curated CI list:

1. baseline — with the node wired: flat key masked, two tiles, consumers on devices 1 **and** 2;
2. removal releases the flat screen binding;
3. **both** DeckLink connectors lose `outputBinding` yet survive as ports, still `ioDirection:'out'`,
   and the node itself is gone;
4. **no `<decklink>` consumer on either card** after removal — the owner saw device 2 survive, and
   device 1 must not survive either;
5. control — a third DeckLink cabled straight to the destination keeps its binding and its one
   consumer (only 1 and 2 go);
6. an unknown node id returns an error rather than looking like a successful delete;
7. source contract — `deleteMappingNode` uses the dedicated endpoint and no longer calls
   `saveDeviceGraph`.

Full offline gate → **2010 tests, 2008 pass / 0 fail / 2 skip** (was 2003/2001). eslint 0 errors
(1 pre-existing unused-import warning in `device-view-crud.js:6`). `check-max-file-lines` → 0 over
500. Client built, bundle contains `removeMappingNode`, kiosk reloaded.

**NOT verified live** — deleting a real mapping node rewrites the Caspar config and implies a
restart. **Owner QA:** rebuild the node → 2 DeckLinks setup, delete the node, confirm no `<decklink>`
consumer remains on either card.

## 4. Same hole, not fixed here — owner call

Three sibling paths still POST a whole graph and release nothing:

- **`removeMappingOutput`** (`client/lib/mapping-node-service.js`) — deleting *one* output strands
  that output's DeckLink. Closest to this bug; the obvious next one.
- **`handleRemoveEdge`** (`device-view-crud.js`) — pulling just the cable. Deliberately left: an
  operator may pull and re-plug a cable, and releasing on every unplug is a behaviour change worth
  deciding explicitly rather than inheriting from this WO.
- **`handleRemoveAllEdges`** — "remove ALL cabling" releases nothing at all.

A generator-side blanket sweep remains off the table (WO-491 §1.5 / WO-275: an untouched binding on a
device the graph never mentions must be left alone).

## 5. Two adjacent traps found on the way

- `resolvePixelMapFeedToProgramScreen` (`pixel-mapping-config.js:22-30`) resolves the destination by
  **slicing the connector id** (`srcId.slice('dst_in_'.length)`) rather than reading
  `connector.externalRef` as the generator does. It works only because the UI mints ids as
  `dst_in_${destId}`; any divergence silently drops every tile. WO-491's own fixture uses
  `dst_in_a` with `externalRef: 'dst_a'`, which would fail this lookup — the fixture here uses
  `dst_in_dst_a` deliberately.
- `src/config/build-caspar-config-decklink.js` and `src/config/build-caspar-config-routing.js` have
  **no requires anywhere in `src/`** — dead twins of the `build-caspar-generator-*` pipeline carrying
  their own copies of `assignDecklinkToScreen` / `reconcileDecklinkScreenConsumerFlags`. Easy trap
  for the next reader; worth deleting under a hygiene WO.
