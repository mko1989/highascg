# WO-83b — Map data: server module scan, AST extraction, route/function inventory (Layer 2, 4–5)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done.
> 2. Update task checkboxes to reflect current status.
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry.
> 4. Do **NOT** delete previous agents' log entries.

**Parent:** [WO-83 index](./83_WO_INTERACTIVE_PROJECT_MAP.md)  
**Status:** Not started  
**Prerequisites:** 83a (JSON schema, envelope, static layers)

---

## 1. Objective

Extend `tools/map/generate-map-data.js` to **auto-scan the entire `src/` directory tree**, parse each `.js` file with an AST parser, and inject deeply detailed nodes into the map data under `app:highascg-server`. The output must include:

1. **Module-level nodes** (Layer 2): one per `src/` subdirectory, with description and file list.
2. **File-level nodes** (Layer 4): every `.js` file with line count, byte size, imports, and exported symbols.
3. **Function-level nodes** (Layer 5): every exported function/class/constant with signature, line range, and JSDoc summary.
4. **Route definitions**: every HTTP endpoint defined in `routes-*.js` files.
5. **WebSocket events**: any `ws.send` / `broadcast` event names found in server code.

---

## 2. Server module inventory (Layer 2)

The scan must produce one `kind: "module"` node per `src/` subdirectory. The following is the complete list of directories to expect, with curated descriptions the generator should embed:

| Directory | id | Label | Description | File count |
|-----------|-----|-------|-------------|------------|
| `src/api/` | `mod:api` | API Router & Routes | REST API — 60+ route files, request dispatch, settings, device-view CRUD | 70 |
| `src/server/` | `mod:server` | HTTP & WebSocket Servers | HTTP server (:4200), WebSocket server, CORS, AMCP dispatch, catalog handlers | 6 |
| `src/caspar/` | `mod:caspar` | AMCP Protocol Client | TCP connection to CasparCG :5250, AMCP command builders, batch operations, query parsing | 20 |
| `src/engine/` | `mod:engine` | Scene & Timeline Engine | Scene take (LBG/PGM-only), transitions, timeline playback, multiview, PiP overlay, global border, project store | 48 |
| `src/state/` | `mod:state` | Live State Manager | Channel state from INFO/CLS, playback tracker, live scene reconciliation | 8 |
| `src/osc/` | `mod:osc` | OSC Listener | UDP OSC from CasparCG — audio meters, playback position, profiler telemetry | 4 |
| `src/audio/` | `mod:audio` | Audio Subsystem | ALSA mixer control, audio device enumeration, metering, live audio health | 5 |
| `src/media/` | `mod:media` | Media Library | Local media scan (ffmpeg probe), thumbnails, project media root, USB drive copy, CG look thumbnails | 14 |
| `src/replication/` | `mod:replication` | Hot Backup Replication | Leader/follower sync, AMCP fanout, playhead sync, media rsync, project push, failover | 50 |
| `src/streaming/` | `mod:streaming` | Streaming & NDI | FFmpeg streaming setup, NDI resolve, streaming channel status, UDP port management | 7 |
| `src/artnet/` | `mod:artnet` | ArtNet / DMX | ArtNet DMX receiver, DMX-driven border effects, sACN/Art-Net output | 8 |
| `src/companion/` | `mod:companion` | Companion Integration | Satellite preview client, button preview cache, companion config | 4 |
| `src/companion-bridge/` | `mod:companion-bridge` | Companion Bridge | Look-air frame contract, registry for Companion module communication | 3 |
| `src/preview/` | `mod:preview` | Compose Preview | FFmpeg JPEG snapshot pipeline — activity tracking, cache, dirty detection, consumer management | 10 |
| `src/config/` | `mod:config` | Config Manager | Config load/save, schema validation, reload signaling | (via bootstrap) |
| `src/system/` | `mod:system` | System & exFAT | exFAT sync, network inventory, private volume sync, server update, operator snap | 12 |
| `src/utils/` | `mod:utils` | Utilities | OS config (xrandr, nvidia), GPU topology (DRM, xrandr), DeckLink enum, persistence, logging, periodic sync, caspar restart | 40 |
| `src/sampling/` | `mod:sampling` | DMX Sampling | DMX sampling ingress, output, worker for lighting fixture data | 4 |
| `src/plugins/` | `mod:plugins` | Plugin Manager | Dynamic plugin loading system | 1 |
| `src/support/` | `mod:support` | Support Bundle | Diagnostic ZIP export — GPU snapshot, settings redaction, log collection | 4 |
| `src/bootstrap/` | `mod:bootstrap` | Server Bootstrap | Startup sequence — args, config, modules, shutdown, watchdogs, LED test pattern | 13 |
| `src/previs/` | `mod:previs` | 3D Previs (optional) | Optional module — 3D model routes, scene registration | 3 |
| `src/tracking/` | `mod:tracking` | Person Tracking (optional) | Optional module — person detection registration stub | 1 |
| `src/autofollow/` | `mod:autofollow` | Auto-follow PTZ (optional) | Optional module — stage auto-follow camera registration stub | 1 |
| `src/cg-studio/` | `mod:cg-studio` | CG Studio (optional) | Template editor — HTTP server on :4300, GrapesJS, template scan, export | 9 |
| `src/share/` | `mod:share` | Share (empty) | Reserved for future shared code | 0 |

