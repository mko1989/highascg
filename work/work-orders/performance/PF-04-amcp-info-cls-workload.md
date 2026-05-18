# PF-04 — AMCP / INFO / CLS workload (gather + periodic sync + xml2js)

**Linked bulletin:** PERF-D2, PERF-D3, PERF-F1  
**Status:** Design / implementation roadmap

---

## Problem

On Caspar connect and during periodic sync:

- **CLS/TLS** walks scale with catalog size; handlers rebuild **`CHOICES_*`** arrays.  
- **INFO** per channel plus **`xml2js.parseString`** in **`updateFromInfo`** multiply CPU cost × channels × frequency.  
- **`finishConnectionGather`** may broadcast another **full WS `state`** — double-hit with WS bootstrap (**PERF-D2**).

---

## Why it keeps coming back

- Correctness bias: “refresh everything after reconnect.”  
- Adding a feature often adds another **`INFO`** or **`CLS`** touchpoint instead of subscribing to existing staleness signals.  
- OSC/light-sync branches partially optimized — AMCP-heavy paths remain default.

---

## Direction that sticks

**Tiered freshness model:**

| Tier | Source | Frequency |
|------|--------|-----------|
| **Critical routing** | **`INFO CONFIG`** / minimal channel list | On connect + rare invalidation |
| **Forensic detail** | Full **`INFO N`** XML | On-demand (`?deep=1`) or staggered scheduler |
| **Media/templates** | CLS/TLS | Debounced coalesce with media-library cycle — never parallel duplicate CLS |

**Rule:** No code path should **`parseString`** full channel XML on **every** periodic tick unless OSC explicitly disabled **and** drift detector fires.

---

## Implementation path

### Phase A — Scheduler hygiene

- Ensure **`periodic-sync`** never overlaps CLS + INFO storms (**mutex already partially present** — audit call sites).  
- Document **`periodic_sync_interval_sec`** tuning for large catalogs.

### Phase B — Stagger INFO parsing

- Replace “INFO all channels each tick” with **round-robin N channels/tick** when **`catalogLarge`** heuristic triggers (**mediaCount > threshold**).

### Phase C — Cache parsed INFO DOM

- Keep **`channels[ch]`** parsed object until **`VERSION`** bump or **`INFO n`** checksum changes — skip **`xml2js`** repeat.

### Phase D — Split **`updateFromInfo`**

- Fast path: regex/text extract only variables UI needs; slow path full parse gated behind flag.

---

## Acceptance criteria

- Under synthetic **50-channel / 10k CLS rows** fixture (offline mock AMCP): periodic sync CPU **bounded** vs baseline log sampling.  
- Companion variables still update within **≤2×** previous latency SLA (define SLA per deployment).

---

## Regression risks

- Layer labels / fills stale — need explicit **`forceRefresh`** AMCP route for ops.
