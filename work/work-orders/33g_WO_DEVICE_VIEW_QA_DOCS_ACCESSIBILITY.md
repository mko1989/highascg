# WO-33g — Device view: QA, documentation, and accessibility

**Parent:** [WO-33 index](./33_WO_DEVICE_VIEW_INDEX.md)  
**Status:** Draft  
**Prerequisites:** Complete **33a–33f** to scope for **full** suite; partial runs possible after 33c.

---

## 1. Objective

Ship **verifiable** quality for the Device view program: **manual QA matrix**, **regression** checks against existing Settings, **lightweight operator documentation** (optional but recommended), and **accessibility** pass so the new surface is not a one-mouse workflow only.

---

## 2. Manual QA matrix (condensed — expand in test plan or spreadsheet)

| # | Scenario | Steps | Pass criteria |
|---|----------|--------|---------------|
| 1 | **Fresh install**, no `deviceGraph` | Open device view | Default caspar host device created or empty state; no console errors |
| 2 | **No GPU API** (CI / headless) | Open device view | Warnings in API + UI, no crash |
| 3 | **Single GPU** + live | Compare port count to `xrandr` (manual) | Count matches |
| 4 | **DeckLink** present | Compare indices to `casparcg.config` after generate | **Same** as generator order |
| 5 | **Caspar AMCP down** | Open device | `caspar.amcpConnected: false` + apply shows correct message from apply route |
| 6 | **Save layout** + reload browser | | Positions/edges persist |
| 7 | **PixelHue** down | 33d | Banner + saved-only PH ports |
| 8 | **PH** up | Cable + bind | Layer/source correct on device |
| 9 | **EDID** mismatch | 33e | Warning visible; apply after suggest fixes mismatch or documents limitation |
|10 | **Two browsers** on same app | | Last-write-wins for graph — document; optional optimist lock in future |
|11 | **Permissions** | Non-admin user (if any) | API returns 403/401 consistent with other routes |
|12 | **Large graph** 50+ connectors | | Acceptable performance (&lt; 200ms save, 60fps pan optional) |

---

## 3. Regression / integration

- [ ] `npm test` (or project test cmd) still green; add tests from 33a, 33b, 33e.
- [ ] `POST /api/caspar-config/apply` from **Settings** and from **Device view** with **identical** payload → **identical** file on disk (hash compare in test script optional).
- [ ] Tandem `POST` still works for existing companion workflows.

---

## 4. Documentation

**Minimum** (one of):

- **A:** Section in `README.md` — “Device view” — 1 screenshot + 5 bullets, **or**
- **B:** `docs/DEVICE_VIEW.md` — 2 pages: operator (how to wire) + integrator (API summary).

*Follow project policy on new docs* — if README is the norm, prefer A. Link **WO-33 index** from doc.

---

## 5. Accessibility (WCAG 2.1 AA target)

- [ ] All interactive **connectors** have **visible focus** and **name** (no color-only for state — use icon or text in addition to color).
- [ ] **Inspector** order follows DOM order = visual order; `aria-controls` if split panel.
- [ ] **Status** messages (apply success/fail) go to a **live region** (`role="status"`) for screen readers.
- [ ] **Touch targets** ≥ 24×24px equivalent on SVG (or adjacent padding).

*Optional tool:* automated axe in CI for `device-view` route only (if e2e exists).

---

## 6. Performance budgets (suggest)

- First paint of device view **&lt; 1.5s** after app shell on reference hardware, `GET /api/device-view` **&lt; 500ms** when enumeration cached.
- **No** blocking enumeration on `POST` save.

---

## 7. Tasks (checklist)

- [ ] Run through matrix **#1–#8** on reference Linux machine before release.
- [ ] File issues for any **P1** gaps; **P2** in backlog.
- [ ] Complete documentation choice (§4).
- [ ] A11y spot-check with VoiceOver (macOS) or NVDA (Windows) for keyboard-only port selection if supported.

---

## 8. Acceptance criteria

1. **QA** matrix (expanded version) stored: **wiki**, **in repo** under `work/qa/`, or **release checklist** in Git — **one** location linked from 33g PR.
2. **No** open **P0** / **P1** bugs in Device view for target release.
3. **Documentation** exists per §4.
4. **A11y** items above checked or waivers **documented** (e.g. “SVG focus ring deferred” with issue #).

---

*End of WO-33g*
