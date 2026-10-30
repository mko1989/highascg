# Smoke and integration tests

All backend verification scripts in one place. Run from repo root via `package.json` scripts (`npm run smoke`, `npm run test:device-graph`, etc.).

| Kind | Examples |
|------|----------|
| HTTP + WS (live box) | moved to `tools/test-live/` (WO-836): `http-smoke.js`, `smoke-caspar.js` — `npm run test:live` |
| Unit (`node --test`) | `smoke-device-graph.js`, `smoke-exfat-sync.js`, `highascg-health-api-amcp.test.js` |
| Previs (client libs) | `smoke-previs-*.mjs` |
| Fixtures | `fixtures/` (lsblk samples) |

Everything here is OFFLINE: no real Caspar/API/LAN, no writes into the box's `config/`, `data/`, `projects/`, `template/`.
Tests that act on the live box live in `tools/test-live/` behind `HIGHASCG_LIVE_TESTS=1`; `npm run test:release` runs offline + live + GUI e2e.

Not shipped on minimal server tarballs or closed ISO squashfs.
