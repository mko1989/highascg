# WO-365 — Matrix view lists the PGM/PRV destination a third time; standard-view cables all anchor on the PGM dot (todos28.07.26 §3)

**Status: DONE (28.07.26 — both defects fixed; ghost row proven gone against the live payload, anchor resolution unit-proven; owner eyeball on the cable dots owed).**

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

## 4. What was DONE

### 4a. Matrix fallback dedupe

`addPort` now records the **bare** id in a second set, `consumedIds`, alongside the `id#half`
dedupe key, and section 4's fallback tests that set
([device-view-matrix-ports.js](../../client/lib/device-view-matrix-ports.js)). One line added,
no behaviour change for unsplit ports — the plan's preferred option.

`extractMatrixPorts` moved out of `device-view-matrix.js` into
`client/lib/device-view-matrix-ports.js`. It is pure, and the render module cannot be imported
by a test without dragging in modals and the settings store (which fires a `/api/settings`
fetch at import). The component now imports it; it also lost the component from 265 → 190 lines.

### 4b. Cable anchors by half

- New `client/lib/device-view-output-layer.js` — **one** `edgeOutputLayer` parser (there were
  two; the renderer needed a third) plus `edgeHalfOf`, `isDestinationConnectorId`,
  `anchorKeyFor(id, half)` and `edgeSourceAnchorKey(edge)`.
  `device-view-destinations-inspector-modes.js` re-exports it so the existing
  inspector/destination import chain is untouched; `device-view-matrix.js` dropped its private copy.
- `device-view-destinations-ui.js` stamps `data-connector-anchor="dst_in_<id>#pgm|#prv"` on the
  two pair dots. `data-connector-id` stays on both for hit-testing — exactly the plan's
  preferred split.
- `connectorCenter(surfaceEl, connId, half)` tries the half-qualified anchor first and falls
  back to today's `data-connector-id` / `data-real-ids` path when a destination has no pair dots
  (pgm_only, pixelmap, multiview, operator_gui — all unaffected).
- `buildConnectorPositionMap` is now keyed by **anchor key** rather than bare connector id;
  `drawCable` looks up `edgeSourceAnchorKey(e)`, so a PRV edge leaves the PRV dot and a PGM edge
  the PGM dot. Sinks and non-destination connectors keep their plain id.

### 4c. Ghost + re-grab (plan step 3) — and a defect the plan did not know about

- The ghost cable takes `cableSourceHalf` from a new `cableAnchorHalf()` in
  `device-view-cable.js`: a freshly armed cable knows its half from the click
  (`state.cableSourceHalf`), while a **re-grab** has to read it off the held edge, because there
  the anchor is an existing edge end, not a click.
- Found while checking the re-grab path: `commitCableRegrab` is remove-then-add via
  `Actions.addCable(sourceId, sinkId)`, which writes a **bare** edge — so moving a PRV cable to
  another port silently dropped its `{outputLayer:2}` note and demoted the cable to a **second
  PGM feed**. Same failure mode as the ghost matrix row, and not cosmetic. The held edge's layer
  is now captured before removal and re-applied to the moved edge — and to the rolled-back edge
  if the server rejects the new target.

## 5. What was VERIFIED

- **The ghost row, on live data.** The real `GET /api/device-view` payload run through
  `extractMatrixPorts`: pre-fix (same code with `consumedIds` reverted to `addedIds`) →
  `[{id: dst_in_dst_mrzeocxh_1, label: 'PGM/PRV 1', group: 'Other Sources', half: null}]`;
  post-fix → `[]`, with exactly two rows (`— PGM`, `— PRV`) for that destination. The Operator
  GUI destination the WO flagged is `operator_gui`, not `pgm_prv`, so it keeps its single bare
  row — also asserted.
- **Anchor resolution, at the level the bug lived.** A stubbed surface with both pair dots
  sharing one `data-connector-id` and PGM first in document order: `connectorCenter(…, 'prv')`
  returns the PRV dot's centre (x 305) where the old code returned PGM's (x 105); no-half calls
  keep the legacy first-match result; a half with no anchored dot falls back rather than
  returning null (which would have made cables vanish on non-pair destinations).
- **New smoke** `tools/smoke/smoke-wo365-matrix-rows-and-cable-anchors.test.js` (16 tests) in the
  curated FILES list: matrix row counts, the anchor/output-layer lib, the DOM resolution above,
  renderer + gesture wiring pins, and a guard that the outputLayer parser exists in exactly one
  place.
- **Full offline suite: 1586 tests, 1584 pass / 0 fail / 2 skip.** Lint clean on every touched
  file (one pre-existing WO-103 innerHTML warning on an untouched block). `npm run build:client` OK.

**Owner QA owed** (acceptance §3, on the glass): matrix shows two rows for `PGM/PRV 1` and no
"Other Sources" row; in standard view the PGM cable leaves the PGM dot and the PRV cable the PRV
dot; dragging/re-grabbing either keeps its own anchor **and its bus** (a moved PRV cable must
still read `outputLayer 2` in the edge inspector).
