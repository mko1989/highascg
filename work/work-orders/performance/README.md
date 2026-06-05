# Performance fix roadmaps

Plans derived from **`work/work-orders/PERFORMANCE_RUN_CHECK_BULLETIN.md`**.

The PF markdown files describe **problems, direction, and phased work**. This README summarizes what is **already implemented in the HighAsCG tree** (mostly under `src/`, `index.js`, `client/`) and what remains **design-only or lighter**.

## Implementation status

| Doc | Topic | Done in code | Still open / lighter |
|-----|--------|--------------|----------------------|
| [PF-01](./PF-01-big-snapshots-ws-state.md) | Slim WS **`state`**, catalog, enrichment | Phase **A** (`HIGHASCG_WS_FULL_STATE_BYTES`). **B** (`getStateWsBootstrap`, `HIGHASCG_WS_SLIM_BOOTSTRAP`, slim `getState`). **C** WS `catalog_request` / `catalog_subscribe` + `catalog_chunk` (`ws-catalog-handlers.js`, `client/lib/deferred-catalog-ws.js`) with HTTP fallback. **D** partial: `HIGHASCG_GETSTATE_CINF_MAX`, `full_cinf` query params, CINF parse cache. | **D**: stop all per-row enrichment on hot paths beyond current caps; document catalog WS for non-built-in clients. |
| [PF-02](./PF-02-websocket-chatter.md) | **`change`**, **`log_line`**, channel WS | Phase **A** `HIGHASCG_WS_LOG_LINE_MAX_HZ`. **B** `HIGHASCG_WS_CHANGE_COALESCE_MS`. **C** `HIGHASCG_WS_CHANNELS_INFO_DEBOUNCE_MS`; OSC path: `HIGHASCG_WS_CHANNELS_BLOB_DEBOUNCE_MS`. | Optional: **`channels_digest`** tick, tighter coalescing policy docs. |
| [PF-03](./PF-03-persistence-flush.md) | Debounced persistence | Phase **A** `HIGHASCG_PERSISTENCE_FLUSH_MS`, `HIGHASCG_PERSISTENCE_PRETTY`, `flush` / `flushSync`, shutdown `flushSync`. **B** effectively covered by global debounced `persistence.set` for project saves. **C** `HIGHASCG_PROJECT_SYNC_DEBOUNCE_MS`, flush before WS shutdown. | Split storage / CRDT-style **`project_patch`** (long-term). |
| [PF-04](./PF-04-amcp-info-cls-workload.md) | INFO / CLS / periodic sync | **A** periodic-sync overlap guard (`_periodicSyncInFlight`). **B** `HIGHASCG_SYNC_INFO_STAGGER_MEDIA`, `HIGHASCG_SYNC_INFO_CHANNELS_PER_TICK`. **C** skip `xml2js` when INFO XML string unchanged (`StateManager`). **D** shared parser + `HIGHASCG_INFO_PARSE_MODE=fast` (`explicitArray: false`). Variables path uses same options (`query-cycle`). `finishConnectionGather` → `broadcastWsStateSnapshot`. | Full “parsed DOM cache” vs string dedupe; regex-only INFO fast path (if ever needed). |
| [PF-05](./PF-05-operational-footguns.md) | raw-batch, Art-Net, config | **A** `raw-batch` large-body warn. **B** Art-Net per-delta **`debug`**. **C** `hashSubsystemReload` skip subsystem recycle when unchanged. **D** `HIGHASCG_CONFIG_CHANGE_DEDUPE_MS`. `HIGHASCG_CONFIG_FORCE_RELOAD` escape hatch. | — |

**Suggested order (original roadmap):** PF-03 + PF-02 Phase A → PF-05 A/B → PF-01 bootstrap → PF-04 stagger/cache → PF-01 paging / PF-02 B/C.  
Much of that sequence is now landed; next large gap for very large rigs is **PF-01 Phase D** (full lazy enrichment) or third-party WS catalog clients without the HighAsCG web UI.

### Env quick reference (PF-related)

Non-exhaustive — **`grep HIGHASCG_ src/`** for the full set.

| Variable | PF |
|----------|-----|
| `HIGHASCG_WS_SLIM_BOOTSTRAP`, `HIGHASCG_WS_FULL_STATE_BYTES` | PF-01 |
| `HIGHASCG_WS_CATALOG_CHUNK_LIMIT`, `HIGHASCG_WS_CATALOG_CHUNK_ENRICH` | PF-01 |
| `HIGHASCG_GETSTATE_CINF_MAX`, query `?full_cinf=1` / `?fullCinf=1` | PF-01 |
| `HIGHASCG_WS_LOG_LINE_MAX_HZ`, `HIGHASCG_WS_CHANGE_COALESCE_MS` | PF-02 |
| `HIGHASCG_WS_CHANNELS_INFO_DEBOUNCE_MS`, `HIGHASCG_WS_CHANNELS_BLOB_DEBOUNCE_MS` | PF-02 |
| `HIGHASCG_PERSISTENCE_FLUSH_MS`, `HIGHASCG_PERSISTENCE_PRETTY`, `HIGHASCG_PROJECT_SYNC_DEBOUNCE_MS` | PF-03 |
| `HIGHASCG_SYNC_INFO_STAGGER_MEDIA`, `HIGHASCG_SYNC_INFO_CHANNELS_PER_TICK` | PF-04 |
| `HIGHASCG_INFO_PARSE_MODE` (`full` / `fast`) | PF-04 |
| `HIGHASCG_CONFIG_CHANGE_DEDUPE_MS`, `HIGHASCG_CONFIG_FORCE_RELOAD` | PF-05 |

| File | Topic (detail) |
|------|----------------|
| [PF-01-big-snapshots-ws-state.md](./PF-01-big-snapshots-ws-state.md) | Slim WS **`state`**, catalog paging, lazy enrichment |
| [PF-02-websocket-chatter.md](./PF-02-websocket-chatter.md) | **`change`** coalescing, **`log_line`** caps |
| [PF-03-persistence-flush.md](./PF-03-persistence-flush.md) | Debounced **`persistence`** flush + shutdown sync |
| [PF-04-amcp-info-cls-workload.md](./PF-04-amcp-info-cls-workload.md) | Stagger INFO, INFO XML dedupe / parser modes |
| [PF-05-operational-footguns.md](./PF-05-operational-footguns.md) | **`raw-batch`** warnings, Art-Net logs, config diff |

**Companion modules (Bitfocus):** [WebSocket slim bootstrap & catalog loading](../../../docs/companion-websocket-catalog-bootstrap.md)
