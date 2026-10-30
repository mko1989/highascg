# test/api — sweep 29.10.2026 (batch 107)

Files: 1 · lines: 90 · findings: 0 BUG-HIGH, 0 BUG, 0 DEAD, 0 RISK, 2 QUALITY

Wiring check: `tools/ci/offline-test-files.js:486` lists it (curated CI, ci.yml → `npm run test:ci`). Ran it: `node --test test/api/routes-media-thumb.test.js` → 3 tests, 3 pass.

## test/api/routes-media-thumb.test.js
- `QUALITY` test/api/routes-media-thumb.test.js:1-3,13-22,85-90 — the file is named for the route and its header promises "zero-byte and recently-modified files are handled correctly", but it tests only the cache helpers of `src/media/local-media-ffmpeg.js` (`readThumbnailCacheFile`, `cleanupZeroByteThumbnails`); the route guard it is named after (`src/api/routes-media.js:40-50,119`, the `mtime < 500 ms` / size check) has no test, and there is no "recently-modified" case at all. `createMockContext` (:13) is never called, and the `require.main === module` block (:86-90) just `require`s the file itself.
- `QUALITY` test/api/routes-media-thumb.test.js:24-82 — the three cases are the same three as test/wo-184-smoke-tests.js tests 1, 2, 4 (an orphan copy, see test.md); keep this one, delete the other.
