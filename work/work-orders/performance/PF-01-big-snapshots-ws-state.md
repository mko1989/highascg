# PF-01 — Big snapshots & serialization (`getState`, WS `state`)

**Linked bulletin:** PERF-K2, PERF-I1, PERF-C1, PERF-C2  
**Status:** Design / implementation roadmap (not implemented in this doc)

---

## Problem

Every WebSocket connect and optional periodic **`state`** push builds a **full application snapshot** (`getState(ctx)` → **`JSON.stringify`**). Cost scales with:

- **`media`** / **`templates`** / **`channels`** cardinality  
- Per-row enrichment (e.g. **`parseCinfMedia`** on media entries in snapshots)  
- Number of concurrent WS clients × snapshot frequency  

Under reconnect storms or aggressive **`HIGHASCG_WS_BROADCAST_MS`**, this dominates CPU and bandwidth.

---

## Why it keeps coming back

1. **Convenience wins:** New UI features ask for “just send the whole state” instead of defining a narrow contract.  
2. **Duplication:** **`CHOICES_MEDIAFILES`**, **`state.media`**, and HTTP caches overlap — snapshots repeatedly flatten the same data.  
3. **No contract tests:** Nothing fails CI when **`getState`** grows a heavy field or runs enrichment on full catalogs.

---

## Direction that sticks

Treat **`state`** WS messages as **three tiers**, not one blob:

| Tier | Contents | When |
|------|-----------|------|
| **Bootstrap** | Routing, variables, minimal channel summary, counts — **no full media array bodies** | First message after hello / explicit “full bootstrap” |
| **Catalog patch** | Delta or paginated **`media`/`templates`** slices | After CLS/TLS or on subscription |
| **Live deltas** | **`change`** / **`variable_update`** already partially exist — extend consistently | Normal runtime |

**Rule:** **`JSON.stringify(getState())`** over WS must never be the **default** hot path for steady state.

---

## Implementation path (phased)

### Phase A — Instrument & guardrails (low risk)

- Add optional **`HIGHASCG_WS_FULL_STATE_BYTES`** log line when serialized **`state`** exceeds a threshold (sampled).  
- Document maximum recommended catalog size in ops docs.  
- Add a dev-only assertion listing **`getState`** keys sorted by serialized weight (manual script).

### Phase B — Slim bootstrap snapshot

- Define **`getStateWsBootstrap(ctx)`** (new): everything the shell UI needs **without** embedding full **`media`**/`templates` arrays (send **`mediaCount`**, **`templateCount`**, hashes/version stamps).  
- Keep **`GET /api/state`** behavior unless/until API versioning allows slimming too (coordinate with Companion).

### Phase C — Catalog subscription / paging

- WS message **`catalog_subscribe`** with **`{ slice: 'media', offset, limit }`** → server pushes **`catalog_chunk`**.  
- Or HTTP **`GET /api/media?page=`** already exists patterns — mirror that over WS for parity.

### Phase D — Lazy enrichment

- Stop running **`parseCinfMedia`** for **every** media row on **every** snapshot; enrich only visible subset or cache **`durationMs`** on CLS ingest (**single writer**).

---

## Acceptance criteria

- Cold WS connect no longer allocates proportional to **full catalog × enrichment** on typical rigs (measure before/after with same fixture).  
- Companion / web UI still recover after reload without forcing **`GET /api/state`** storms unless documented.

---

## Regression risks

- Companion modules assuming **full** initial **`state`** payload — version gate or capability flag **`wsBootstrapV2`**.
