# WO-33c — Device view: Caspar host backplane (SVG) + entry point + inspector shell

**Parent:** [WO-33 index](./33_WO_DEVICE_VIEW_INDEX.md)  
**Status:** Draft  
**Prerequisites:** [33a](./33a_WO_DEVICE_VIEW_DATA_MODEL_AND_API.md), [33b](./33b_WO_DEVICE_VIEW_HOST_ENUMERATION.md)

---

## 1. Objective

Ship the **first user-visible** device view: a **read/write canvas** for the **Caspar / HighAsCG host** only — back-of-machine metaphor with **GPU**, **DeckLink**, and **Audio** **zones**; **click a connector** to open a **right-hand Inspector**; **save** position/layout and connector metadata via API from 33a; **no PixelHue second card** required for acceptance (33d).

---

## 2. UX (normative)

### 2.1 Entry point

- **Option A (default spec):** New item **“Devices”** in main app chrome (e.g. next to Scenes) → full-width view.
- **Option B:** Settings tab **“Device view”** that expands to a large pane or modal; link from Settings is fine for v1 if nav decision slips.

Document **which option shipped** in PR.

### 2.2 Backplane layout (Caspar only)

- **Rack/PC rear** aesthetic: **SVG** preferred (scalable, accessible, easy hit-testing).
- **Three stacked bands** (top → bottom or configurable):
  1. **GPU** — ovals/rects for each `live.gpu[].outputs` item; if live empty, show **dashed** placeholders from saved `connectors` or “Add output” (future).
  2. **DeckLink** — separate **In** and **Out** sub-rows; label `In 0`, `Out 0` consistent with 33b.
  3. **Audio** — small jacks or a single “Audio I/O” strip listing device names from `live.audio` (v1 can be read-only in inspector if editing audio routing is out of scope).

- **State chrome:** per connector: `unknown` (grey), `ok` (live match), `mismatch` (from 33e can gray until then).

### 2.3 Selection model

- **Global store** (or component state) for `selected: { type: 'connector'|'device'|null, id: string }`.
- **Keyboard:** `Tab` / arrow between connectors, `Enter` opens inspector, `Escape` clears.

### 2.4 Inspector (shell)

Right panel, reuse styling from `web/components/inspector-*.js` (cards, `settings-label`, `settings-control`).

**Minimum v1 fields per connector (Caspar):**

- Label, alias, kind (read-only)
- `caspar`: screen index, channel, consumer (where applicable) — **bound** to `settingsState` or the same JSON paths the generator reads (mirror **Screens** / consumer UI where it already exists; **import components** or call same patch helpers; **no duplicate business logic in a third place** without a shared module — extract `patchCasparServerScreen` if needed).
- Buttons:
  - **“Open related Settings…”** — scroll/focus the existing Settings sub-pane (hash or `data-settings-tab=screens` event).
  - **“Apply config &amp; restart”** — calls `POST /api/caspar-config/apply` (same contract as `settings-modal-caspar-ui.js` or equivalent) and shows **toast + server message** (`restartSent`, etc.).

**Out of v1 scope for inspector content:** full XML editor in inspector (use existing Caspar config preview elsewhere).

### 2.5 Save

- **Auto-save** optional; minimum is explicit **“Save device layout”** that `POST`s graph (33a).
- Persist **device position** in `graph.layout` from 33a.

---

## 3. Web architecture

- New `web/components/device-view-*.js` (split by concern):
  - `device-view-page.js` — shell, fetches `GET /api/device-view`, wires refresh.
  - `device-view-caspar-backplane.js` — SVG.
  - `device-view-inspector.js` — panel; receives `selectedConnector` + `live` DTOs.
- New CSS under `web/styles/` scoped `.device-view-*` — follow existing BEM or project patterns.
- `web/app.js` (or router): register route / tab switch.

### 3.1 Initial graph bootstrap

- On first open with empty `graph.devices`, create **one** `caspar_host` device and **synthesize** `connectors` from `live` (33b) with merge into saved graph (patch POST).

---

## 4. Tasks (checklist)

- [ ] Add route/tab + lazy-load the page bundle.
- [ ] SVG backplane with hit targets (`<button>` or `role="button"` on shapes + `aria-label`).
- [ ] `GET` poll every N seconds or manual refresh; show “Last updated: …” from `live.host.collectedAt`.
- [ ] Inspector: bind fields to `settingsState` + save pipeline **or** dedicated PATCH endpoint if 33a adds partial graph update (prefer reusing full graph save for v1).
- [ ] “Apply &amp; restart” using existing `api.post('/api/caspar-config/apply', …)` body shape — **copy from** current Settings “Write & restart” implementation.
- [ ] Empty / error: Caspar down + no live data — show **empty state** copy (one paragraph).
- [ ] i18n: English strings only in v1 unless project already has i18n for UI.

---

## 5. Acceptance criteria

1. User opens Device view, sees at least the **GPU band** and **DeckLink** band (or clear empty state with warnings from API).
2. Clicking a port focuses it and **Inspector** shows **correct** `kind`+`index` for that port.
3. **Save** persists layout + connector list; reload page restores.
4. **Apply** from inspector triggers the **same** server behavior as from Settings (spot-check: two paths produce same config file hash when inputs equal).
5. **WCAG 2.1 AA** for focus order and name on interactive shapes (33g may expand, but 33c does not block on full audit if basics met).

---

## 6. Out of scope (33c)

- PixelHue card, cables to PH, drag-between devices (33d).
- EDID color badges (33e) — can show placeholder.
- Iframe to PixelHue web.

---

*End of WO-33c*
