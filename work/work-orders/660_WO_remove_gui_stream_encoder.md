# WO-660 — Remove the WO-319 GUI live stream (NVENC → WebCodecs) from the server

**Status: DONE (2026-10-21, offline suite 2710/0, gates clean; box: node restarted, `/api/gui-stream/status` 404)**

Follow-up of [WO-646](./646_WO_kiosk_decommission.md) stage C (owner 21.10: the web UI keeps "the compose preview
with only the hq thumbnails"). Supersedes the server half of WO-319's Live preview stream.

## Investigation

- The web overlay that decoded the stream lived inside the kiosk compose tiles and went with WO-646 stage C
  (`preview-canvas-live-stream.js`, `gui-stream-client.js`, the Settings "Live stream" option). The Godot GUI never
  used it (it reads the operator channel from shm, `opgui`): `rg gui-stream godot/client` is empty.
- Server side was still wired: `index.js` → `src/bootstrap/operator-gui-stream.js` (ingest + `/ws/gui-stream` relay),
  `GET /api/gui-stream/status` (`router.js`), the Caspar-reconnect refresh (`index.js`) and the shutdown hook.
  Before removal on the box: `{"enabled":true,"channel":3,"running":false,"watching":0}` — idle, no consumer.
- `composePreview.mode: 'stream'` was persisted as-is by `normalizeComposePreviewSettings`.

## What was done

- Deleted: `src/bootstrap/operator-gui-stream.js`, `src/api/routes-gui-stream.js`, `src/preview/gui-stream-ingest.js`,
  `-ws-relay.js`, `-nvenc-args.js`, `-gop-buffer.js`, `h264-annexb-au-splitter.js`,
  `tools/runtime/gui-stream-standalone-test.js`, and their five wo319 smokes (dropped from the curated list).
- Unwired in `index.js` (setup + reconnect refresh), `bootstrap/shutdown.js`, `api/router.js`; the API contract
  regenerated (459 routes).
- `compose-preview-mode.js`: a saved `'stream'` now normalizes to `'canvas'` (smoke-compose-preview-dirty updated).
- wo418 smoke lost its gui-stream-ingest pin; stale comments fixed (https proxy, operator-GUI config generator,
  screen-destinations). The generated config's XML comment ("HEADLESS (stream-only …)") is left as-is so the
  Caspar config compare shows no diff.
- Unwired-exports baseline rewritten (634).

## What was VERIFIED

- `npm run -s test:ci`: 2712 tests, 2710 pass, 0 fail, 2 skipped. Lint, format:check, max-file-lines,
  unwired-exports clean.
- Box: node restarted (up in 8 s, no new errors in the journal); `GET /api/gui-stream/status` → 404,
  `/api/operator-gui/layout` → 200, `composePreview.mode` = `canvas`.

## Not done

- Dead kiosk fields `guiUrl` / `autoLaunch` are still normalized in `screen-destinations.js` and
  `device-view-crud.js` (saved configs round-trip); no reader remains.
