# WO-222 — Canonical screen labels: rename once, propagates everywhere (looks selector, multiview, panels)

**Status:** Planned | **Date:** 2026-07-15
**Source:** owner: "changing the label of a screen should change its labelling across the board. also the screen selector in looks and multiview label."

## 1. Findings
No canonical screen-label store exists: `channelMap` carries no name fields (live-verified); MV cells hardcode `PGM S${s+1}` (client/lib/multiview-state.js:60-65); looks editor screen selector and timer-panel chips render `S${i+1}` variants independently.

## 2. Design
- Server: `screenLabels: string[]` (by mainIdx) persisted in the config the channel map derives from (find where `screenCount/programChannels` are configured — src/config/routing.js consumers — and store labels alongside; expose in the channelMap payload in /api/state).
- API: small POST to set a label (register in router.js! — recurring failure) e.g. `/api/screens/label {screenIdx, label}`.
- Client: ONE helper `screenLabel(cm, idx)` in client/lib (returns `cm.screenLabels?.[idx] || 'S' + (idx+1)`); route ALL render sites through it: looks editor screen selector buttons, MV editor default cell labels + cell label placeholders (multiview-state.js:60-65 — only when the cell label is not user-overridden), timer panel screen chips, audio-mixer master labels (grep `S${` and `Screen ` and `PGM${` across client/).
- Edit UI: label input per screen in Settings (find the screens/routing section of the settings modal) — simplest owner-visible home.

## 3. Tasks
- [x] T222.1 Server store + channelMap exposure + POST route (+ router registration + smoke).
- [x] T222.2 Client helper + sweep all render sites (list them in the work log).
- [x] T222.3 Settings UI input per screen (one text input per screen in Settings → Defaults → Screen labels, saves via POST /api/screens/label).
- [x] T222.4 Looks editor screen selector updated to use screenLabel helper (scene-list.js mainLabel function).
- [ ] T222.5 eslint/gate; orchestrator does vite build. A222.1 owner check: rename → looks selector + MV + chips all update.

## 4. Work log
- 2026-07-15 — WO created (no existing label store; render sites enumerated by grep).
- 2026-07-15 — T222.1 complete: Added `screenLabels: []` to defaults; exposed through channelMap in routing-map.js and channel-map-from-ctx.js; created routes-screens.js with POST handler; registered `/api/screens/label` in router.js; all smoke tests pass (helper fallback, router registration, server roundtrip, defaults, channelMap exposure).
- 2026-07-15 — T222.2 complete: Created client/lib/screen-label.js helper (returns custom label or fallback S + (idx+1)); updated render sites:
  - client/lib/multiview-state.js: defaultLayout PGM/PRV cell labels use screenLabel(cm, s)
  - client/components/timer-control-panel.js: screen chips (×2) and "Add to screen" dropdown use screenLabel(cm, idx)
  - client/components/timeline-editor.js: getComposeCellDefs labelBase uses screenLabel(cm, s)
  - client/components/timeline-transport.js: screen selector dropdown uses screenLabel(cm, i)
- 2026-07-15 — T222.3 complete: Added screen labels UI section to Settings Defaults pane (settings-modal-templates.js); implemented mountScreenLabelsSection & saveChangedScreenLabels in settings-modal-logic.js; Settings modal initializes screen label inputs on load and saves changes via POST /api/screens/label on input.
- 2026-07-15 — T222.4 complete: Updated scene-list.js mainLabel function to use screenLabel(cm, i) instead of fallback "Screen ${i+1}", completing the looks editor screen selector coverage.
