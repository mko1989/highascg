# Smoke and integration tests

All backend verification scripts in one place. Run from repo root via `package.json` scripts (`npm run smoke`, `npm run test:device-graph`, etc.).

| Kind | Examples |
|------|----------|
| HTTP + WS | `http-smoke.js`, `smoke-caspar.js` |
| Unit (`node --test`) | `smoke-device-graph.js`, `smoke-exfat-sync.js`, `highascg-health-api-amcp.test.js` |
| Previs (client libs) | `smoke-previs-*.mjs` |
| Fixtures | `fixtures/` (lsblk samples) |

Not shipped on minimal server tarballs or closed ISO squashfs.
