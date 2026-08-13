# WO-506 — Operator-editable labels for ANY live source, on every label bar

**Status: FOUNDATION DONE in repo (13.08.2026 — 12 smokes, suite 2098/2096/0, eslint 0, prettier clean, client rebuilt). NOT deployed. The store, resolver, route, client helpers and the pill transform are in; the per-surface UI sweep and the inspector edit control are NOT — see §5.**
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

## 4a. Owner decisions (13.08) — questions in §4 are ANSWERED

> *"the screen labels need to be over anything. if operator changes the label then this is the only
> thing that shows everywhere."*

**`screenLabels` is authoritative, unconditionally.** The §4 collision is resolved in its favour:
`screenDestinations[].label` must never win, and where a surface shows a destination name it renders
the screen label instead. One operator edit, one visible result, everywhere. Empty still means
"fall back to the generated name" — that is absence, not an override.

> *"for the small pils in the top bar right side, to choose which screens progress bar to show, it
> should be a 3 later shorthand of the label, just first 3 letters, nothing else."*

**Top-bar screen pills = `label.slice(0, 3)`.** Literally the first three characters of the resolved
label — no smart initials, no vowel-stripping, no uppercasing beyond what the operator typed. "Main"
→ "Mai", "Stage Left" → "Sta". Shorter labels render as-is. This is a display-only transform at the
pill render site; it must NOT be stored, and every other surface keeps the full label.

Still open from §4 and NOT decided: whether the audio-mixer and header-bar sites keep their channel
numbers. Treated as **keep** until the owner says otherwise, since those numbers are a diagnostic —
they are outside the surfaces the owner named and will not be swept.

## 4b. A §4 risk that turned out to be already solved

§4 warned that `screenLabels` and `screenDestinations[].label` could disagree. Reading the code:
**WO-385 already unified them.** `screenLabelsFromConfig` (`src/config/screen-destinations.js:200`)
resolves *owning destination's label → stored `screenLabels[i]` → ''* and every reader falls back to
`S<n>`; `/api/screens/label` renames the destination. So the owner's rule — screen labels outrank
everything — is already the implemented behaviour, and no change was needed. Recorded so nobody
"fixes" a collision that no longer exists.

## 5. What was built

- **`src/config/source-labels.js`** — the store and resolver for NON-screen sources. Key prefers
  `connectorId` (`dlsdi_3`), which survives re-cabling and re-mapping, falling back to `value`
  (`route://6-3`), which does not; nothing stable → no key, so nothing can be mislabelled. Empty
  means **absence**, never a blank name. Labels are capped at 64 chars because they are operator free
  text that ends up in HTML/SVG template payloads.
- **Applied at the single choke point.** `enrichExtraLiveSources` is the one function every live
  source passes through before `/api/state`, so overriding `label` there gives **every surface that
  already renders `extraLiveSources[].label` the custom name for free** — sources panel, multiview
  tiles, looks, compose — with no per-site edit. The generated name is preserved on `generatedLabel`
  and `labelIsCustom` flags human-named sources.
- **`POST /api/sources/label`** (`src/api/routes-sources.js`), **registered in `router.js`** — WO-222
  recorded registration as the recurring failure. It parses a RAW STRING body and returns the
  `{status, headers, body}` shape, the two defects `routes-screens.js` shipped twice; the tests pass
  real strings so they cannot repeat the WO-222 test's mistake of pre-parsing.
- **`sourceLabels` exposed in `/api/state`** so an inspector can show which sources are custom.
- **`client/lib/source-label.js`** — `sourceLabel()`, `sourceLabelIsCustom()`, and `shortLabelPill()`.
- **The pill transform** (§4a) implemented in both server and client, with a test asserting the two
  agree so they cannot drift.

## 6. NOT done — and one thing I could not find

- **The top-bar screen pills are not wired.** I could not locate the component that renders them.
  `header-bar-streaming.js:62` renders *streaming* indicators (a different row), `timeline-transport.js`
  uses a `<select>`, and nothing else in `client/components/header-bar*.js` renders a per-screen
  progress-bar chooser. Rather than guess and change the wrong control, the transform is implemented
  and tested and the wiring is left. **Owner: which component/class is that pill row?**
- **No inspector edit control yet.** The API works; the device-view host-channel inspector still needs
  the text input (and it belongs there, not in the Sources tab, which has no inspector).
- **Surfaces that build their own label** are untouched and still show generated text:
  `preview-canvas-compose-snapshot.js:456`, `timeline-editor.js:259`, and the test-card payloads in
  `routes-led-test-card.js` / `startup-led-test-pattern.js`.
- **Template payloads.** A rename reaches the client immediately but multiview/test-card CEF surfaces
  need a `CG UPDATE` to repaint; nothing triggers that yet.
- The audio-mixer and header-bar sites keep their channel numbers, per §4a.

## 7. Work log

- 2026-08-13 — Investigated (§1–4), owner decided (§4a), foundation built and tested (§5). §4's
  two-scheme collision found to be already solved by WO-385.
