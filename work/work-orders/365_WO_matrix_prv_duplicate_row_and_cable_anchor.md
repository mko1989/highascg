# WO-365 — Matrix view lists the PGM/PRV destination a third time; standard-view cables all anchor on the PGM dot (todos28.07.26 §3)

**Status: OPEN — investigated 28.07.26, both defects reproduced from live device-view data + source; NOT fixed (investigation only, per owner instruction).**

Regression follow-up to [WO-364](./364_WO_prv_physical_output_gpu.md) (PRV bus as a first-class
routable output, commit `71aa5a1`, 28.07 11:46).

Owner report, appended to `todos28.07.26` **after** WO-364 landed (the file's third line is an
uncommitted addition — `git diff -- work/work-orders/todos28.07.26`):

> in matrix view the prv is listed twice now. and in standard view the cable comes out of pgm
> node dot instead of the prv one.

Both halves are real and both are introduced by WO-364's client changes.

## 1. Investigation

### 1a. Matrix view — the destination gets a third row

`client/components/device-view-matrix.js` `extractMatrixPorts()`:

- WO-364 changed the dedupe key so a `pgm_prv` destination can contribute two rows sharing one
  graph id — [device-view-matrix.js:27-36](../../client/components/device-view-matrix.js#L27-L36):
  ```js
  const dedupeKey = half ? `${id}#${half}` : id
  if (!id || addedIds.has(dedupeKey)) return
  addedIds.add(dedupeKey)
  ```
- Section 1 then adds the pair as two halves — [device-view-matrix.js:45-48](../../client/components/device-view-matrix.js#L45-L48):
  ```js
  addPort(`dst_in_${d.id}`, `${d.label || d.id} — PGM`, true, group, 'pgm')
  addPort(`dst_in_${d.id}`, `${d.label || d.id} — PRV`, true, group, 'prv')
  ```
  so `addedIds` now holds `dst_in_<id>#pgm` and `dst_in_<id>#prv` — and **no longer holds the
  bare `dst_in_<id>`**.
- Section 4 (the "any remaining graph edges" fallback) still tests the bare id —
  [device-view-matrix.js:94-98](../../client/components/device-view-matrix.js#L94-L98):
  ```js
  if (e.sourceId && !addedIds.has(e.sourceId)) {
      const c = connectorById(payload, e.sourceId)
      addPort(e.sourceId, c?.label || e.sourceId, true, 'Other Sources')
  }
  ```
  The membership test misses, so **every cabled `pgm_prv` destination also gets a bare third
  row under "Other Sources"**, labelled with the destination connector's own label.

Reproduced against the live server (`GET /api/device-view` on :4200, 28.07):

```
EDGE dst_in_dst_mrzemj1s_1 -> gpu_p0   note= None
EDGE dst_in_dst_mrzeocxh_1 -> gpu_p3   note= None
EDGE dst_in_dst_mrzeocxh_1 -> gpu_p1   note= {"outputLayer":2}
CONN dst_in_dst_mrzeocxh_1 | label= 'PGM/PRV 1' | kind= destination_in
```

So the matrix currently renders, for one destination:

| row | group | source |
|-----|-------|--------|
| `PGM/PRV 1 — PGM` | Destinations | section 1 |
| `PGM/PRV 1 — PRV` | Destinations | section 1 |
| `PGM/PRV 1`       | **Other Sources** | section 4 fallback ← spurious |

That third row is what reads as "the prv is listed twice". It is also *functional*, not just
cosmetic: it is a source row with no `half`, so cabling from it writes an edge with **no
`outputLayer` note** — i.e. it silently behaves as a second PGM row.

Note the same fallback also fires for the Operator GUI destination (`dst_in_dst_mrzemj1s_1`)
if it is `pgm_prv`; check its mode when fixing.

### 1b. Standard view — cables anchor on whichever dot is first in the DOM

`client/components/device-view-destinations-ui.js` gives **both** pair halves and **both** pair
dots the *same* `data-connector-id` — [device-view-destinations-ui.js:223-228](../../client/components/device-view-destinations-ui.js#L223-L228):

```js
for (const half of pair.querySelectorAll('.device-view__destination-pair-half')) {
    if (sinkConnectorId) half.dataset.connectorId = sinkConnectorId
}
b.appendChild(pair)
for (const nd of pair.querySelectorAll('[data-pair-node$="-out"]')) {
    if (sinkConnectorId) nd.dataset.connectorId = sinkConnectorId
```

The half identity lives only in `data-pair-node` (`pgm-out` / `prv-out`) and is used solely by
the click/drop handlers to note `outputLayer` on the new edge.

The cable renderer never sees it — `client/components/device-view-cables.js`
`connectorCenter()` resolves an anchor purely by connector id —
[device-view-cables.js:76-96](../../client/components/device-view-cables.js#L76-L96):

```js
const matches = [
    ...surfaceEl.querySelectorAll(`[data-connector-id="${connId}"]`),
    ...surfaceEl.querySelectorAll(`[data-real-ids*="${connId}"]`)
]
...
const dot = matches.find((el) =>
    el.classList?.contains('device-view__connector-dot') ||
    el.classList?.contains('device-view__destination-port') || ...
```

`querySelectorAll` returns document order, and the PGM half is written first in the `innerHTML`
template at [device-view-destinations-ui.js:218](../../client/components/device-view-destinations-ui.js#L218).
So `.find()` always picks the **PGM** dot, and every cable leaving that destination — PGM edge
and PRV edge alike — is drawn from the PGM dot. Exactly the report.

There is no per-edge half plumbing in the render path at all: `connectorCenter` takes
`(surfaceEl, connId)` and nothing else, and the edge's `note` is not consulted when computing
positions (`buildConnectorPositionMap` keys the map by connector id only —
[device-view-cables.js:107-120](../../client/components/device-view-cables.js#L107-L120)).

WO-364 did teach the *gesture* path about halves (`device-view-cable.js:358` special-cases
`cableHalf === 'prv'` for `dst_in_` sources), which is why cabling produces a correct
`outputLayer: 2` edge — the defect is confined to **rendering** the resulting cable.

## 2. What needs doing (plan — NOT executed)

1. **Matrix fallback dedupe.** In `extractMatrixPorts`, make section 4's membership test aware
   of split ids: track a separate set of bare ids that were consumed by any half (or test
   `addedIds.has(id) || addedIds.has(`${id}#pgm`) || addedIds.has(`${id}#prv`)`). Prefer a
   `consumedIds` set added inside `addPort` — one line, no behaviour change for unsplit ports.
2. **Cable anchor by half.** Give the two dots distinguishable anchor identity and let the
   renderer choose:
   - Preferred: keep `data-connector-id` on the halves for hit-testing but add
     `data-connector-anchor="dst_in_<id>#prv"` on the PRV dot, and have `connectorCenter` accept
     an optional `half` and try the `#half` anchor selector first, falling back to today's path.
   - `buildConnectorPositionMap` must then key on `id#half` for destination edges, reading the
     half from the edge note (`outputLayer >= 2 → prv`) — the same reader WO-364 already added
     at [device-view-matrix.js:9-18](../../client/components/device-view-matrix.js#L9-L18);
     lift it into a shared lib rather than a third copy.
3. **Ghost/regrab path.** Check `device-view-cable-regrab.js` and the armed-cable ghost use the
   same anchor, otherwise grabbing a PRV cable will visually jump to the PGM dot.

## 3. Acceptance criteria

- With the box's current graph (one `pgm_prv` destination cabled to `gpu_p3` PGM and `gpu_p1`
  PRV), matrix view shows **exactly two** rows for that destination (`— PGM`, `— PRV`) and no
  bare row in "Other Sources".
- In standard device view, the PGM cable leaves the PGM dot and the PRV cable leaves the PRV
  dot; dragging/regrabbing either keeps its own anchor.
- Cabling from any remaining matrix row still writes the correct `outputLayer` note (a row that
  cannot express a half must not exist).
- New smoke test alongside `smoke-wo364-prv-output-routing.test.js` covering `extractMatrixPorts`
  row counts for a cabled `pgm_prv` destination (the fallback path is pure and testable).
- Offline suite stays green; `npm run build:client` + kiosk reload to deploy (client-only).

## 4. What was VERIFIED (investigation only)

- Both defects traced to specific lines, quoted above, in the tree at `637965c`.
- The duplicate-row path was confirmed reachable with the **live** `/api/device-view` payload:
  the destination connector `dst_in_dst_mrzeocxh_1` exists, has two outgoing edges, and is not
  present in `addedIds` under its bare id after the WO-364 split.
- No fix applied; no client rebuild; nothing deployed. Owner asked for investigation only.
