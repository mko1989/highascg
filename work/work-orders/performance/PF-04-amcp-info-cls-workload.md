# PF-04 — AMCP / INFO / CLS workload (gather + periodic sync + xml2js)

**Linked bulletin:** PERF-D2, PERF-D3, PERF-F1  
**Status:** **Partly implemented** — Phases A–D largely landed; Phase D uses **xml2js fast mode** (`HIGHASCG_INFO_PARSE_MODE=fast`), not a separate regex extractor. Summary in [`README.md`](./README.md).

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

| Phase | In-tree |
|-------|---------|
| A | Done — `_periodicSyncInFlight` overlap guard (`periodic-sync.js`); tune **`periodic_sync_interval_sec`** for large catalogs. |
| B | Done — `HIGHASCG_SYNC_INFO_STAGGER_MEDIA`, `HIGHASCG_SYNC_INFO_CHANNELS_PER_TICK`. |
| C | **Mostly done** — skip `xml2js` when raw INFO XML unchanged (`StateManager._lastInfoXmlByChannel`). *Original “parsed DOM cache” is not separate from this string-level skip.* |
| D | **Done (alternative to spec)** — shared `extractChannelInfoFromParsed` (`info-channel-parse.js`); **`HIGHASCG_INFO_PARSE_MODE=fast`** (`explicitArray: false`). `query-cycle.updateChannelVariablesFromXml` uses the same xml2js options. *Regex-only fast path from the spec below is not implemented.* |

`finishConnectionGather` uses `broadcastWsStateSnapshot` (slim vs full follows `HIGHASCG_WS_SLIM_BOOTSTRAP` / bootstrap helpers — PF-01).

### Phase A — Scheduler hygiene

- Ensure **`periodic-sync`** never overlaps CLS + INFO storms (**mutex already partially present** — audit call sites).  
- Document **`periodic_sync_interval_sec`** tuning for large catalogs.

### Phase B — Stagger INFO parsing

- Replace “INFO all channels each tick” with **round-robin N channels/tick** when **`catalogLarge`** heuristic triggers (**mediaCount > threshold**).

### Phase C — Cache parsed INFO DOM

- Keep **`channels[ch]`** parsed object until **`VERSION`** bump or **`INFO n`** checksum changes — skip **`xml2js`** repeat.

### Phase D — Split **`updateFromInfo`**

- *Spec:* fast path: regex/text extract only variables UI needs; slow path full parse gated behind flag.  
- *Shipped:* fast **xml2js** mode + shared extraction (see table above); regex-only path omitted.

---

## Acceptance criteria

- Under synthetic **50-channel / 10k CLS rows** fixture (offline mock AMCP): periodic sync CPU **bounded** vs baseline log sampling.  
- Companion variables still update within **≤2×** previous latency SLA (define SLA per deployment).

---

## Regression risks

- Layer labels / fills stale — need explicit **`forceRefresh`** AMCP route for ops.
