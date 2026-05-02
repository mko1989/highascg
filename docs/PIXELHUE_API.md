# PixelHue / Unico HTTP / WebSocket API (Companion + PixelFlow OpenAPI V2.0.1)

This document combines:

1. **Authoritative path list** — **PixelFlow OpenAPI Manual V2.0.1** (NovaStar), PDF at `work/PixelFlow-OpenAPI Manual-V2.0.1.pdf` — supported devices: **P10, P20, Q8, P80** (per release notes; Companion also uses a **PF** model profile on virtual devices).
2. **Request bodies and working usage** — **PixelHue** Companion module in this repo: `companion-module-pixelhue-switcher-main 2/` (`src/services/ApiClient.ts`, `src/config/devices/*.ts`).

> **Caveats**  
> - **Base URL** in the manual: `http://{ip}:8088/unico` + *function path* (example port); on real gear the **HTTP API port** comes from discovery (`device-list` → `protocols` with `linkType: 'http'`), not necessarily `8088`.  
> - **Unico** control plane uses **port 19998** (HTTPS) for discovery and WebSocket. **REST** for mixing uses `http://{host}:{apiPort}`.  
> - Bodies in this doc reflect the **TypeScript** module; the PDF has fuller field tables. Use the PDF for edge-case parameters.  
> - Use **self-signed** TLS on discovery as the module does: `rejectUnauthorized: false` on HTTPS.

---

## 1. Transports and ports

| Channel | Base URL | Purpose |
|--------|----------|--------|
| **Discovery** (Companion) | `https://{host}:19998` | `GET /unico/v1/ucenter/device-list` — list devices (SN, model, `protocols` with ports). *Not* listed as a `Path` line in the PixelFlow PDF; it is the Unico/ucenter discovery the module uses. |
| **Node open detail** (HTTP API) | `http://{host}:{apiPort}` | `GET /unico/v1/node/open-detail` — **sn** + **startTime** for JWT. |
| **REST (mixing)** | `http://{host}:{apiPort}` | `http://{host}:{apiPort}/unico/v1/...` with `Authorization: {token}`. |
| **WebSocket** (Companion) | `wss://{host}:19998/unico/v1/ucenter/ws?client-type=8` | TLV-framed events; `Authorization: {token}`. |

`HttpClient` in the module sends paths **not** starting with `/ucenter` to `http://{host}:{apiPort}`; paths like `/ucenter/...` go to `https://{host}:{unicoPort}` (see `ApiClient` / `HttpClient`).

---

## 2. Authentication

The **PixelFlow manual** documents two ways to obtain a token; the **Companion module uses only the second**.

### 2.1 User login (PDF §1.1) — *not* used by the Companion

| Method | Path |
|--------|------|
| POST | `/unico/v1/system/auth/login` |

- Body: `username`, `password` (JSON).  
- Returns a `data.token` suitable for `Authorization: {token}` on subsequent calls.

### 2.2 Open detail + HS256 JWT (PDF §1.2 + Companion) — *used by the module*

1. `GET /unico/v1/node/open-detail` on the **device HTTP** port (optional `nodeId` query in the manual).  
2. Read `data.sn` and `data.startTime` (manual: startup time, ms, used as shared secret in Companion).  
3. Build a **JWT** (HS256, **no `iat`**) and send as `Authorization: {token}` on authed requests and on WSS (Companion).

```ts
// companion: src/utils/utils.ts
token = jwt.sign({ SN: serialNumber }, startTime, { algorithm: 'HS256', noTimestamp: true })
```

4. `GET /unico/v1/node/detail` (PDF §2.1) — full node information with `Authorization`; Companion does not call this in `ApiClient` setup, but it is the official “node detail” read when you need working mode, etc.

---

## 3. PixelFlow V2.0.1 — official `Path` index (from the manual)

All paths are prefixed with **`/unico`**; the relative part in the PDF is `/v1/...`, so the full path is **`/unico/v1/...`**.

