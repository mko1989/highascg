# WO-506 — Operator-editable labels for ANY live source, on every label bar

**Status: OPEN — investigated 13.08.2026, NOT implemented.** Design and the full render-site
inventory are below; the build is a decision, see §5.
**Priority:** Medium (operator ergonomics, no on-air risk)
**Source:** owner `todos13.08.26`: *"labels for any live source (pgm, prv, decklink, ndi etc) that
can be displayed on the label bar that appears in compose prv, multiview, looks, timelines (for
pgm/prv), test card (settings and display). operators will want to work mostly on their custom
labels and not generic screen 1 etc."*
**Predecessor:** [WO-222](./222_WO_SCREEN_LABELS_EVERYWHERE.md) — did exactly this for **screens**.
Extend it, do not fork it.

---

## 1. What already exists

**Screens are done (WO-222).** `screenLabels: string[]` (by main index) lives in the config the
channel map derives from, is exposed on `channelMap` in `/api/state`, is written by
`POST /api/screens/label`, and is read through one client helper:

```js
// client/lib/screen-label.js
export function screenLabel(channelMap, idx) { … return 'S' + (idx + 1) }
```

Already routed through it: `multiview-state-layout.js`, `timeline-editor.js`,
`timeline-transport.js`, `scene-list.js`, `scenes-editor-deck-drop.js`, `timer-control-panel.js`,
`operator-compose-tiles-tile-controller.js`.

**Non-screen sources have GENERATED labels, not operator-editable ones.** `extraLiveSources` in
`/api/state` already carries `label` (measured on the box: `"DeckLink 3"`, `"DeckLink 4"`) with a
stable `connectorId` (`dlsdi_3`). Nothing lets an operator rename that to "Camera 2 — Wide".

**Destinations already carry an operator label.** `screenDestinations.destinations[].label`
("PGM/PRV 1", "PGM 2", "Operator GUI") — a second, unrelated naming path that today does not feed
the label bars.

So the gap is not "no labels", it is **three uncoordinated naming schemes and no canonical
resolver** for anything that is not a screen.

## 2. Design

**One store, keyed by a stable source id.** Reuse `screenLabels` for screens (do not migrate it —
WO-222's API and UI already work); add `sourceLabels: Record<string, string>` for everything else,
keyed by the id the source already has:

| source | key | generated fallback |
|---|---|---|
| screen main | existing `screenLabels[idx]` | `S{idx+1}` |
| PGM / PRV of a main | derived from the screen label | `PGM {label}` / `PRV {label}` |
| DeckLink input | `connectorId` (`dlsdi_3`) | `DeckLink 3` |
| NDI / v4l2 / live audio | its `value` (`route://6-3`) or connector id | existing `label` |

**One resolver, server-side, exposed in `/api/state`** so every surface (client, Companion,
templates) reads the same answer, rather than each re-deriving. Client gets one helper mirroring
WO-222's shape:

```js
sourceLabel(state, source) → custom ?? generated ?? generic
```

**Edit UI: the device-view host-channel inspector**, per input — NOT the Sources tab. The Sources
tab has no inspector and per-input controls belong in the device-view host-channel inspector; a
selection there is not a place to hang settings. Screens keep their existing Settings → Defaults
inputs from WO-222.

**API:** `POST /api/sources/label {sourceId, label}`. **Register it in `router.js`** — WO-222
recorded route registration as "recurring failure", and it is the single most likely way this lands
broken.

## 3. Render sites — the actual work

Surfaces the owner named, and what each needs:

| surface | file | state |
|---|---|---|
| multiview cells | `client/lib/multiview-state-layout.js` | screens ✅ WO-222 · non-screen tiles ❌ |
| looks selector | `client/components/scene-list.js` | screens ✅ · sources ❌ |
| timelines (pgm/prv) | `client/components/timeline-editor.js:259`, `timeline-transport.js` | screens ✅, but `:259` still builds `` `PGM · ${labelBase}` `` |
| compose PRV | `client/components/preview-canvas-compose-snapshot.js:456` | ❌ hardcodes `` `PGM ch ${ch}…` `` |
| test card settings + display | `src/api/routes-led-test-card.js`, `src/bootstrap/startup-led-test-pattern.js` | ❌ uses `connectorLabel` / `` `PGM ch ${ch}` `` |

Still hardcoding a generic label, found by grep and **not** yet routed through any helper:

```
client/components/audio-mixer-console-input-groups.js:44   `PGM ${chIdx + 1} (ch ${ch}) Inputs`
client/components/audio-mixer-panel.js:67                  `PGM ${i + 1} (ch ${ch})`
client/components/audio-mixer-view-console.js:43           `PGM ${i + 1} Master`
client/components/audio-mixer-panel-input-layers.js:48     `PGM ${chIdx + 1} (ch ${ch}) Inputs`
client/components/header-bar-audio.js:62                   `PGM · ch ${programChannels[0]}`
client/components/header-bar-streaming.js:62               'S' + (idx || '1')
client/components/device-view-inspector-replication-shared.js:190  `PGM ch ${ch} fps`
client/components/preview-canvas-compose-snapshot.js:456   `PGM ch ${ch}…`
client/components/timeline-editor.js:259                   `PGM · ${labelBase}`
```

The audio-mixer and header-bar sites are outside the owner's named list. **Do not sweep them
silently** — they deliberately show the Caspar channel number, which is a diagnostic the owner uses.
Renaming those is a separate decision.

## 4. Risks worth stating before building

- **Two label schemes will collide.** `screenDestinations[].label` and `screenLabels[idx]` can
  disagree today. Pick one as authoritative for the label bar (recommend `screenLabels`, since
  WO-222's UI already edits it) and make the other follow, or operators will rename in one place and
  see no change — the exact complaint this WO exists to fix.
- **Template surfaces need the label too.** The multiview and test-card templates are CEF HTML fed
  by AMCP payloads; a label change must reach them via `CG UPDATE`, not just re-render the client.
- **Empty string must mean "use the fallback"**, not "blank label".
- Labels are operator free text rendered into HTML templates and SVG — they must go through the
  existing escaping used for template payloads (WO-103 hardening).

## 5. Not done, and why

Implementation is not started. This is a cross-cutting feature touching a new server store, a new
route, a client helper, five owner-named surfaces plus template payloads, and it needs the §4
decision on which of the two existing label schemes wins. Building half of it would leave some
surfaces renamed and others not — indistinguishable, from the operator's seat, from the bug being
reported.

The durable value delivered here is §1–§4: the inventory, the collision risk, and the
"which sites deliberately keep channel numbers" carve-out.

**Owner decision needed:** confirm `screenLabels` is authoritative over
`screenDestinations[].label`, and confirm the audio-mixer / header-bar sites keep their channel
numbers.

## 6. Work log

- 2026-08-13 — Opened. Inventoried existing label infrastructure (WO-222 screens, generated
  `extraLiveSources.label`, `screenDestinations[].label`), enumerated render sites by grep, recorded
  the two-scheme collision risk.
