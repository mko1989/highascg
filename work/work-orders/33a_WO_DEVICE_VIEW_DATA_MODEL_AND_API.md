# WO-33a — Device view: data model, persistence, and HTTP API

**Parent:** [WO-33 index](./33_WO_DEVICE_VIEW_INDEX.md)  
**Status:** Draft  
**Prerequisites:** None (first in chain)

---

## 1. Objective

Define a **versioned** `DeviceGraph` (or equivalent name) that can be **saved in HighAsCG config** alongside (or nested within) `tandemTopology`, expose **read/write JSON APIs**, and provide **bi-directional sync** with existing `tandemTopology` / `signalPaths` / `destinations` so present installs do not lose data.

---

## 2. Data model (normative)

### 2.1 Top-level

```ts
// Conceptual; implement as plain JSON in Node + JSDoc
DeviceGraphV1 = {
  version: 1,
  /** Host devices shown on canvas; at least one `caspar_host` */
  devices: Device[],
  /** Physical or logical ports (DP, HDMI, SDI, PH input block, etc.) */
  connectors: Connector[],
  /** Cables: source connector id -> sink connector id + metadata */
  edges: Edge[],
  /** Optional: layout hints for web (x/y per device) */
  layout?: Record<string, { x: number; y: number; w?: number; h?: number }>,
  /** Provenance: last sync with tandem */
  _meta?: { tandemSyncedAt?: string; migration?: string }
}
```

### 2.2 `Device` (minimum fields)

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | Stable UUID or slug, e.g. `host:default`, `ph:main` |
| `role` | enum | `caspar_host` \| `pixelhue_switcher` \| `ext` (future) |
| `label` | string | Shown in UI |
| `hostRef?` | string | For `caspar_host`, optional machine id / hostname for multi-host later |

### 2.3 `Connector`

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | Stable; references from edges |
| `deviceId` | string | FK to `devices[].id` |
| `kind` | enum | See §2.4 |
| `index` | number? | 0-based within kind on device (DeckLink 0, GPU 0, …) |
| `label` | string | e.g. “DP-2”, “PH In 1-1” |
| `alias?` | string | User override when OS name ≠ physical silk |
| `caspar?` | object | `screenIndex`, `channelId`, `consumerName` *when* applicable (may be null until user binds) |
| `externalRef?` | string | OS path / PH `interfaceId` as string for join |

**Kind enum (v1, extensible):**  
`gpu_out`, `gpu_in` (rare), `decklink_in`, `decklink_out`, `audio_in`, `audio_out`, `ph_in`, `ph_out`, `usb_av`, `unknown`

### 2.4 `Edge`

| Field | Type | Notes |
|-------|------|--------|
| `id` | string | |
| `sourceId` / `sinkId` | string | `connectors.id` — direction: signal **from** Caspar/PC **to** display/PH **in** |
| `tandemPathId?` | string | Optional link to `signalPaths[].id` |
| `edid?` | `EdidHint` | See WO-33e; optional here for storage |
| `note?` | string | Free text for integrator |

### 2.5 Sync with `tandemTopology`

- Implement **pure functions** in `src/config/` (e.g. `device-graph-tandem.js`):
  - `graphFromTandem(topology: Tandem): DeviceGraphV1` — creates minimal devices/edges if graph empty; merges by id when re-run.
  - `tandemPatchesFromGraph(graph, prev): Partial<Tandem>` or update strategy documented — *avoid* silent deletion of `destinations` without UI confirmation.
- **Migration on first load:** if `deviceGraph` missing but `tandemTopology` has `signalPaths`, run `graphFromTandem` once and **persist** with user save or auto-migrate in `configManager` (product decision: prefer explicit save in 33c to avoid surprise writes).

**Persistence key:** e.g. `config.deviceView` or `config.deviceGraph` — single key, documented in `config/default.js` + `highascg.config.example.json` + `routes-settings` round-trip.

---

## 3. HTTP API (normative)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/device-view` or `/api/device-graph` | **Snapshot:** saved graph + `live` block (empty in 33a; 33b fills) |
| `POST` | same | **Save** graph; validate; sync tandem optional flag `?syncTandem=true` |
| `GET` | `/api/device-view/schema` (optional) | JSON Schema for devtools |

**Response shape (example):**

```json
{
  "ok": true,
  "graph": { "version": 1, "devices": [], "connectors": [], "edges": [] },
  "live": { "source": "33b", "gpu": [], "decklink": [], "pixelhue": null }
}
```

- **33a deliverable:** `GET/POST` with validation, persistence, **no** live enumeration yet (or `live: {}` stub).
- **Auth / gate:** follow same pattern as `routes-tandem-device.js` (local operator).

---

## 4. Validation rules

- Every `edge.sourceId` / `sinkId` must exist in `connectors`.
- **No** self-loops. Optional: prevent duplicate parallel edges with same (source, sink) or allow (product: usually **one** physical cable per pair).
- `version` monotonic; on load, run migrator `1 → 2` when added later.

---

## 5. Tasks (checklist)

- [ ] Add `src/config/device-graph.js` (or `device-graph-normalize.js`) with `normalizeDeviceGraph`, defaults.
- [ ] Implement `graphFromTandem` / `applyTandemFromGraph` (minimal viable: paths → edges; document limitations).
- [ ] Add `config.default.js` + example JSON key.
- [ ] `routes-device-view.js` + register in `src/api/router.js` **before** or **after** Caspar gate as appropriate (same as tandem).
- [ ] `routes-settings` GET/POST includes new block for round-trip.
- [ ] Unit tests: normalize, invalid edge rejected, round-trip save.

---

## 6. Acceptance criteria

1. `POST` with a valid v1 graph persists and `GET` returns it after server restart.
2. Invalid graph returns **4xx** with field-level reason (not 500 for bad input).
3. Existing `tandemTopology` still loads; migration path documented in code comment + one paragraph in 33a header.
4. No UI required for 33a (API-only OK).

---

## 7. Out of scope (33a)

- SVG / any frontend.
- xrandr / PH HTTP calls.
- EDID diff logic (33e).

---

*End of WO-33a*