| Method | Path (full) | Notes |
|--------|-------------|--------|
| POST | `/unico/v1/system/auth/login` | See §2.1. |
| GET | `/unico/v1/node/open-detail` | Public node info; feeds JWT in Companion. |
| GET | `/unico/v1/node/detail` | Authed node information. |
| PUT | `/unico/v1/system/restore-factory` | Factory reset. |
| PUT | `/unico/v1/screen/global/switch-effect` | Global transition effect. |
| PUT | `/unico/v1/screen/global/swap` | Global swap. |
| GET | `/unico/v1/node/state-info` | Monitoring / state. |
| GET | `/unico/v1/interface/list-detail` | Connectors / inputs. |
| PUT | `/unico/v1/node/interface-location` | Interface placement. |
| PUT | `/unico/v1/interface/image-quality` | Image quality. |
| **Screen API v1 (legacy, PDF §4.1)** | | *Global* selected-screen behaviour. |
| PUT | `/unico/v1/screen/selected/ftb` | Global FTB (`ftb.enable`, `ftb.time`). |
| PUT | `/unico/v1/screen/selected/freeze` | Global freeze (`freeze` 0/1). |
| **Screen API (shared + v2 per-screen, PDF §4.1.3+ / §4.2)** | | |
| PUT | `/unico/v1/screen/take` | Take (PVW→PGM / PGM→PVW per `direction`). |
| PUT | `/unico/v1/screen/cut` | Cut. |
| GET | `/unico/v1/screen/list-detail` | Screen list. |
| **Screen API v2 (PDF §4.2 )** | | *Per-screen* arrays (Companion uses this style). |
| PUT | `/unico/v1/screen/freeze` | Per-screen freeze. |
| PUT | `/unico/v1/screen/ftb` | Per-screen FTB. |
| **Layer (PDF §5)** | | |
| GET | `/unico/v1/layers/list-detail` | Layers; supports query `limit`, `page`, `layerId`, etc. |
| GET | `/unico/v1/layers/template` | Layer *templates* (`moduleType`, `templateId` query). |
| PUT | `/unico/v1/layers/template/select` | Apply template selection. |
| PUT | `/unico/v1/layers/source` | Set layer source. |
| PUT | `/unico/v1/layers/select` | **Layer select** — array of objects with `layerId` and `selected` (0/1). |
| **Preset (PDF §6; v1 vs v2 chapters)** | | |
| PUT | `/unico/v1/preset/general` | Edit preset (v1-style). |
| PUT | `/unico/v1/preset/create-assign` | Create / assign. |
| PUT | `/unico/v1/preset/play` | Play. |
| GET | `/unico/v1/preset` | List / detail (Companion: list for show presets). |
| POST | `/unico/v1/preset/create` | Create preset. |
| POST | `/unico/v1/preset/apply` | **Load** preset to region (used by Companion). |
| POST | `/unico/v1/preset/update-name` | Rename. |
| POST | `/unico/v1/preset/delete` | Delete. |
| **Gallery (PDF §7)** | | |
| GET | `/unico/v1/picture/list` | Image gallery list. |

---

## 4. Companion vs manual — renames, aliases, and extra endpoints

| Topic | PixelFlow V2.0.1 (manual) | PixelHue Companion (`PF.ts` and siblings) |
|--------|---------------------------|---------------------------------------------|
| **Layer selection** | `PUT /unico/v1/layers/select` (§5.5) | `PUT /unico/v1/screen/select` — **same** `{ layerId, selected }` pattern; all models use `screen/select`. If a new client follows the manual strictly, use `layers/select` first; fall back to `screen/select` if the device was tuned for the Companion path. |
| **Layer “style” / looks** | `GET /unico/v1/layers/template`, `PUT /unico/v1/layers/template/select` | `GET /unico/v1/layers/layer-preset/list-detail`, `PUT /unico/v1/layers/layer-preset/apply` — **different path names**; same product idea (per-layer look). Use what your firmware exposes. |
| **Layer geometry / PIP** | *Not* in the PDF’s `Path` list | `PUT /unico/v1/layers/window` |
| **Z-order** | *Not* in the PDF’s `Path` list | `PUT /unico/v1/layers/zorder` |
| **UMD / metadata** | *Not* in the PDF’s `Path` list | `PUT /unico/v1/layers/umd` |
| **Source backup** | *Not* in the PDF’s `Path` list | `GET` / `PUT` `/unico/v1/system/ctrl/source-backup` (key `crtl` in `MachineConfig` is a typo in TS). |

These **extra** `layers/*` and `system/ctrl/*` routes are used by the shipping module; treat them as **PixelHue firmware extensions** on top of the published PixelFlow list until NovaStar documents them in a newer manual.

### Example endpoint map (model **PF**) — module paths

| Area | Method | Path | Role |
|------|--------|------|------|
| **Screens** | GET | `/unico/v1/screen/list-detail` | List screens. |
| | PUT | `/unico/v1/screen/take` / `…/cut` / `…/ftb` / `…/freeze` | v2 per-screen style bodies. |
| | PUT | `/unico/v1/screen/select` | Layer select (see alias table). |
| **Show presets** | GET | `/unico/v1/preset` | List presets. |
| | POST | `/unico/v1/preset/apply` | Load preset. |
| **Layers** | GET | `/unico/v1/layers/list-detail` | All layers. |
| | PUT | `…/source`, `…/window`, `…/zorder`, `…/umd` | See §4. |
| | GET / PUT | `…/layer-preset/list-detail`, `…/layer-preset/apply` | PH layer style. |
| **Inputs** | GET | `/unico/v1/interface/list-detail` | Interfaces. |
| **System** | GET / PUT | `/unico/v1/system/ctrl/source-backup` | Backup. |

