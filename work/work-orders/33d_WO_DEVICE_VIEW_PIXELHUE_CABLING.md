# WO-33d — Device view: PixelHue device card, cabling, and layer bind

**Parent:** [WO-33 index](./33_WO_DEVICE_VIEW_INDEX.md)  
**Status:** Draft  
**Prerequisites:** [33a](./33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md), [33c](./33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md)  
**Existing code:** `src/pixelhue/client.js`, `src/api/routes-tandem-device.js` (`POST …/bind-input`), `POST /api/pixelhue/*` proxy

---

## 1. Objective

Add a **second device** to the device-view canvas: **PixelHue** (one logical switcher). Show its **input** (and if API permits, **output**) **connectors**. Allow the user to **define a cable** from a **Caspar host output connector** to a **PixelHue input** connector. Persist in `DeviceGraph` (33a) and **optionally** push **PH layer / source** via existing **bind** API so the **signal path** is live on the device.

**Visual:** Either approximate Barco/PH **rear I/O** from **proprietary** PH web UI (reference only) or a **schematic** grid — **clarity** over artwork.

---

## 2. PixelHue live data

### 2.1 Sources (prefer in order)

1. **Unico / PixelFlow HTTP** as already used by `pixelhue/client` — e.g. interfaces list, screens, layers. Map each **input interface** to `Connector` with `kind: 'ph_in'`, `externalRef` = `phInterfaceId` (string/number as stored).
2. If an endpoint returns **input name** and **EDID** or **format** — attach to connector or edge (for 33e).
3. **Degraded mode:** if PH unreachable, show device card with **dashed** ports from **last saved** `connectors` + banner “PixelHue not reachable; showing saved layout”.

### 2.2 Second device in graph

- `devices` gains `{ id, role: 'pixelhue_switcher', label, pixelhue?: { baseUrl, deviceId, screenGuids: [] } }` — only fields you actually need; keep 33a migrator in sync.

---

## 3. Cabling interaction

### 3.1 v1: connect workflow (**required UX**)

The device view must support a **visual cable tool**:

1. Click a connector (input or output) to select it.
2. Click a **cable icon/tool** in the inspector or toolbar (`Link cable` action).
3. Click the second compatible connector to complete the cable.

The first selected connector remains **armed** (highlighted) until user:

- completes the cable,
- cancels cable mode, or
- reselects another start connector.

Optional enhancement: while armed, draw a temporary “rubber-band” cable line that follows cursor.

### 3.2 Edge / capability rules

- In v1, allowed links are **Caspar-capable outputs** (`gpu_out`, `decklink_out`) → **PixelHue-capable inputs** (`ph_in`).
- The inspector must show a clear, human message when a selected pair is not compatible.
- Server remains source of truth for validation (client pre-check + server reject).
- On save, `POST` full graph or edge command; server validates kinds and duplicates.

### 3.3 Bind to PH layer (optional on save)

- Checkbox **“Set PixelHue source now”** per edge (or global). When checked, call `POST /api/tandem-device/bind-input` with resolved `{ signalPathId, ... }` **or** extend bind to accept `edgeId` if tandem sync maps edge ↔ path.
- **Tandem sync:** when user creates an edge, **update or create** a `signalPath` (33a sync functions) with `phInterfaceId` + Caspar `mainIndex` + bus — *document idempotence* to avoid duplicate paths.

---

## 4. API changes (if needed)

- `GET /api/device-view` → `live.pixelhue: { ok, interfaces: [...], screens: [...], error? }` — 33b mentioned stub; 33d **fully implements** this block.
- Optional: `POST /api/pixelhue/proxy/...` already exists — **no duplications**; device view calls same backend helpers as tandem panel.

---

## 5. Tasks (checklist)

- [ ] `live.pixelhue` in server — aggregate from `unico` paths already in client; handle JWT/token errors gracefully.
- [ ] `device-view-pixelhue-backplane.js` (or section in one SVG) with PH ports; align count with `live` or saved.
- [ ] Cabling UI with **connector selection + cable icon/tool + target connector click**.
- [ ] Armed-source visual state + cancel action.
- [ ] `edges[]` persistence and duplicate-prevention.
- [ ] Non-compatible pair UX message.
- [ ] Server-side validation: allowed edge types.
- [ ] Optional: `bind` on save + tandem `signalPaths` update via 33a sync.
- [ ] If PH exposes **static device URL** for reference: link **“Open PixelHue web UI in new tab”** (not iframe by default — see 33f).

---

## 6. Acceptance criteria

1. With **PixelHue** configured and **reachable**, `live.pixelhue` lists **N** input connectors and the UI shows **N** ports (or a documented subset if API is paginated + “show all”).
2. User can create a cable via **select connector → cable icon/tool → click target connector** (without opening JSON/modals).
3. User can **create and save** an edge Caspar → PH in; `GET` after reload returns the same edge.
4. When bind is enabled and path resolves, the **PH layer shows the right source** (manual verification with hardware or PH simulator).
5. When PH is **unreachable**, UI **does not crash**; saved graph + warning banner.

---

## 7. Out of scope (33d)

- **Multi** PixelHue units (future `deviceId` in graph only).
- Full **readout** of EDID bytes — structured timing to 33e.
- **Companion** or API control from outside the web app.

---

## 8. Research notes

- Browse PixelHue on-device **HTTP** (when available in lab): note paths for static **assets** that inspired layout — **do not** commit proprietary images; recreate schematic SVGs.
- Hardware reference source for P80 rear panel and connector capabilities:
  - `work/Seamless Switchers & PixelFlow & Event Controllers User Manual-V1.9.0.pdf`
  - P80 sections around pages **26–31** (document pages 31–37): fixed inputs (HDMI/DP/12G-SDI), swappable input cards, output groups (HDMI/OPT), flex/matrix outputs, control ports and power.
  - Use these sections to define connector type metadata and capability constraints in the Device view model.
- Backpanel artwork reference image in repo:
  - `work/68ef51f861c4b.png`
  - Treat as visual overlay guide; connection logic and hitboxes must still come from `DeviceGraph` connector IDs.
- Caspar host visuals:
  - Support user-provided custom backpanel graphics/templates for machine-specific builds (GPU layout, DeckLink population, audio I/O), with connector anchors mapped by connector id.

---

*End of WO-33d*
