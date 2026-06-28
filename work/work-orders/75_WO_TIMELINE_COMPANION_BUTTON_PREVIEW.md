# Work Order 75: Timeline Companion button preview keyframes (Satellite subscribe + HTTP press)

> **⚠️ AGENT COLLABORATION PROTOCOL**
> Every agent that works on this document MUST:
> 1. Add a dated entry to the **Work Log** section at the bottom documenting what was done
> 2. Update task checkboxes to reflect current status
> 3. Leave clear **Instructions for Next Agent** at the end of their log entry
> 4. Do **not** delete previous agents' log entries

**Status:** In progress — Phases A–D implemented (2026-06-28); hardware QA with real Companion optional  
**Priority:** Medium–High (operator UX — pick the right Companion key visually; type coordinates quickly; see keyframes on timeline)  
**Parent / context:** [00_PROJECT_GOAL.md](./00_PROJECT_GOAL.md)

**Builds on (required reading):**
- [24_WO_COMPANION_BUTTON_PRESS.md](./24_WO_COMPANION_BUTTON_PRESS.md) — **shipped** timeline `companion_press` flag + server-side HTTP `POST /api/location/.../press` (keep unchanged for triggering)
- [21_WO_TIMELINE_INSPECTOR_WAVEFORM.md](./21_WO_TIMELINE_INSPECTOR_WAVEFORM.md) — timeline ruler, flag inspector, canvas render patterns

**Out of scope:** Replacing Companion module or HighAsCG→Companion command direction (that remains the lean module + WO-24 HTTP press); editing Companion button style from HighAsCG; triggering presses via Satellite (HTTP press stays canonical).

---

## 1. Problem statement

[WO-24](./24_WO_COMPANION_BUTTON_PRESS.md) lets operators place **Companion button press** flags on a timeline. When the playhead crosses a flag, HighAsCG fires the button via Companion’s **HTTP Remote Control API**. That path is **complete and working**.

What is missing is **visual parity** with Companion’s own GUI and a physical Stream Deck:

| Surface | Today (WO-24) | Desired |
|---------|---------------|---------|
| Timeline ruler flag | Orange triangle + colour cue only | **Mini keyframe** showing the button’s rendered appearance (bitmap, colours, text) |
| Flag inspector | Three small `type="number"` spinboxes (Page / Row / Column) | **Fast coordinate entry** (`1 2 1` in one field or three multi-digit boxes) + **Choose button…** modal |
| Operator confidence | Must mentally map `1/0/2` to a Stream Deck key | Browse Companion pages in a modal, click the key, or type coords — see **exactly** which key will fire |

**Operator requests (2026-06-28):**

1. Preview the chosen Companion button as a **keyframe** in the timeline web UI — same look as in Companion or on Stream Deck.
2. Inspector coordinate inputs that accept easy typing like **`1 2 1`** (multi-digit page / row / column — not capped at single digits).
3. A **modal page browser** showing full Companion pages; paginate through pages and **click** the button to bind it to the timeline flag.

---

## 2. Integration choice: HTTP vs Satellite

### 2.1 Triggering (unchanged — HTTP)

WO-24 correctly uses **HTTP**, not Satellite, for **press/release**:

```http
POST http://{host}:{port}/api/location/{page}/{row}/{column}/press
```

- Server-side `fetch()` from `src/engine/timeline-playback.js` — no browser CORS issues.
- Simple, fire-and-forget, well documented in Bitfocus Companion 3.x/4.x.
- **This WO does not change the press path.**

Companion **Satellite API** is **not** used for triggering in WO-24 and should **not** replace HTTP for presses (Satellite `SUB-PRESS` exists but adds connection state; HTTP is the established show trigger).

### 2.2 Preview (new — Satellite `ADD-SUB`, not HTTP)

Companion’s HTTP API exposes **style mutation** (`POST /api/location/.../style`) and legacy bank routes — it does **not** provide a stable, documented **GET rendered bitmap** for a page/row/column in the modern location model.