The generator should read this metadata from a curated lookup and fall back to directory name for unknown directories.

---

## 3. AST extraction specification (Layer 4–5)

### 3.1 Parser choice

Use **`acorn`** (https://github.com/acornjs/acorn):
- Pure JS, zero native deps, ~150 KB
- Supports ES2022+ syntax
- Install as `devDependency`: `npm install --save-dev acorn`
- Parse with `{ ecmaVersion: 'latest', sourceType: 'module' }` (try `module` first, fall back to `script` on error for CommonJS files)

### 3.2 Per-file extraction

For each `.js` file, extract:

```js
{
  id: "file:src/engine/scene-take.js",
  label: "scene-take.js",
  kind: "file",
  description: "/* first line comment or JSDoc @fileoverview if present */",
  meta: {
    path: "src/engine/scene-take.js",     // relative to repo root
    absPath: "/home/casparcg/highascg/src/engine/scene-take.js",
    lines: 284,
    bytes: 10495,
    imports: [                            // require() / import targets
      { target: "./scene-transition.js", resolved: "src/engine/scene-transition.js" },
      { target: "../utils/logger.js", resolved: "src/utils/logger.js" },
      { target: "ws", resolved: "ws", external: true }
    ],
    exports: ["executeSceneTake", "buildTakeOptions"],  // summary list
    routeCount: 0,                        // number of HTTP routes (for route files)
    wsEvents: []                          // WebSocket event names
  },
  children: [ /* function/class/constant nodes */ ]
}
```

### 3.3 Export/function extraction rules

Scan the AST for these patterns:

| Pattern | Kind | Example |
|---------|------|---------|
| `module.exports = function name(...)` | `function` | `module.exports = function stateManager(ctx)` |
| `module.exports = { key: function(...) }` | `function` per key | `module.exports = { start, stop, getState }` |
| `module.exports = { key: value }` where value is not a function | `constant` | `module.exports = { LAYER_RANGES }` |
| `exports.name = function(...)` | `function` | `exports.handleApi = async function(...)` |
| `exports.name = value` (non-function) | `constant` | `exports.DEFAULT_PORT = 4200` |
| `module.exports = class Name` | `class` | `module.exports = class AmcpClient` |
| Top-level `function name(...)` (named, not arrow) | `function` (only if exported or called by exports) | `function resolveClipPath(...)` |
| Top-level `const name = (...) => ...` or `async (...) => ...` | `function` (only if exported) | `const handleScenePost = async (req) => ...` |

For each extracted symbol:

```js
{
  id: "fn:src/engine/scene-take.js:executeSceneTake",
  label: "executeSceneTake(ctx, sceneId, options)",
  kind: "function",
  description: "/** JSDoc first sentence if present */",
  meta: {
    name: "executeSceneTake",
    line: 45,
    endLine: 128,
    params: ["ctx", "sceneId", "options"],
    async: true,
    exported: true,
    jsdoc: "Execute a scene take — PGM-only or LBG with A/B bank crossfade"
  }
}
```

### 3.4 HTTP route extraction

For files matching `routes-*.js`, scan for Express-style route patterns:

```js
// Patterns to match:
router.get('/api/scenes', handler)
router.post('/api/scenes/:id/take', handler)
ctx.router.delete('/api/device-view/edge/:id', handler)
// Also: method calls like .put, .patch, .options
```

Create route nodes:

```js
{
  id: "route:GET:/api/scenes",
  label: "GET /api/scenes",
  kind: "route",
  meta: {
    method: "GET",
    path: "/api/scenes",
    handler: "handleGetScenes",
    line: 42,
    file: "src/api/routes-scene.js"
  }
}
```

### 3.5 WebSocket event extraction

Scan for broadcast/emit patterns:

```js
// Patterns:
broadcast('state:update', data)
wsBroadcast('scene:take', payload)
ws.send(JSON.stringify({ type: 'media:catalog', ... }))
_wsBroadcast('replication:status', ...)
```

Create event nodes:

```js
{
  id: "ws:state:update",
  label: "ws: state:update",
  kind: "ws-event",
  meta: {
    name: "state:update",
    direction: "server→client",
    file: "src/state/state-manager.js",
    line: 156
  }
}
```

---

## 4. Import graph (cross-references)

### 4.1 Build pass

After all files are parsed, run a second pass to resolve imports:

1. For each file's `imports[]`, resolve `target` to an absolute path (using Node's module resolution logic: `./` relative, `../` parent, bare = `node_modules`).
2. Build a reverse map: `importedBy[resolvedPath] = [list of files that import it]`.
3. Attach `importedBy` to each file node's `meta`.

