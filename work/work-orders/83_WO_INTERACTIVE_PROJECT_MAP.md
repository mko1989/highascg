# WO-83 — Interactive Project Architecture Map: index & dependency order

**Program goal:** A self-hosted, infinitely-zoomable interactive web application that maps the entire HighAsCG stack — from Ubuntu OS and hardware at the top, through systemd services, through application modules, down to individual exported JS functions. Click any node to drill deeper; breadcrumb back to any ancestor level.

**Status:** Parent index — child WOs carry task checklists.  
**Created:** 2026-06-29  
**Priority:** Medium (internal tooling / developer experience / onboarding)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

---

## Child work orders (execute in order unless noted)

| ID | Document | Topic | Depends on |
|----|----------|-------|------------|
| **83a** | [83a_WO_MAP_DATA_OS_AND_SERVICES.md](./83a_WO_MAP_DATA_OS_AND_SERVICES.md) | Data generation: static OS, hardware, kernel, systemd, X11, filesystem layers (Layer 0–1) | — |
| **83b** | [83b_WO_MAP_DATA_SERVER_MODULES.md](./83b_WO_MAP_DATA_SERVER_MODULES.md) | Data generation: `src/` module scan, file inventory, AST extraction (exports, functions, routes) (Layer 2, 4–5) | 83a (JSON schema) |
| **83c** | [83c_WO_MAP_DATA_CLIENT_AND_CROSSREFS.md](./83c_WO_MAP_DATA_CLIENT_AND_CROSSREFS.md) | Data generation: `client/` component + lib scan, grouping, import graph, work-order cross-references (Layer 3, 4–5) | 83a (JSON schema), 83b (shared AST tooling) |
| **83d** | [83d_WO_MAP_VIEWER_CORE_NAVIGATION.md](./83d_WO_MAP_VIEWER_CORE_NAVIGATION.md) | Map viewer UI: node cards, drill-down, breadcrumbs, metadata sidebar, dark theme | 83a (data to render) |
| **83e** | [83e_WO_MAP_VIEWER_SEARCH_AND_ZOOM.md](./83e_WO_MAP_VIEWER_SEARCH_AND_ZOOM.md) | Map viewer: full-text search overlay, pan/zoom, minimap, keyboard navigation | 83d (core viewer) |
| **83f** | [83f_WO_MAP_VIEWER_DEPENDENCY_GRAPH.md](./83f_WO_MAP_VIEWER_DEPENDENCY_GRAPH.md) | Map viewer: import/require edges, dependency highlighting, flat graph toggle | 83b + 83c (cross-ref data), 83d (viewer shell) |
| **83g** | [83g_WO_MAP_HOSTING_INTEGRATION_POLISH.md](./83g_WO_MAP_HOSTING_INTEGRATION_POLISH.md) | Hosting at `/map`, Vite multi-page, header bar link, build integration, visual polish, responsive tablet layout | All prior |

**Suggested execution slices:**

- **MVP-1 (usable map):** 83a + 83b + 83c + 83d — curated data + file-level scan + clickable drill-down viewer.
- **MVP-2 (searchable):** + 83e — search overlay, zoom/pan, keyboard navigation.
- **Full:** + 83f + 83g — dependency edges, hosting integration, polish.

---

## Architecture overview

```
tools/map/generate-map-data.js     ← 83a+83b+83c — produces map-data.json
    ├── Phase 1: Static OS/service data (curated)          ← 83a
    ├── Phase 2: src/ module + file + AST scan             ← 83b
    └── Phase 3: client/ scan + import graph + WO links    ← 83c

client/map.html + map-explorer.js  ← 83d+83e+83f — renders the interactive viewer
    ├── Core: node cards, drill, breadcrumbs               ← 83d
    ├── Search + zoom + minimap                            ← 83e
    └── Dependency edges + graph mode                      ← 83f

src/server/http-server.js          ← 83g — serves /map route
package.json                       ← 83g — npm run map:generate
```

---

## Depth levels (reference)

| Layer | Scope | Data source | WO |
|-------|-------|------------|-----|
| 0 | Hardware & OS: Ubuntu, GRUB, kernel, drivers | Static curated JSON | 83a |
| 1 | Services & applications: systemd units, CasparCG, HighAsCG, Companion, nginx, Syncthing | Static + systemd parse | 83a |
| 2 | Server modules: `src/api/`, `src/engine/`, `src/caspar/`, etc. (26 dirs) | Directory walk | 83b |
| 3 | Client components + libs: `client/components/` (147 files), `client/lib/` (164 files) | Directory walk + prefix grouping | 83c |
| 4 | Individual files: exports, imports, route definitions, line counts | AST parse (acorn) | 83b + 83c |
| 5 | Functions / exports: signatures, callers, callees, line ranges | AST parse (acorn) | 83b + 83c |

---

## Required reading (shared across all sub-WOs)

- [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) — connection diagram, repo model, what runs where
- [MODULES.md](../../docs/MODULES.md) — optional module registry, previs/tracking/autofollow/CG Studio
- [openbox_autostart.md](../../docs/openbox_autostart.md) — boot chain, X session, Caspar supervisor
- [11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md](./11_WO_BOOT_ORCHESTRATOR_AND_OS_SETUP.md) — boot orchestrator, config manager

---

## Shared data model (`map-data.json` schema)

All sub-WOs use this node shape:

```json
{
  "id": "unique-stable-id",
  "label": "Human-readable label",
  "kind": "os|bootloader|kernel|driver|subsystem|init|service|application|module|group|file|function|class|constant|route|ws-event",
  "description": "One-line purpose",
  "meta": {},
  "children": []
}
```

Top-level envelope:

```json
{
  "version": 1,
  "generated": "ISO timestamp",
  "root": { /* single root node (ubuntu) */ }
}
```

---

## Color coding (shared design token reference)

| Kind | Background | Border | Icon |
|------|-----------|--------|------|
| `os` | `#1e293b` | `#475569` | 🖥️ |
| `bootloader` | `#1e293b` | `#64748b` | ⚡ |
| `kernel` | `#1c1917` | `#57534e` | 🧬 |
| `driver` | `#1c1917` | `#78716c` | 🔌 |
| `subsystem` | `#1a1a2e` | `#4a4a6a` | ⚙️ |
| `init` | `#172554` | `#1d4ed8` | 🔄 |
| `service` | `#1e3a5f` | `#3b82f6` | 🟢 |
| `application` | `#064e3b` | `#10b981` | 📦 |
| `module` | `#2e1065` | `#8b5cf6` | 📁 |
| `group` | `#312e81` | `#6366f1` | 📂 |
| `file` | `#451a03` | `#f59e0b` | 📄 |
| `function` | `#083344` | `#06b6d4` | ƒ |
| `route` | `#3b0764` | `#d946ef` | 🌐 |
| `ws-event` | `#1a2e05` | `#84cc16` | ⚡ |

*End of WO-83 index*
