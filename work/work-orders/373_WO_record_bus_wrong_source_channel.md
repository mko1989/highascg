# WO-373 — "I connected PGM2 to the rec output and PGM1 got recorded": same-layer record edges tie-break on edge order, not on the cable you just dropped

**Status: OPEN — strong code evidence for a specific mechanism, but the owner's 21.07 cable state is gone, so the repro is owed. Not fixed.**

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

## 5. What was VERIFIED

- The tie-break code, the `layer` semantics, and the record route's source resolution were read at
  `dc8b2c4`; line references above are exact.
- Confirmed the current box has no two-edge record state, so this cannot be reproduced here without
  deliberately creating it — hence the owner repro in §3 rather than a claimed fix.
- Nothing changed; no cabling touched on the live box.
