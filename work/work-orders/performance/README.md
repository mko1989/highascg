# Performance fix roadmaps

Plans derived from **`work/work-orders/PERFORMANCE_RUN_CHECK_BULLETIN.md`** — **design only** until implemented.

| File | Topic |
|------|--------|
| [PF-01-big-snapshots-ws-state.md](./PF-01-big-snapshots-ws-state.md) | Slim WS **`state`**, catalog paging, lazy enrichment |
| [PF-02-websocket-chatter.md](./PF-02-websocket-chatter.md) | **`change`** coalescing, **`log_line`** caps |
| [PF-03-persistence-flush.md](./PF-03-persistence-flush.md) | Debounced **`persistence`** flush + shutdown sync |
| [PF-04-amcp-info-cls-workload.md](./PF-04-amcp-info-cls-workload.md) | Stagger INFO / cache xml2js / periodic-sync hygiene |
| [PF-05-operational-footguns.md](./PF-05-operational-footguns.md) | **`raw-batch`** warnings, Art-Net logs, config diff |

**Suggested order:** PF-03 + PF-02 Phase A (localized, high ROI) → PF-05 Phase A/B → PF-01 bootstrap → PF-04 stagger/cache → PF-01 paging / PF-02 Phase B/C.