---

## 5. Preset load target region (`LoadIn`)

From `src/interfaces/Preset.ts`:

| Constant | Value | Meaning (module comments) |
|----------|--------|-----------------------------|
| `LoadIn.preview` | **4** | **Preview (PVW)**. |
| `LoadIn.program` | **2** | **Program (PGM)**. |

**`POST` `/unico/v1/preset/apply`** (example from `ApiClient.loadPreset`):

```json
{
  "auxiliary": {
    "keyFrame": { "enable": 1 },
    "switchEffect": { "type": 1, "time": 500 },
    "swapEnable": 1,
    "effect": { "enable": 1 }
  },
  "serial": 1,
  "targetRegion": 4,
  "presetId": "<preset-guid>"
}
```

- `targetRegion`: `4` = preview; `2` = program (per `LoadIn`).

---

## 6. Take (preview → program)

**`PUT` `/unico/v1/screen/take`**

Body: **array, one object per screen** (`ApiClient.take`). The **manual** documents `screenId` / `screenName`, `effectSelect` (0 = default, 1 = custom effect), `direction` (0 = PVW→PGM, 1 = PVW from PGM), `switchEffect` (`type` 0 = CUT, 1 = FADE; `time` in ms), and `swapEnable` where applicable.

```json
[
  {
    "direction": 0,
    "effectSelect": 0,
    "screenGuid": "<guid>",
    "screenId": 1,
    "screenName": "Screen A",
    "swapEnable": 1,
    "switchEffect": { "type": 1, "time": 500 }
  }
]
```

**`PUT` `/unico/v1/screen/cut`**: array with `direction`, `screenId`, `swapEnable` (Companion).

---

## 7. Layer operations (Companion + manual alignment)

- **Select layer (official name)** — `PUT` `/unico/v1/layers/select` (manual §5.5). **Companion** calls `PUT` `/unico/v1/screen/select` with the same selection semantics.  
- **Z-order** — `PUT` `/unico/v1/layers/zorder`: `[{ "layerId", "zorder": { "type": 1, "para": <to> } }]` (module; not a named `Path` in V2.0.1).  
- **Layer bounds** — `PUT` `/unico/v1/layers/window`.  
- **Set input** — `PUT` `/unico/v1/layers/source`.  
- **Layer style** — `PUT` `/unico/v1/layers/layer-preset/apply` in the module; manual lists **template** APIs under `GET/PUT` `/unico/v1/layers/template` (+ `…/template/select`).

> **Name collision:** “Layer preset” on PixelHue is a **per-layer style template**, not HighAsCG’s **look preset** (whole scene). In the UI, call them **PH layer style** vs **look preset**.

---

## 8. WebSocket (event stream)

- **URL:** `wss://{host}:19998/unico/v1/ucenter/ws?client-type=8`  
- **Header:** `Authorization: {token}`  
- **Payload:** **TLV** binary: JSON header in first TLV, then tag + JSON body (`WebSocketClient.parseTLVBuffer`).  
- **Dispatch:** `webSocketHandlers[tag]` in `WebSocketHandling` (`src/services/WebSocketHandling.ts`).

HighAsCG can start with **HTTP polling**; WS is for low-latency mirroring and Companion feedbacks.

---

## 9. Reference files

| File | Content |
|------|--------|
| `work/PixelFlow-OpenAPI Manual-V2.0.1.pdf` | Official paths, methods, and field tables. |
| `src/services/ApiClient.ts` | HTTP methods and bodies. |
| `src/services/HttpClient.ts` | HTTP vs HTTPS base selection. |
| `src/services/WebSocketClient.ts` | WSS URL, TLV parsing. |
| `src/config/devices/PF.ts` (etc.) | Per-model path constants. |
| `src/interfaces/*.ts` | DTOs. |
| `PRESET-AUTO-TAKE/api-reference.md` | Preset-apply + take. |

---

## 10. Security note for HighAsCG

- Prefer a **server-side** proxy: Node holds **host, ports, and token**; the browser only calls **`/api/pixelhue/...`**.  
- **Never** embed `open-detail` material or long-lived tokens in the static web bundle.  
- Keep control traffic on **LAN** or VPN; the module disables TLS verification for self-signed ucenter on discovery.

This document is the technical baseline for HighAsCG PixelHue / PixelFlow integration.
