# tools/ci — sweep 29.10.2026 (batch 110)

Files: 13 · lines: 1625 · findings: 0 BUG-HIGH, 3 BUG, 2 DEAD, 5 RISK, 11 QUALITY

Gates run on this tree: `check-max-file-lines` 0 violations (rc 0), `check-dom-escape-duplicates` OK, `check-tdz-reads` OK, `check-unwired-exports` OK (622 baseline entries == `count`, none resolved), `check-require-integrity` FAILS locally (see its section), `check-script-paths` FAILS (see its section). CI wiring (`.github/workflows/ci.yml`): repo-integrity, 500-line limit, unwired exports, `npm run test:ci` (which runs dom-escape + tdz first, `run-offline-tests.js:20`), npm audit. `check-script-paths` is in no workflow and not in `scripts/ci/run-local-ci.sh`.

## tools/ci/check-dom-escape-duplicates.js
- `QUALITY` tools/ci/check-dom-escape-duplicates.js:29 — the gate only matches the text `function escapeHtml(`. A copy written as `const escapeHtml = (s) => …` or `export const escapeHtml = …` is invisible, and `walk()` (:17) skips every directory named `tools` under client/. No counter-example exists today (`rg -n "(const|let|var)\s+escape(Html|HTML)\s*=" client` → none), so latent. Duplicates outside client/ (src/cg-studio/export-template.js:90, src/cg-studio/public/app.js:246) are out of scope by design.
- `QUALITY` tools/ci/check-dom-escape-duplicates.js:1 — not its own CI step; it only runs as a pre-check inside `run-offline-tests.js:20` (so `npm run test:ci`, not `test:ci:full`).

## tools/ci/check-max-file-lines.js
- `QUALITY` tools/ci/check-max-file-lines.js:11 — the extension list is `.js .css .html .sh .gd .cpp .h`; `.py .mjs .cjs .ts` and the roots `test/` and root `index.js` (ROOTS :9) are never counted. `tools/runtime/confine-pointer-barriers.py` is 516 lines and passes. Verified in a scratch tree: a 501-line `.js` is reported (exit 1), a 600-line `.mjs` and `.py` are ignored. The two EXEMPT entries still exist and are still over the limit (map-explorer.js 1059, map-explorer.css 800), so that list is not stale. Wired: ci.yml "File size limit", run-local-ci.sh.

## tools/ci/check-require-integrity.js
- `RISK` tools/ci/check-require-integrity.js:43 — `findSyncConflicts()` walks the whole repo root including gitignored runtime dirs. Run here: `[check-require-integrity] FAILED … found 11 sync-conflict file(s)` (all under `projects/` and `projects/_autosave/`, ignored by `.gitignore:18`, none tracked: `git ls-files | grep -c sync-conflict` → 0). So `npm run verify:repo-integrity` and `scripts/ci/run-local-ci.sh` are red on this box while a clean-clone CI run is green (the "CI red is never assumed local" trap, in reverse). Fix: scan `git ls-files` or skip `projects/`, `config/`, `work/`.
- `QUALITY` tools/ci/check-require-integrity.js:79 — `stripJsComments` removes `//.*$` even inside strings. Failing case: a line `const u = 'http://x'; const y = require('./nope')` → the require is cut off → gate prints OK, exit 0 (verified in a scratch tree; the same require alone on a line is caught). Fix: tokenise with acorn (already a devDependency) or only strip when the `//` is at line start / after whitespace.
- `QUALITY` tools/ci/check-require-integrity.js:6 — header says "relative require() from src/client/index.js"; the code scans every `.js` under src/, client/, tools/ plus index.js.

## tools/ci/check-script-paths.js
- `BUG` tools/ci/check-script-paths.js:44 — the gate fails on the current tree: `✗ Missing 1 referenced script path(s): tools/runtime/operator-shape-overlay.py` (exit 1, verified). That file does not exist; the path appears only in comments (src/system/operator-gui-channel-geometry.js:109, src/system/operator-monitor-picker.js:26, src/config/config-generator-operator-gui.js:53 and :94, src/utils/x-display-session-layout.js:42, src/utils/x-display-session-gui-windows.js:147). The grep takes comment text as a reference. Fix: strip comments before matching (or drop the stale comments), then wire it into ci.yml.
- `DEAD` tools/ci/check-script-paths.js:19 `PATTERNS` — array of four regexes, never read; `findScriptReferences()` repeats its own inline regexes. grep: `rg -n "PATTERNS" tools/ci/check-script-paths.js` → only the definition.
- `QUALITY` tools/ci/check-script-paths.js:1 — wired only as `package.json:22` `verify:script-paths` and documented in scripts/README.md:244,315. Because it is red it cannot simply be added to CI; nobody notices the rot (the README promises "After any move run `npm run verify:script-paths`").

## tools/ci/check-tdz-reads.js
- `BUG` tools/ci/check-tdz-reads.js:107 — `isRead()` treats class-member keys and catch parameters as reads. Failing inputs (run through `scanFile` in scratch): `class A { render() {} }\nconst render = 1` → `{line:1,name:'render'}`; `try { x() } catch (err) { console.log(err) }\nconst err = 3` → two hits on `err`. Neither is a TDZ access, but the gate would turn `test:ci` red. Latent: client/ has no such shape today (gate prints no hits). Fix: skip non-computed `MethodDefinition`/`PropertyDefinition` keys and give `CatchClause` its own scope.
- `QUALITY` tools/ci/check-tdz-reads.js:79 — only `Program`/`BlockStatement` bodies register declarations; `SwitchCase` consequents are not scanned, so `switch (k) { case 1: use(y); const y = 2 }` is missed (verified: no hit), and `for (let …)` heads register nothing. A real straight-line read in a plain block is caught (verified).
- `RISK` tools/ci/check-tdz-reads.js:138 — a file acorn cannot parse is only `console.warn`ed and skipped; the gate stays green and there is no count of skipped files. Wired: `run-offline-tests.js:20` and `smoke-wo383-tdz-gate.test.js` (curated list).

