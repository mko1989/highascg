# WO-373 — "I connected PGM2 to the rec output and PGM1 got recorded": same-layer record edges tie-break on edge order, not on the cable you just dropped

**Status: DONE (28.07.26 — the §1c model question is settled from code, the mechanism is fixed at both ends, and the reported symptom is reproduced and closed in an offline test. Owner repro no longer blocking; SERVER change, needs a highascg restart.)**

Source: `work/work-orders/todos21.07.26` line 3 — one of the seven items [WO-366](./366_WO_todos21_untriaged_backlog.md)
found had never been triaged:

> i connected pgm2 to rec output and pgm1 got recorded.

Promoted out of WO-366 into its own work order because it is the one item in that block with
on-air consequence: a recording that silently captures the wrong bus is not recoverable after the
show.

## 1. Investigation

### 1a. The sync path exists and works

WO-172 built `applyStreamRecordMappingsFromGraph()` in
[src/config/device-graph-output-mapping.js:86](../../src/config/device-graph-output-mapping.js#L86)
to keep `recordOutputs[].source` in step with device-view cabling — "graph edges win over stale
`program_1` defaults in persisted JSON". The record route then resolves the channel from that
value: [routes-streaming-channel-record.js:34](../../src/api/routes-streaming-channel-record.js#L34)
(`resolveRecordSourceChannel`) and logs it at info level
([:96](../../src/api/routes-streaming-channel-record.js#L96)):

```
Record start requested on ch<N> (source=<recordSource>, layout=<programLayout>)
```

That log line is the fastest way to confirm or kill this diagnosis — see §3.

### 1b. Multiple destinations may cable to one record sink, and the winner is picked badly

The function deliberately supports several edges landing on the same record sink — it groups them
and picks one ([:129-135](../../src/config/device-graph-output-mapping.js#L129-L135)):

```js
for (const [recordId, list] of groupedRecords.entries()) {
    const winner = list.slice().sort((a, b) => a.layer - b.layer)[0]
```

`layer` here is the edge's `outputLayer` note — **1 = PGM, 2 = PRV** (the same convention WO-364
later reused for the PRV bus). Its purpose is "prefer PGM over PRV".

It does not disambiguate **two different destinations both cabled at layer 1**. Both compare
equal, `Array.prototype.sort` is stable in V8, so the winner is simply whichever edge came first
in `collectDestinationOutputEdges()` order — i.e. graph edge insertion order. The edge cabled
*earliest* wins, permanently.

That is exactly the reported symptom: with an existing PGM1 → record edge in the graph, cabling
PGM2 → the same record output adds a second layer-1 edge that loses the tie forever. The UI shows
the new cable; `recordOutputs[].source` keeps saying `program_1`; the recording captures PGM1.

The identical pattern is used for streams ([:106](../../src/config/device-graph-output-mapping.js#L106)),
so a stream cabled the same way would mis-source too.

### 1c. Why this is a hypothesis and not a confirmed root cause

The graph state from 21.07 no longer exists — today's box has one `record_out`-bound destination,
so the tie never occurs and the bug cannot fire here right now. The mechanism is proven from the
code; that the owner's box was in the two-edge state is inferred from the symptom. It is a strong
inference (nothing else in this path prefers PGM1) but it is an inference.

A second, cheaper possibility must be excluded first: if cabling in device view is supposed to
**replace** the previous edge on a record sink and simply failed to remove the old one, then the
tie-break is a symptom and the missing edge-removal is the bug. Whether a record sink is
single-cable or multi-cable is a design question this WO cannot answer from the code alone — the
grouping logic implies multi, the "a connector can hold one binding" note in
[WO-364 §1](./364_WO_prv_physical_output_gpu.md) implies single for GPU ports. Settle this before
writing the fix; it decides between "fix the tie-break" and "fix the drop handler".

## 2. What needs doing (plan — NOT executed)

1. **Reproduce** (§3) and capture the record log line + the resulting `recordOutputs[].source`.
2. **Decide the model:** may two destinations cable to one record output at all?
   - **If no** — the drop/click handler must remove the existing edge on that sink, and
     `applyStreamRecordMappingsFromGraph` should treat >1 same-layer edge as a data error and log
     it loudly rather than silently picking one.
   - **If yes** — the tie-break needs a deterministic, user-meaningful rule. "Most recently cabled"
     is what the owner expects; that needs a timestamp or sequence on the edge, since edge array
     order is not a reliable proxy for recency after any graph rewrite. An explicit "record source"
     selector on the record output's inspector would be more honest than an implicit rule.
3. **Make it visible either way.** A record output whose resolved source is not the destination the
   operator thinks they cabled should be visible *before* pressing record — surface the resolved
   source on the record output's card/inspector. WO-360 built exactly this kind of pre-flight
   surfacing for missing media; the same idea applies.
4. Apply the same fix to the stream grouping at [:106](../../src/config/device-graph-output-mapping.js#L106) — it has the identical tie-break.

## 3. Repro procedure (owner, ~5 minutes, safe)

1. In device view, cable **PGM of destination 1** to the record output. Note it.
2. Without removing that cable, cable **PGM of destination 2** to the *same* record output.
3. Check `config` → `recordOutputs[].source`. Expected if this WO is right: still `program_1`.
4. Start a record and read the log line: `Record start requested on ch<N> (source=…)`. If it says
   `source=program_1` while the UI shows destination 2 cabled, the diagnosis is confirmed.
5. If instead the first cable disappeared when you dropped the second, the tie never happened —
   report that, because it means the failure was something else entirely and this WO needs redoing.

## 4. Acceptance criteria

- Cabling a record output to a different destination changes what gets recorded, every time, with
  no dependence on which cable is older.
- The resolved source is visible in the UI before recording starts.
- Streams get the same treatment.
- A smoke covering two same-layer edges on one record sink, asserting the documented winner (not
  whatever `sort` happens to produce), added to the curated FILES list.

## 5. RESOLUTION (28.07.26)

### 5a. §1c answered — the model is SINGLE-cable, and there was a hole

The WO could not decide from the code whether a record sink may hold more than one cable. It can
not: `addEdgeToGraph` rejects a second edge to any Caspar output — `record_out` is in
`isCasparOutputConnector` — with `sink_already_connected`
([device-graph-edges.js](../../src/config/device-graph-edges.js)). Proven in the new smoke.

So the tie-break resolves a state the API forbids… which is nonetheless reachable, because
**`validateDeviceGraph` does not enforce single-input** (it checks referential integrity,
self-loops and exact duplicates only) and **whole-graph writes skip `addEdgeToGraph` entirely**.
The matrix view did exactly that: a crosspoint click deep-copied the graph, `push`ed a new edge and
wrote the lot through `saveSettingsPatch({ deviceGraph })`
([device-view-matrix.js](../../client/components/device-view-matrix.js)). Cabling PGM2 onto an
already-cabled record output **in matrix view** produced two layer-1 edges — precisely the state
§1b describes. Standard view would have refused it. That is the missing half of the diagnosis, and
it means the answer to §1c's "fix the tie-break or fix the drop handler" is **both**.

### 5b. What was changed

1. **`pickOutputEdgeWinner()`** in `src/config/device-graph-output-mapping.js` replaces the three
   copies of `sort((a, b) => a.layer - b.layer)[0]` (streams, records, **and** virtual camera —
   the WO only spotted two). Rule, now documented in the code: layer 1 (PGM) beats layer 2 (PRV);
   among **same-layer** edges the **last in graph order wins** — the most recently cabled, which is
   what the operator means — and it emits a warning naming every candidate and the winner, because
   an output fed by two cables is a data error, not a preference.
2. **The matrix stops creating the state.** A crosspoint click on a single-input sink now removes
   the existing edge on that sink before adding its own (router semantics — one crosspoint per
   output column). `isSingleInputSinkId()` in `client/lib/device-view-matrix-ports.js` mirrors the
   server's connector-kind list; pixel-map inputs are deliberately excluded, they take several feeds.
3. **The resolved bus is visible before recording** (plan step 3): record and stream ports carry
   `resolvedSource` — the persisted value the server resolves at start time — into the rear-panel
   marker tooltip: `Rec1 — Record · id record_1 · source program_2`.
4. Streams got the same treatment (plan step 4) via the shared helper.

### 5c. What was VERIFIED

- **The reported symptom, reproduced and closed.** On the identical two-edge list:
  old rule → `program_1` (the bug: "pgm1 got recorded"), new rule → `program_2`. End-to-end,
  `applyStreamRecordMappingsFromGraph` on a config with PGM1 cabled first and PGM2 second now
  writes `recordOutputs[0].source = 'program_2'`; it wrote `program_1` before.
- **The conflict is announced**: one warning naming `record_1`, both candidates and the winner.
  No warning when the layers legitimately differ.
- **PGM still beats PRV** in both edge orders, and a PRV-only cable still resolves to `preview_1`.
- **The server API refuses the illegal state** (`sink_already_connected`), asserted rather than
  assumed.
- **`isSingleInputSinkId` matches the server's kind list**, and does not claim pixel-map inputs.
- New smoke `tools/smoke/smoke-wo373-record-source-tiebreak.test.js` (11 tests) in the curated
  FILES list. **Full suite: 1610 tests, 1608 pass / 0 fail / 2 skip.** Lint 0, prettier clean,
  unwired-export gate clean, 500-line gate clean. `npm run build:client` OK, kiosk reloaded.
- Read at `dc8b2c4`/`e81dbdf`; no cabling touched on the live box, no graph rewritten.

### 5d. What is still owed

- **The server half needs a highascg restart** (`kill -TERM $(systemctl show -p MainPID --value highascg)`);
  the client half is built and reloaded already.
- The §3 repro is no longer needed to *confirm* the diagnosis, but it is still the honest way to
  close the loop on hardware: cable a second destination onto a cabled record output **in matrix
  view**, check `recordOutputs[].source` follows it, and read
  `Record start requested on ch<N> (source=…)`.
- Not done: a config-import/hand-edit path can still persist two edges on one sink. The mapping now
  survives it loudly instead of silently, which was the WO's requirement, but enforcing single-input
  inside `validateDeviceGraph` would close it at the source. Left out deliberately — it would make
  every existing graph with that shape fail to load, which is a migration decision, not a bug fix.