### 4.2 External dependency classification

Mark imports as:
- `internal: true` — resolves to a file within `src/` or `client/`
- `external: true` — resolves to `node_modules` (e.g., `ws`, `osc`, `xml2js`)
- `builtin: true` — Node built-in (e.g., `fs`, `path`, `http`, `child_process`)

---

## 5. `index.js` entry point scan

The server entry (`index.js`, 18699 bytes) must be scanned like any other file but is special — it's the root of the server module tree. Its extracted functions and require chains form the "top of the drill-down" for `app:highascg-server`.

Also scan: `src/module-registry.js` and `src/repo-paths.js` as top-level `src/` files.

---

## 6. Tasks

### Phase A: Module-level scan (Layer 2)

- [ ] **T1** Add `src/` directory walker to `generate-map-data.js`: list all subdirectories of `src/`, create one `kind: "module"` node per directory.
- [ ] **T2** Embed curated descriptions from §2 lookup table. Fall back to `"Source module: <dirname>"` for unknown dirs.
- [ ] **T3** For each module directory, list all `.js` files and create `kind: "file"` children with `meta.path`, `meta.lines`, `meta.bytes`.
- [ ] **T4** Inject the module tree under `app:highascg-server.children` in the map-data envelope.
- [ ] **T5** Scan `index.js`, `src/module-registry.js`, `src/repo-paths.js` as direct children of `app:highascg-server`.

### Phase B: AST extraction (Layer 4–5)

