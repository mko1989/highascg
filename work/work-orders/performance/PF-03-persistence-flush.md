# PF-03 — Persistence flush storms (`persistence.set`, full-file rewrite)

**Linked bulletin:** PERF-F2, PERF-E3 (`project_sync`)  
**Status:** **Implemented (Phases A + C; B via global debounced `set`)** — see [`README.md`](./README.md).

---

## Problem

Each **`persistence.set(key, value)`** triggers **`JSON.stringify(_cache, null, 2)`** + **`writeFileSync`** temp rename — **full document**, pretty-printed. Bursts (multiview sync, scene deck, plugins, autosave) **block the event loop** and thrash disk.

Large **`web_project`** keys make **every unrelated **`set`** pay full serialization cost.

---

## Why it keeps coming back

- API is trivially correct (“always durable”).  
- Feature authors call **`set`** freely — no batch boundary in product layers.  
- Pretty JSON aids debugging — accidentally shipped as production default.

---

## Direction that sticks

**Debounced flush + dirty tracking + shutdown barrier.**

| Mechanism | Behavior |
|-----------|----------|
| **Dirty flag / queue** | **`set`** mutates in-memory **`_cache`** immediately; schedules **`flush`** trailing debounce (**150–250 ms**) coalescing N writes into **one** disk sync. |
| **Shutdown** | **`SIGTERM`/`SIGINT`/hooks`** force **`flushSync()`** once — no lost data. |
| **Optional compact JSON** | **`HIGHASCG_PERSISTENCE_PRETTY=0`** uses **`JSON.stringify(cache)`** without indent for prod images. |

Optional later: **split keys** into separate files (**projects**, **prefs**) — bigger migration.

---

## Implementation path

| Phase | In-tree |
|-------|---------|
| A | Done — `HIGHASCG_PERSISTENCE_FLUSH_MS`, `HIGHASCG_PERSISTENCE_PRETTY`, `flush` / `flushSync`, shutdown wiring. |
| B | Done in practice — all `persistence.set` calls coalesce through the same debounced flush (incl. `web_project`). |
| C | Done — `HIGHASCG_PROJECT_SYNC_DEBOUNCE_MS`, `flushProjectSyncBroadcast` before WS shutdown. |

### Phase A — Debounced **`_save`** (minimal surface change)

- Internal **`scheduleSave()`** with **`clearTimeout`** reset on each **`set`**.  
- **`flush()`** / **`flushSync()`** exported for shutdown (`index.js` shutdown pipeline already exists — wire **`persistence.flushSync`**).

### Phase B — **`project_save`** fast path

- **`routes-data`** **`handleProject`**: optional **`persist.queueMerge`** batching **`PROJECT_DISK_KEY`** with debounced flush only (avoid double-save when UI saves scene deck + project in same tick).

### Phase C — **`project_sync` WS**

- Either debounce **`project_sync`** (don’t broadcast entire project on every autosave tick) **or** send **`project_revision`** + **`project_patch`** if/when UI supports CRDT-lite diff (long term).

---

## Acceptance criteria

- Microbench: **100 rapid **`set`** small keys** ⇒ **1–2** disk writes not **100**.  
- Kill server mid-burst **after settle**: file consistent (**atomic rename** preserved).

---

## Regression risks

- Tests assuming flush synchronous — update tests to **`await flush()`** or **`flushSync`** where needed.  
- Plugins relying on crash-safe immediate disk — document **`flushSync`** API for privileged callers.
