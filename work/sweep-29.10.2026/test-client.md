# test/client — sweep 29.10.2026 (batch 108)

Files: 1 · lines: 67 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 0 RISK, 2 QUALITY

Wiring check: not in `tools/ci/offline-test-files.js`/`-2.js`, not in package.json, not in ci.yml. `tools/ci/collect-offline-tests.js` scans `test/` for `*.test.js`, so only `npm run test:ci:full` (manual, slow; ci.yml runs `test:ci`) would pick it up. Ran it: `node --test test/client/thumbnail-error-handler.test.js` → 1 test, 1 pass.

## test/client/thumbnail-error-handler.test.js
- `QUALITY` test/client/thumbnail-error-handler.test.js:25-35 — asserts nothing about the code under test: it builds a local `new Set()`, adds a URL, and asserts `Set.has` returns true / false. `client/lib/thumbnail-error-handler.js` (`handleThumbnailError`, an ES module with `export`) is never imported; the file's own comment admits "simplified". The mocked `document`/`window`/`URL` globals (:4-17) are never used. It cannot fail when the retry logic breaks (retry-once, `_retry` cache-bust, fallback HTML). Either import the module via dynamic `import()` with a stub `img` (the pattern test/wo-238 uses) or delete it.
- `QUALITY` test/client/thumbnail-error-handler.test.js:46-54 — not in the curated CI list (CLAUDE.md: new tests must be added), so nothing in CI runs it; it also passes under `node --test` only because the file executes its body when `require.main === module` is true in the child process.