## tools/ci/check-unwired-exports.js
- `BUG` tools/ci/check-unwired-exports.js:42 — `REFERENCE_ROOTS` omits the root `index.js` (and `test/`, `godot/`). Failing case (scratch tree via `findOrphans({root})`): `src/foo.js` exporting `startFoo` in a multi-line `module.exports = {…}`, called only from `index.js` → reported as orphan `src/foo.js: startFoo` → exit 1 although it is wired. The committed baseline already carries such false entries: 13 baseline names are used from `index.js` (e.g. `src/replication/replication-service.js: startReplicationService` → index.js:319, `src/bootstrap/caspar-amcp-watchdog.js: startCasparAmcpWatchdog` → index.js:361, `src/media/usb-drives.js: startUsbHotplugWatcher`, `src/network/tailscale-service.js: maybeAutoLoginOnBoot`) and 8 are only referenced from `test/`. Fix: add `'index.js'` and `'test'` to REFERENCE_ROOTS, then `--update` to shrink the baseline by about 21.
- `RISK` tools/ci/check-unwired-exports.js:81 — the CommonJS branch needs a multi-line block: `module.exports = { a, b }` on one line yields zero names (verified: `exportedNames` → `Set(0)`), and the lazy `[\s\S]*?\n\s*\}` stops at the first nested closing brace. `rg -l "^module\.exports = \{.+\}\s*$" src -g '*.js'` → 413 files, so most of src/ exports are never gated; the "1318 files scanned" line overstates coverage.

## tools/ci/collect-offline-tests.js
- `QUALITY` tools/ci/collect-offline-tests.js:19 — `/^smoke-caspar/i` is broader than its reason (live Caspar). It also drops `tools/smoke/smoke-caspar-cls-id.test.js`, a pure unit test (requires only `src/media/caspar-cls-id`). `rg -n "smoke-caspar-cls-id" tools/ci package.json` → no hit: it runs in neither the full collector nor the curated list.
- `QUALITY` tools/ci/collect-offline-tests.js:29 — `/^smoke-project-fps-network/i` excludes a file that the curated list does run (offline-test-files.js:26), and `smoke-caspar-amcp-watchdog.js` (curated, offline-test-files.js:421) also matches `^smoke-caspar`. So `test:ci:full` is not a superset of `test:ci`. Measured: 670 collector-eligible test files, 139 not in the curated list (by design), 8 curated entries are not collector-visible (7 non-`.test.` names plus the excluded fps-network file). All 24 exclude regexes match an existing file (no stale excludes).

## tools/ci/npm-audit-ci.js
- `RISK` tools/ci/npm-audit-ci.js:12 — fails open. When the registry is unreachable or the audit endpoint errors, `npm audit --json` prints `{"error":{…}}` and exits 1; the catch (:15) parses `e.stdout`, `payload.vulnerabilities` is undefined → `[npm-audit-ci] OK (no blocking high/critical advisories)`, exit 0. Verified with a fake `npm` on PATH printing that JSON. (Non-JSON stdout throws an uncaught SyntaxError, which is at least loud.) Fix: `if (payload.error) { console.error(...); process.exit(1) }`.

## tools/ci/offline-test-files-2.js
- `OK`

## tools/ci/offline-test-files.js
- `OK`

## tools/ci/run-offline-tests-full.js
- `QUALITY` tools/ci/run-offline-tests-full.js:9 — does not run the two static gates (`check-dom-escape-duplicates`, `check-tdz-reads`) that `run-offline-tests.js:20` runs first, so "full" is weaker than "curated" on those.

## tools/ci/run-offline-tests.js
- `OK`

## tools/ci/write-repo-default-config.js
- `RISK` tools/ci/write-repo-default-config.js:94 — `writeModularConfig` overwrites 21 `config/*.json` slices (security, replication, caspar, server, plugins, companion, …) with factory values and has no guard against being run on a configured box. On this machine `config/` is live runtime state; `npm run config:write-defaults` (package.json:20, README.md:192) would reset auth and replication settings. Fix: require an explicit `--force`/`HIGHASCG_SANDBOX`, or write to an `--out` dir.
- `QUALITY` tools/ci/write-repo-default-config.js:124 — `MACHINE_LOCAL_JSON` only filters the printed "written" list; none of its names is in MODULAR_KEYS, so it protects nothing, and the comment "never overwrite or commit" is wrong for `config/exfat-sync.json`, which IS tracked (`git ls-files config` lists it). The "OK — N file(s)" count counts files that exist, not files written.
- `DEAD` tools/ci/write-repo-default-config.js:133 `module.exports` (`REPO_DEFAULT_CONFIG_FILES`, `MACHINE_LOCAL_JSON`, `writeModularConfig`) — no importer. grep: `rg -n "writeModularConfig|REPO_DEFAULT_CONFIG_FILES|MACHINE_LOCAL_JSON" --glob '!node_modules' --glob '!work/**' .` → only the definition file, a comment in tools/eggs/live-usb/seed-stick-drop-update-from-host.sh:69 and an unrelated `writeModularConfigs` in tools/eggs/live-usb/write-exfat-starter-bundle.js. Documented use: package.json:20 runs it as a CLI.
