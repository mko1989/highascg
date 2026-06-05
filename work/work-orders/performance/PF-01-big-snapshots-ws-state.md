# PF-01 — Big snapshots & serialization (`getState`, WS `state`)

**Linked bulletin:** PERF-K2, PERF-I1, PERF-C1, PERF-C2  
**Status:** **Partly implemented** — phased checklist under [Implementation path](#implementation-path-phased); summary in [`README.md`](./README.md). **Companion:** [slim WS / catalog guide](../../../docs/companion-websocket-catalog-bootstrap.md).

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

| Phase | In-tree |
|-------|---------|
| A | Done — `HIGHASCG_WS_FULL_STATE_BYTES` (sampled warn in `ws-server.js`). |
| B | Done — `getStateWsBootstrap`, `HIGHASCG_WS_SLIM_BOOTSTRAP`, slim `getState` / HTTP; web UI fills catalog via **WS** `catalog_request` / `catalog_subscribe` + `catalog_chunk` (`deferred-catalog-ws.js`), with **GET `/api/state` fallback**. |
| C | Done — WS **`catalog_request`** (one slice) and **`catalog_subscribe`** (server pumps **`catalog_chunk`** for `media`); templates use a single `catalog_request`. Server: `ws-catalog-handlers.js`. Env **`HIGHASCG_WS_CATALOG_CHUNK_LIMIT`**, **`HIGHASCG_WS_CATALOG_CHUNK_ENRICH`**. |
| D | **Partial** — `HIGHASCG_GETSTATE_CINF_MAX`, `?full_cinf=1` / `?fullCinf=1` on `/api/state` & `/api/media`, shared CINF helper, parse cache in `StateManager`. |

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

*Implemented:* **`catalog_request`** (one chunk) and **`catalog_subscribe`** (server auto-pumps **`catalog_chunk`** for **`media`**); chunks carry **`slice`**, **`offset`**, **`total`**, **`items`**, **`done`**, **`requestId`**, optional **`streamId`**. **`HIGHASCG_WS_CATALOG_CHUNK_ENRICH=0`** sends raw CLS rows without per-chunk probe/CINF merge (fastest).

### Phase D — Lazy enrichment

- Stop running **`parseCinfMedia`** for **every** media row on **every** snapshot; enrich only visible subset or cache **`durationMs`** on CLS ingest (**single writer**).

---

## Acceptance criteria

- Cold WS connect no longer allocates proportional to **full catalog × enrichment** on typical rigs (measure before/after with same fixture).  
- Companion / web UI still recover after reload without forcing **`GET /api/state`** storms unless documented.

---

## Regression risks

- Companion modules assuming **full** initial **`state`** payload — version gate or capability flag **`wsBootstrapV2`**.
