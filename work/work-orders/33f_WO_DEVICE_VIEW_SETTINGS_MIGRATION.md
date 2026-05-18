# WO-33f — Device view: settings migration, deep links, and deprecation

**Parent:** [WO-33 index](./33_WO_DEVICE_VIEW_INDEX.md)  
**Status:** Draft  
**Prerequisites:** [33c](./33c_WO_DEVICE_VIEW_CASPAR_BACKPLANE_UI.md) (minimal); full value after **33d/33e**

---

## 1. Objective

Reduce **duplication and confusion** between the **old** settings panels and the new **Device view** by:

- Publishing a **matrix** of which settings **moved**, **duplicated (temporary)**, or **remain** only in classic Settings.
- Adding **deep links** from Device view to the exact tab/section in `settings-modal.js` and **back** (“Configure host ports in Device view”).
- **Deprecating** (soft) old entry points with **banners** — no removal until a release after telemetry/QA.

**Principle:** Operators who never open Device view must **not** lose workflows.

---

## 2. Matrix (authoritative in PR — table below is template; fill in at implementation)

| Current surface | Key settings | Device view 33c–33e | Disposition | Notes |
|----------------|--------------|---------------------|-------------|--------|
| Settings → **Screens** / Caspar | Screen count, resolution, consumer | Inspector + backplane | **Duplicate** for one release, then “Open in device view” primary | — |
| Settings → **Tandem** / Caspar+PH | `tandemTopology` | Same graph; **old panel** links to new | **Redirect banner** on old panel | Keep `tandem-device-panel` until graph parity |
| Settings → **PixelHue** | Host, port, test | Unchanged; optional link “Cabling in device view” | **Remain** in Settings | Server credentials stay here |
| Settings → **Connection** (Caspar host/port) | — | **Remain**; device view may show **read-only** + link | | |
| **Multiview** / audio | — | **Out of device view** v1 | **Remain** | |

*Update the table in the PR that closes 33f; link PR from this WO.*

---

## 3. Deep linking spec

- Add URL hash or app internal event: e.g. `#settings/connection`, `#settings/screens`, or `window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'tandem' } }))` **matching** existing `settings-modal` contract — **read** `settings-modal.js` and reuse **one** pattern only.
- From Settings sub-panes, **“Open device view and select connector X”** if `connectors` has stable id (query param `?select=…` on device view route).

---

## 4. Banners and deprecation

- **Tandem** tab (old): *“A richer cabling layout lives in **Device view**. Your data is shared.”* + button **Open device view**
- **Soft deprecation** = no removal; track issue for removal **N+2** releases.

### 4.1 Optional PixelHue **iframe** (deferred)

- If product approves, Settings → PixelHue → **“Embed device reference (read-only)”** with **sandbox** and **CSP** rules — out of 33f unless time permits; document as **separate** checkbox task.

---

## 5. Tasks (checklist)

- [ ] Fill **matrix** with actual files/components (`web/components/...`) and owner sign-off.
- [ ] Implement **deep link** from device inspector to settings tab (from 33c).
- [ ] Implement **banner** on `tandem-device-panel` (or merge panel into device view and leave stub).
- [ ] Update `README` or single **operator** paragraph: where to configure what (optional, short).
- [ ] Changelog / release note entry.

---

## 6. Acceptance criteria

1. **No** feature removed from Settings in the same release as 33f (banners only).
2. **Two-click** from Device view inspector to **relevant** Settings sub-pane works on Chrome + target browser.
3. **Matrix** committed to repo in this WO or `docs/` (short) with **one** source of truth — *prefer updating this file in the PR*.

---

## 7. Out of scope (33f)

- Removing `settings-modal` panes.
- i18n of all new strings (follow project norm).

---

*End of WO-33f*
