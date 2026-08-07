# Chapter 4: Testing & Smoke Scripts

HighAsCG maintains extensive offline and integration test suites in `tools/smoke/`.

## 1. AMCP API Offline Parity Tests
File: `tools/smoke/highascg-health-api-amcp.test.js`

This test suite uses the Node.js native `--test` runner to simulate CasparCG AMCP packet dispatch entirely offline, proving that the HTTP/WebSocket routers construct exact AMCP commands.

**Mechanics:**
* The router uses `makeAppCtx(amcp)` injected with a simulated AMCP Client (`makeOfflineAmcp`).
* The `captureAmcp` helper wraps `sim.send` to capture all AMCP protocol strings pushed into the socket buffer.
* Examples tested:
  * `POST /api/ping` verifies generation of `PING highascg-health\r\n`.
  * `POST /api/amcp/batch` with `{ amcp_batch: false }` verifies that sequential mode correctly breaks apart chunks.
  * Structured WebSockets (e.g., `{ type: "mixer", command: "opacity", channel: 1, opacity: 0.42 }`) are verified to emit `MIXER 1-10 OPACITY 0.42`.

**Integration Mode**:
This file can also ping a real running HTTP server:
```bash
HIGHASCG_INTEGRATION_PORT=8099 HIGHASCG_EXPECT_CASPAR=1 node --test tools/smoke/highascg-health-api-amcp.test.js
```
If `HIGHASCG_EXPECT_CASPAR=1` is passed, it strictly asserts that `GET /api/state` returns HTTP `200` and `scene.deck` shapes exist. Otherwise, it tolerates `503` (offline).

## 2. Mixer effects catalog smoke (WO-74)

File: `tools/smoke/smoke-mixer-effects-catalog.test.js`

Offline parity for all **13** Sources browser mixer effects — client params → AMCP line builders → REST `/api/mixer/*`:

```bash
npm run smoke:mixer-effects
```

Cases covered:
- Effect catalog completeness (`effect-registry.js`)
- Client `effectToAmcpLines` vs server look-take + timeline playback builders
- REST `POST /api/mixer/{command}` and `POST /api/mixer/effect` AMCP capture
- Primary/advanced schema partition per effect type

## 3. CasparCG Live Smoke Script
File: `tools/smoke/smoke-caspar.js`

A fast bash/Node script to quickly verify HTTP routing when a real CasparCG instance is attached. 

**Execution:**
```bash
node tools/smoke/smoke-caspar.js 4200
```
**Assertions:**
1. `GET /api/state` strictly returns `200` (exits code `1` if `503` is encountered, meaning Caspar is down).
2. `GET /api/__smoke_not_a_route__` must return `404` (proving unknown routes aren't swallowed by 503 error handlers).
3. `POST /api/raw` with `{ "cmd": "VERSION" }` succeeds and returns a JSON wrapper containing AMCP data.

## 4. Project volume sync tests
File: `tools/smoke/smoke-project-volume-sync.test.js`

Offline unit tests for catalog merge logic in `src/engine/project-volume-sync.js`:

```bash
node --test tools/smoke/smoke-project-volume-sync.test.js
```

Cases covered:
- USB catalog wins on equal `savedAt` when stick is mounted
- Newest `savedAt` wins across bridge/local sources

Related: `tools/smoke/smoke-exfat-sync.js` asserts repo `config/exfat-sync.json` includes `usb-projects` and `bridge-projects` pair ids.
