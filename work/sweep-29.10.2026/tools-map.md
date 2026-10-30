# tools/map — sweep 29.10.2026 (batch 117)

Files: 5 · lines: 977 · findings: 0 BUG-HIGH, 1 BUG, 1 DEAD, 1 RISK, 12 QUALITY

Scope notes: all five files read in full; `node --check` clean. Pure-function repros were run in the scratchpad (`parseJsFile` on sample files and on all 823 files under src/; no repo file written). The map is built only for GitHub Pages (`npm run build:map`, .github/workflows/pages.yml; WO-163), so the stale facts below are published on the public site. The committed client/assets/map-data.json (generated 2026-07-27) is older than the code and was used only as supporting evidence.

## tools/map/ast-scanner-metadata.js
- `QUALITY` tools/map/ast-scanner-metadata.js:1-28 — `MODULE_DESCRIPTIONS` has no entry for 11 current src/ modules (audio-desk, capture, cluster, fixtures, network, ptz, shaderfx, show-timers, stage, virtual-output, vr); they render as "Source module: <name>" (ast-scanner.js:62). Found by comparing `ls src` with the keys.

## tools/map/ast-scanner-parse.js
- `BUG` tools/map/ast-scanner-parse.js:151-159 — `acorn.parse(..., ecmaVersion: 2022)` has no `allowHashBang`, so any file starting with `#!` fails: index.js (the server entry, added by ast-scanner.js:76) gets `parseError: "Unexpected character '!' (1:1)"` and no imports/exports/ws events (reproduced with `parseJsFile('index.js')`; the committed map-data.json also lists `index.js` as the only parse error). Fix: `allowHashBang: true`.
- `QUALITY` tools/map/ast-scanner-parse.js:78-103 — `extractFileDescription` gives up at the first non-comment line, so `'use strict'` ahead of the JSDoc (the repo's normal header) yields an empty description: 625 of 823 src/ files get none (measured). A single-line `/** x */` header keeps a leading `* ` (reproduced: `"* Single line doc."`).
- `QUALITY` tools/map/ast-scanner-parse.js:228-262,295-319 — for the dominant `module.exports = { a, b }` form the shorthand values are Identifiers, so every export is kind `constant`, has no params, its line is the export object (not the declaration) and the JSDoc lookup reads above the export statement. Reproduced: `foo(a,b=1)`/`bar()` exported that way come out as `foo`/`bar` with empty descriptions. Default params print as `...` (`foo(a, ...)`).
- `QUALITY` tools/map/ast-scanner-parse.js:308-316 — jsdoc lookup for a declaration preceded by a plain `/* ... */` comment walks upward to the next `/**` anywhere above and reuses that text. Reproduced: `export function baz()` after `/* plain block comment */` got "Multi doc." from `bar`.
- `QUALITY` tools/map/ast-scanner-parse.js:114 — builtin list omits `net`, `dgram`, `zlib`, `url`, `readline`, `worker_threads`, `assert`, `buffer`, `tls`, `dns`, `fs/promises`...; they are tagged `external` (the committed map-data.json lists `dgram`, `net`, `worker_threads` as external packages).
- `QUALITY` tools/map/ast-scanner-parse.js:171-189 — in `routes-*` files every `x.get('literal')` / `.delete('literal')` counts as a route, so Map/Headers lookups appear as routes (committed data: a single route, "GET content-length"). With the current tree the scan finds 81 routes via `routes.get('/api/...')`, so the committed data is stale rather than the matcher dead.
- `QUALITY` tools/map/ast-scanner-parse.js:196-215 — `wsEvents` is de-duplicated but `children` gets a new `ws:<evt>` node (same id) for every call site (committed data: 8 nodes, 7 unique ids).
- `QUALITY` tools/map/ast-scanner-parse.js:239-263 — `export * from` (ExportAllDeclaration) and destructured `export const {a} = ...` are not handled (the latter pushes an `anon` export).
- `RISK` tools/map/ast-scanner-parse.js:106-111 — `resolveImport` appends `.js` and never tries `dir/index.js`; a directory require would be an unresolved import. None exist today (0 unresolved internal imports over all of src/, measured), so latent.

## tools/map/ast-scanner.js
- `QUALITY` tools/map/ast-scanner.js:232-248 — work-order cross-reference is a plain `content.includes(term)` of file label/name/path/basename (≥4 chars) against every WO body for every node: noisy (`index.js`, `state`, `name`...) and O(WOs × nodes × terms), which is why timing-test.js exists. It also does not skip DEPRECATED WOs, which CLAUDE.md says are not a source of truth.
- `QUALITY` tools/map/ast-scanner.js:251-255 — `node.meta.relatedWOs = woIndex[...]` replaces the hand-written lists in generate-map-data.js (arrays of strings like `["WO-35"]`) with arrays of `{wo,title,file}` whenever a term matches, so the curated data is silently discarded; a curated node that does not match keeps the string array, which client/components/map-explorer.js:972 renders as `undefined: undefined` (`v.wo`). In the current committed data every node is an object list, so the curated lists are dead data.

## tools/map/generate-map-data.js
- `QUALITY` tools/map/generate-map-data.js:17,138,182-188,257,261 — hard-coded facts that are wrong today and appear on the public Pages map: label "Ubuntu 24.04 LTS" (box runs 26.04), `svc:nginx` / `app:nginx` (nginx proxy removed, WO-498), `/opt/casparcg/...` paths (Caspar runs from ~/highascg/bin), "Node.js ≥20" (CI uses 24), "CasparCG Server 2.5". Fix: derive from the repo (package.json engines, os-release) or delete the stale nodes.
- `QUALITY` tools/map/generate-map-data.js:283-308 — see ast-scanner.js:251-255: the curated `relatedWOs` on lines 50,68,80,94,126-150,259-260 are overwritten by the cross-reference at 308.

## tools/map/timing-test.js
- `DEAD` tools/map/timing-test.js:1 — benchmark of the same three calls generate-map-data.js makes; not referenced. grep: `rg -n "timing-test" . --glob '!work/sweep*'` → only work/code-audit-raw.json and work/work-orders/273_WO_SCRIPTS_TOOLS_CLEANUP.md:212, which left it on purpose ("operator/QA diagnostics ... needs owner intent"); no package.json script, no CI. Owner decision.