- [ ] **T6** Install `acorn` as devDependency (`npm install --save-dev acorn`).
- [ ] **T7** Implement `parseFile(filePath)` function: read file, parse with acorn, return AST.
- [ ] **T8** Implement `extractExports(ast, filePath)` — walk AST per §3.3 rules, return array of `{name, kind, line, endLine, params, async, jsdoc}`.
- [ ] **T9** Implement `extractImports(ast, filePath)` — find all `require()` calls and `import` declarations, return array of `{target, line}`.
- [ ] **T10** Implement `extractRoutes(ast, filePath)` — find `router.get/post/put/delete/patch` calls per §3.4, return route nodes.
- [ ] **T11** Implement `extractWsEvents(ast, filePath)` — find broadcast/emit patterns per §3.5, return event nodes.
- [ ] **T12** Implement `extractFileDescription(source)` — grab first `//` comment or `@fileoverview` JSDoc as the file description.
- [ ] **T13** Wire all extractors into the file scan: each file node gets `children` from exports + routes + ws-events, and `meta.imports` from the import extractor.
- [ ] **T14** Handle parse errors gracefully: if acorn fails on a file (syntax error, non-JS), log a warning and emit the file node with `meta.parseError: true` and no children.

### Phase C: Import graph (cross-references)

- [ ] **T15** Implement `resolveImport(target, fromFile, repoRoot)` — resolve `./` relative paths, classify as `internal`/`external`/`builtin`.
- [ ] **T16** After all files are parsed, run the second pass: build `importedBy` reverse map.
- [ ] **T17** Attach `meta.importedBy` to each file node (list of internal files that import it).
- [ ] **T18** Attach `meta.importCount` and `meta.importedByCount` summary numbers.

### Phase D: Validation & output

- [ ] **T19** Update `stats` in the envelope: recount total nodes, max depth, per-layer counts.
- [ ] **T20** Run on the actual codebase and verify: ≥500 file nodes, ≥2000 function nodes, ≥100 route nodes.
- [ ] **T21** Performance: the full scan must complete in < 10 seconds on the playout host.
- [ ] **T22** Log summary to stdout: modules scanned, files parsed, exports found, routes found, parse errors.

---

## 7. Edge cases & error handling

| Situation | Handling |
|-----------|----------|
| `.sync-conflict-*.js` files (Syncthing) | **Skip** — exclude files matching `*.sync-conflict-*` |
| `node_modules/` directories | **Skip** — never recurse into `node_modules/` |
| `.DS_Store`, other non-JS files | **Skip** — only process `*.js` files |
| Binary files in `lib/` (libcef.so, etc.) | **Skip** — `lib/` is not `src/`, should not be scanned |
| CommonJS `require()` vs ES `import` | Try `sourceType: 'module'` first, catch error, retry with `sourceType: 'script'` |
| Dynamic `require(variable)` | **Ignore** — only extract static string literals |
| Circular imports | **Allow** — the graph handles cycles; just record edges |
| Arrow functions not assigned to `module.exports` | **Skip** — only extract exported symbols to keep the map manageable |
| Large files (>1000 lines) | **Flag** in meta: `meta.large: true` |

---

## 8. Acceptance criteria

1. `npm run map:generate` produces `map-data.json` with all 26 `src/` modules as children of `app:highascg-server`.
2. Every `.js` file in `src/` (excluding sync-conflicts) has a `kind: "file"` node with accurate `lines` and `bytes`.
3. ≥90% of files have at least one extracted export (function, class, or constant).
4. `routes-*.js` files have `kind: "route"` children for each HTTP endpoint.
5. The import graph has `meta.imports` on every file and `meta.importedBy` where applicable.
6. Parse errors are logged but don't crash the generator.
7. Full scan completes in < 10 seconds.

---

## Work Log

### 2026-06-29 — Initial Creation
**Work Done:**
- Created detailed sub-order for server module scan with full directory inventory (26 modules, ~350 files).
- Specified AST extraction rules for exports, functions, routes, WebSocket events.
- Defined import graph cross-reference pass.
- 22 tasks across 4 phases.

**Instructions for Next Agent:**
- Ensure 83a is complete first (JSON schema + static layers).
- Start with Phase A (T1–T5): module-level directory walk, then Phase B (T6–T14): AST extraction.
- Use `acorn` — don't try to regex-parse JS files.
- Test with a single module first (e.g., `src/osc/` — only 4 files) before running full scan.

---
*Work Order created: 2026-06-29 | Parent: [WO-83](./83_WO_INTERACTIVE_PROJECT_MAP.md)*
