# Chapter 1: API Endpoints (REST & WebSocket)

HighAsCG is built around a robust HTTP/WebSocket API (`port 4200`) acting as a bridge to both the CasparCG renderer (via AMCP) and the Ubuntu OS. All routes are prefixed with `/api/`.

## 1. CasparCG Bridge Endpoints

The bridge handles routing commands directly to CasparCG when available. **Important**: If the server is started with the `--no-caspar` flag, or if CasparCG is unreachable, all AMCP routes return a `503 Service Unavailable` error:
```json
{ "error": "Caspar not connected" }
```

### `POST /api/play`
Fires a `PLAY` command to CasparCG.
**Payload:**
```json
{
  "channel": 1,
  "layer": 10,
  "clip": "AMB",
  "loop": true,
  "transition": "MIX",
  "duration": 25,
  "audioFilter": "volume=0.5",
  "audioRoute": "stereo_to_stereo"
}
```

### `POST /api/amcp/batch`
Sends chunked AMCP commands sequentially. Extremely useful for loading complex timelines.
**Payload:**
```json
{
  "commands": [
    "LOADBG 1-20 AMB",
    "PLAY 1-20"
  ]
}
```
If using raw batch (`POST /api/amcp/raw-batch`), HighAsCG warns in logs if you exceed 50 commands due to performance (PERF-D4). The hard limit is 4000 commands.

### `POST /api/raw`
Allows sending a direct, unparsed string to the AMCP socket.
**Payload:**
```json
{ "cmd": "INFO 1" }
```

---

## 2. Realtime State & WebSocket

The server listens to OSC state packets (typically on UDP port `6251`) sent by CasparCG and broadcasts deltas over WebSocket to all connected clients.

* **Connection**: `ws://<API_ORIGIN>/api/ws`
* **Periodic Broadcast**: Configured via `HIGHASCG_WS_BROADCAST_MS` (e.g. `100ms`).
* **Format**: Broadcasts use the `appCtx.oscState` object which aggregates the channel status, clip progress, and current playing media.
* **Structured Messages**: The UI can send structured JSON messages back over WS (e.g., `{ "type": "play", "channel": 1, "clip": "AMB" }`), which `dispatchStructuredAmcp` intercepts and converts into AMCP string commands.

---

## 3. Data & Project Management (`routes-data.js`)

Project configurations (looks, templates, sequences) are saved locally on the playout machine disk.

### `POST /api/project/save`
**Payload Schema:**
```json
{
  "project": {
    "name": "My Show",
    "savedAt": 1684345200000,
    "looks": [...]
  },
  "force": false
}
```
**Error Handling:** The endpoint validates timestamps to prevent stale overwrites. If a browser tries to send an older `savedAt` timestamp, the server responds with a `409 Conflict`:
```json
{
  "error": "Project save rejected: payload is older than the stored project",
  "reason": "older_timestamp"
}
```

### `GET /api/scene/live`
Fetches the active running channels and their layers.
**Response:**
```json
{
  "channels": [...],
  "programLayerBankByChannel": {}
}
```