For **pixel-accurate button previews** (including layered graphics, PNG backgrounds, feedback colours), use Companion **Satellite API Button Subscriptions** (API v1.10+, Companion ~4.3+):

```text
ADD-SUB SUBID=highascg-1-0-2 LOCATION=1/0/2 BITMAP=72 COLORS=hex TEXT=true TEXT_STYLE=true
→ SUB-STATE SUBID=... BITMAP=<base64 RGB> COLOR=#... TEXTCOLOR=#... TEXT=<base64> ...
```

Reference: [Satellite API — Button Subscriptions](https://companion.free/for-developers/Satellite-API/) (`ADD-SUB`, `SUB-STATE`, `REMOVE-SUB`).

| Concern | HTTP (WO-24) | Satellite `ADD-SUB` (this WO) |
|---------|--------------|-------------------------------|
| Fire button on timeline | ✅ **Use this** | ❌ Not needed |
| Stream rendered bitmap | ❌ No GET bitmap | ✅ `SUB-STATE` with `BITMAP` |
| Live updates when button edited in Companion | ❌ | ✅ Companion pushes new `SUB-STATE` |
| Connection | Stateless per press | Persistent TCP (default **16622**) or WebSocket (**16623**) |

**Fallback when Satellite unavailable** (older Companion, port blocked, `CAPS SUBSCRIPTIONS=0`):

1. Show styled placeholder chip: page/row/col label on timeline + inspector.
2. Optional v1.1: poll Companion custom variables if the operator binds feedback to a module variable (out of scope v1).

**Settings additions** (Companion tab):

| Field | Default | Purpose |
|-------|---------|---------|
| `companion.satelliteEnabled` | `true` | Master gate for preview subscriptions |
| `companion.satelliteHost` | same as `companion.host` | Satellite TCP/WS host |
| `companion.satellitePort` | `16622` | TCP port (16623 for WS mode v1.1) |
| `companion.previewBitmapSize` | `72` | Square bitmap requested in `ADD-SUB` (match Stream Deck key) |

HTTP press continues to use `companion.host` + `companion.port` (default **8000**).

### 2.3 Coordinate model (UI vs Companion API)

Companion’s location API uses:

| Axis | Indexing | Example |
|------|----------|---------|
| **Page** | **1-based** | Page `1` is the first page |
| **Row** | **0-based** | Top row is `0` (grid can grow upward — negative rows exist in Companion) |
| **Column** | **0-based** | Left column is `0` |

HighAsCG stores the **API values** on the flag (`companionPage`, `companionRow`, `companionColumn`) — same as WO-24 playback.

**Inspector display options (pick one default, document in UI):**

- **Option A (recommended):** Show **API truth** in labels — `Page (1+)`, `Row (0+)`, `Column (0+)` — with hint text.
- **Option B (follow-up):** Optional setting “Show row/column as 1-based in UI” — display `1` for API row `0`, convert on read/write only.

There is **no hard upper bound** in Companion for page number or grid extent (grids are expandable; row/column can exceed 9 and go negative). Inputs must accept **at least 3 digits** per field (999+) without clipping; validate with `Number.isFinite` + sane max (e.g. 9999) to block garbage.

---

## 3. Goals (normative)

### G1 — Server: Satellite subscription manager

1. New module `src/companion/satellite-preview-client.js`:
   - One shared connection per configured Companion instance (lazy connect on first subscription).
   - `PING` every 2 s; reconnect with backoff on drop.
   - On connect: read `BEGIN` / `CAPS`; require `SUBSCRIPTIONS=1` or disable preview with logged warning.
2. Subscription registry keyed by `{page,row,column}`:
   - First consumer → `ADD-SUB SUBID=highascg-{page}-{row}-{col} LOCATION={page}/{row}/{col} BITMAP={size} COLORS=hex TEXT=true TEXT_STYLE=true`
   - Last consumer released → `REMOVE-SUB`
   - Reference counting: active timeline flags in loaded project + inspector focus.
3. On `SUB-STATE`: decode `BITMAP` (8-bit RGB) → PNG/JPEG cache file; emit WS `companion.buttonPreview` `{ page, row, column, mtimeMs, url }`.
4. All errors **non-fatal** — preview failure must never block timeline playback or HTTP press.

### G2 — Server: HTTP API for cached preview

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/api/companion/button-preview/:page/:row/:column.jpg` | JPEG square thumb, `404` if not yet subscribed/cached, `Cache-Control: private`, `ETag` from mtime |
| `GET` | `/api/companion/button-preview/status` | `{ ok, satelliteConnected, subscriptions: N, caps: { subscriptions } }` |

Subscribe-on-demand: first `GET` (or WS interest from client) ensures `ADD-SUB` for that location.

### G3 — Timeline ruler keyframes

In `client/components/timeline-canvas-render.js` `drawFlags()`:

1. For `companion_press` flags, draw a **square keyframe** (~24–32 px) on the ruler track (not only the triangular marker).
2. Fill with cached preview image when URL loads (`/api/companion/button-preview/...jpg`); show skeleton/placeholder until ready.
3. Keep selection ring + orange accent border for `companion_press` type.
4. Tooltip / aria-label: `Companion · page {p} row {r} col {c}` + button text if known from last WS payload.

### G4 — Flag inspector: coordinate entry + preview

Replace WO-24’s three `type="number"` spinboxes in `client/components/inspector-panel-timeline.js` with operator-friendly inputs.

#### G4.1 — Combined coordinate field

One text input, label e.g. **Location**, placeholder `1 0 2` or `page row column`:

| Accepted input | Parsed to |
|----------------|-----------|
| `1 2 1` | page=1, row=2, col=1 |
| `1/2/1` or `1-2-1` | same |
| `1,2,1` | same |
| Partial / invalid | Inline validation message; do not write until valid or on blur with revert |

Parse on **blur** and **Enter**; trim whitespace; collapse repeated separators. Use shared helper `client/lib/companion-location-parse.js` (unit-tested).

Updating the combined field updates the three individual fields and vice versa (two-way sync, no feedback loop).

#### G4.2 — Individual fields (multi-digit)

Three **`type="text"`** inputs with `inputmode="numeric"` (not spinboxes):

- Labels: **Page**, **Row**, **Column** (+ indexing hint from §2.3).
- Allow **1–4 digits** each; no `max="9"` or browser stepper UI.
- `change` / blur → parse int, clamp only negative page (page ≥ 1); row/col may be negative if Companion grid uses them (do not clamp to 0–7).
- Debounced server sync (~150 ms) same as today.

#### G4.3 — Live preview + actions

1. Preview panel (~72×72 or 96×96) above or beside coordinate fields.
2. Re-subscribe preview (debounced ~150 ms) when any coordinate field changes.
3. **Choose button…** button opens the page picker modal (G5); disabled with tooltip if Satellite preview unavailable.
4. Connection hint when Satellite disabled/unreachable (link to Settings → Companion).
5. Optional v1: **Test press** — server `POST` same HTTP press as timeline (one-shot, confirm dialog) so operator can verify binding without playing timeline.

### G5 — Companion page picker modal

New modal component `client/components/companion-button-picker-modal.js` (pattern: [`load-project-modal.js`](../../client/components/load-project-modal.js)).

#### G5.1 — UX

```text
┌─ Choose Companion button ───────────────────────────── [×] ┐
│  ◀ Prev   Page [  3  ] ▼   Next ▶          [Refresh]     │
│  ┌────┬────┬────┬────┬────┬────┬────┬────┐              │
│  │ ■  │ ■  │ ■  │ ■  │ ■  │ ■  │ ■  │ ■  │  row 0       │
│  ├────┼────┼────┼────┼────┼────┼────┼────┤              │
│  │ ■  │ ■  │ ■  │ ■  │ ■  │ ■  │ ■  │ ■  │  row 1       │
│  └────┴────┴────┴────┴────┴────┴────┴────┘              │
│  Empty cells: muted; configured buttons: live preview    │
│  Click a cell → set flag coords → close modal            │
│  Current selection highlighted (blue ring)               │
└──────────────────────────────────────────────────────────┘
```

- **Open from:** inspector **Choose button…** on a `companion_press` flag.
- **Page navigation:** Prev / Next, editable page number (multi-digit), optional dropdown of pages that have at least one non-empty button (v1.1 if server can list them).
- **Grid:** Render current page as a table of cells; cell size ~64–72 px; show cached Satellite preview per location.
- **Click:** writes `companionPage`, `companionRow`, `companionColumn` to the active flag, syncs timeline, closes modal, refreshes inspector + timeline keyframe.
- **Keyboard:** Esc closes; Enter on focused cell selects; arrow keys move selection (nice-to-have v1.1).
- **Empty cells:** Still selectable (Companion allows pressing empty locations — WO-24 behaviour); show dashed border + coordinates label.

#### G5.2 — Data source for full-page grid

Companion has **no stable public HTTP GET** for full page layouts today ([bitfocus/companion#3373](https://github.com/bitfocus/companion/issues/3373) — proposed, not required for v1).

**v1 approach — Satellite batch subscribe for visible page:**

1. Server endpoint `POST /api/companion/page-preview/subscribe` body `{ page, rowMin, rowMax, colMin, colMax }` (defaults: row/col `0..7` or from settings `companion.pickerGridSize`).
2. Server issues `ADD-SUB` for each `{page,r,c}` in range (reference-counted; tear down when modal closes via `POST .../unsubscribe` or TTL).
3. Client polls or WS `companion.buttonPreview` to paint cells as JPEGs arrive.
4. **Performance cap:** max cells per page (default 8×8 = 64 subs); settings override for 12×12 shows. Log warn if exceeded; clip range.

**v1.1 follow-on:** virtual Satellite surface (`ADD-DEVICE`) for native page-follow behaviour when operator changes page inside Companion while modal is open; or switch to `GET /api/pages/:n` when available in target Companion version.

#### G5.3 — Server API (picker)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/companion/page-preview/subscribe` | Batch ADD-SUB for page grid |
| `POST` | `/api/companion/page-preview/unsubscribe` | Release batch subs for session id |
| `GET` | `/api/companion/page-preview/:page/status` | `{ page, cells: [{ row, column, url, text?, empty? }] }` |

Modal holds opaque `sessionId` (UUID) for subscribe/unsubscribe pairing.

#### G5.4 — Styles

New CSS module `client/styles/companion-button-picker.css` — grid, cell hover, selected ring, loading skeleton. Match existing modal tokens (`modal-overlay`, `modal-content`).

### G6 — Project persistence (optional v1)

- **Do not** embed large base64 blobs in timeline JSON by default.
- Server-side disk cache keyed by `{page,row,col}` + content hash is sufficient.
- If offline editing must show last-known art, v1.1 may store `companionPreviewHash` on the flag for ETag matching only.

### G7 — Testing

1. `tools/smoke/smoke-companion-location-parse.test.js` — `1 2 1`, `12/34/5`, invalid input, negative row.
2. `tools/smoke/smoke-companion-satellite-preview.test.js` — mock Satellite TCP server: `ADD-SUB` → synthetic `SUB-STATE` with tiny RGB bitmap → assert cache file + HTTP GET 200.
3. Extend `npm run smoke:companion-press` docs — press smoke stays separate; preview smoke is additive.
4. Manual QA: edit button in Companion GUI → timeline keyframe updates within one `SUB-STATE`; modal page flip loads new grid; typing `10 0 15` in combined field persists and fires correctly on playback.

---

## 4. Architecture

```text
Timeline flag (companion_press) + inspector edit
       │
       ├─ Coordinates: combined "1 2 1" or three text fields → flag JSON
       │
       ├─ Choose button… modal
       │     POST page-preview/subscribe → batch ADD-SUB for page grid
       │     click cell → write P/R/C → unsubscribe
       │
       ├─ Playback (unchanged WO-24)
       │     POST http://companion:8000/api/location/P/R/C/press
       │
       └─ Preview (new)
             │
             client timeline-canvas / inspector / picker modal
                   GET /api/companion/button-preview/P/R/C.jpg
                   WS companion.buttonPreview
             │
             satellite-preview-client.js
                   TCP companion:16622
                   ADD-SUB → SUB-STATE (BITMAP…) → cache JPG
```

**No browser → Companion direct calls** — same security model as WO-24 (server proxies all Companion traffic).

---

## 5. Implementation map

| Area | Path |
|------|------|
| Satellite TCP client + SUB-STATE decode | `src/companion/satellite-preview-client.js` **(new)** |
| Preview cache (disk paths, RGB→JPEG) | `src/companion/button-preview-cache.js` **(new)** |
| HTTP routes | `src/api/routes-companion.js` (extend) or `routes-companion-preview.js` **(new)** |
| Settings schema | `src/config/defaults-core.js`, `client/components/settings-modal-*.js` |
| Timeline ruler draw | [`client/components/timeline-canvas-render.js`](../../client/components/timeline-canvas-render.js) `drawFlags` |
| Inspector coords + preview UI | [`client/components/inspector-panel-timeline.js`](../../client/components/inspector-panel-timeline.js) |
| Location parse helper | `client/lib/companion-location-parse.js` **(new)** |
| Page picker modal | `client/components/companion-button-picker-modal.js` **(new)** |
| Picker styles | `client/styles/companion-button-picker.css` **(new)** |
| Page batch subscribe API | `src/api/routes-companion-preview.js` **(new)** |
| Client URL helper | `client/lib/companion-button-preview-url.js` **(new)** |
| WS broadcast | [`src/server/ws-server.js`](../../src/server/ws-server.js) |
| Smoke tests | `smoke-companion-location-parse.test.js`, `smoke-companion-satellite-preview.test.js` **(new)** |

**Reuse — do not duplicate:**
- WO-24 press logic in [`timeline-playback.js`](../../src/engine/timeline-playback.js)
- Companion host/port settings in settings modal Companion tab
- Image loader / thumb cache patterns from [`compose-preview-cache.js`](../../src/preview/compose-preview-cache.js) and deck thumbs (WO-63)

---

## 6. Tasks

### Phase A — Server Satellite client

- [x] **T75.1** `satellite-preview-client.js`: connect, PING, CAPS check, ADD-SUB / REMOVE-SUB, SUB-STATE handler
- [x] **T75.2** RGB bitmap decode → JPEG cache + reference-counted subscription registry
- [x] **T75.3** Settings: `satelliteEnabled`, `satelliteHost`, `satellitePort`, `previewBitmapSize`, `pickerGridSize`
- [x] **T75.4** `GET /api/companion/button-preview/:page/:row/:column.jpg` + status route

### Phase B — Inspector coordinate UX

- [x] **T75.5** `companion-location-parse.js` + unit smoke (`1 2 1`, multi-digit, separators)
- [x] **T75.6** Combined Location field + three multi-digit text fields; two-way sync; replace `type="number"` spinboxes
- [x] **T75.7** Inspector live preview panel + debounced resubscribe on coordinate change

### Phase C — Page picker modal

- [x] **T75.8** Server batch subscribe/unsubscribe API for one Companion page grid
- [x] **T75.9** `companion-button-picker-modal.js`: page nav, grid of preview cells, click-to-select
- [x] **T75.10** Wire **Choose button…** from inspector; highlight current flag coords in grid

### Phase D — Timeline keyframes + QA

- [x] **T75.11** Timeline ruler: companion_press keyframe thumbnail in `drawFlags`
- [x] **T75.12** WS handler: repaint affected flags/cells on `companion.buttonPreview`
- [x] **T75.13** Smoke test with mock Satellite server (`npm run smoke:companion-preview`)
- [ ] **T75.14** Manual QA: modal pick + typed `10 0 15`; visual match Stream Deck; HTTP press unchanged

---

## 7. Acceptance criteria

1. Operator can type **`1 2 1`** (or `12 0 15`) in the combined Location field and all three stored coordinates update correctly.
2. Individual Page / Row / Column fields accept **multi-digit** values without spinbox clipping.
3. **Choose button…** opens a modal; paging through Companion pages and **clicking a cell** binds that flag and closes the modal.
4. A bound flag shows a **recognisable Stream Deck–sized preview** on the timeline ruler and in the inspector when Satellite is available.
5. Changing the button’s text/image in Companion updates the preview **without** reloading HighAsCG.
6. Timeline playback still triggers the button via **HTTP POST** (WO-24 behaviour unchanged).
7. If Satellite is down, coordinate typing still works; modal shows unavailable state; HTTP press still works; no crash or blocked playback.

---

## Work Log

*(Agents: add entries below in reverse chronological order)*

### 2026-06-28 — Phase A–D implementation (server + web UI)

**Work Done:**
- Added `docs/reference/companion-satellite-api.md` (canonical Bitfocus link + HighAsCG port map).
- Server: `src/companion/*` Satellite client, JPEG cache, preview API routes; Settings → Companion satellite fields.
- Client: combined `1 2 1` location input, multi-digit P/R/C fields, inspector preview, **Choose button…** page picker modal, timeline ruler keyframe thumbs.
- Smoke: `npm run smoke:companion-preview` (location parse + mock Satellite TCP).

**Instructions for Next Agent:**
- Manual QA (T75.14) against real Companion 4.3+ with Satellite enabled on port 16622.
- Rebuild client: `npm run build:client` before ISO/deploy.

### 2026-06-28 — Scope expanded (coordinate UX + page picker modal)

**Work Done:**
- Added **G4** coordinate entry: combined `1 2 1` field, multi-digit text inputs (no single-digit spinboxes), API indexing notes (page 1-based, row/col 0-based).
- Added **G5** Companion **page picker modal**: full-page grid, page prev/next, batch Satellite subscribe, click-to-bind.
- Split tasks into Phases B–D; extended acceptance criteria and implementation map.

**Instructions for Next Agent:**
- Implement `companion-location-parse.js` early — inspector and modal both depend on it.
- Page picker batch subscribe must reference-count and clean up on modal close (avoid 64+ orphan ADD-SUB on Companion).

### 2026-06-28 — Work order created (operator request)

**Work Done:**
- Audited WO-24: **shipped** — HTTP press only; no Satellite; no visual preview in timeline UI.
- Documented integration split: **HTTP for press**, **Satellite `ADD-SUB` for preview bitmaps**.
- Scoped timeline ruler keyframes + inspector preview panel.

**Instructions for Next Agent:**
- Implement Phase A (`satellite-preview-client.js`) first; verify against real Companion 4.3+ with Satellite enabled.
- Keep WO-24 smoke (`npm run smoke:companion-press`) green; add separate preview smoke.
- Match existing settings-modal Companion tab layout for new Satellite fields.

---
*Work Order created: 2026-06-28 | Parent: [`00_PROJECT_GOAL.md`](./00_PROJECT_GOAL.md) · Related: [`24_WO_COMPANION_BUTTON_PRESS.md`](./24_WO_COMPANION_BUTTON_PRESS.md)*
