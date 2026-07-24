# WO-321 — CG studio export drops everything except colors; own inspector shrinks the canvas

**Source:** todos22.07.26 — "cg studio export seemed to only export the color changes and
nothing else. it also doesnt use the built in inspector but its own. making the canvas smaller."

Two independent defects in one line. Part A (export) is a functional bug and the priority.
Part B (canvas real estate) is a layout issue. The "own inspector" complaint is the already-landed
WO-285 compromise — do **not** relitigate it here; see §B.

---

## Part A — Export only persists colors (functional bug)

### Root cause
The transport is fine: the studio POSTs the *entire* inspector state
(`data` + full `style`) to `/api/export` (`src/cg-studio/public/app.js:282-299`), and
`routes.js:73-84` forwards it into `exportTemplate({ …, data, style })`. The loss is entirely in
**`src/cg-studio/export-template.js:21-50` (`bakeDefaults`)** — the only function that turns
inspector values into the exported file. It writes exactly two things:

- Title/subtitle **text** into the HTML (`export-template.js:27-31`).
- Five **color** CSS variables into a `:root` block (`export-template.js:33-47`):
  `--primary`, `--text`, `--grad-mid`, `--grad-end`, `--panel`.

Colors survive because the templates apply them through the CSS cascade — `var(--primary, …)`
etc. (e.g. `template/lower-thirds/lt-classic-box.html:42,50,53,58`), and the engine's
`applyStyles()` never touches color. Everything else is applied **only at runtime by the engine**
reading the live `style` object — `applyTypographyOverrides` (`lt-engine.js:265-297`),
`applyBoxSizeOverride` (`lt-engine.js:323-366`), margins/opacity/position (`lt-engine.js:217-252`),
speed/customFont (`lt-engine.js:190-214`), `blurAmount` (`lt-engine.js:368-372`).

The exported HTML seeds **no `style`** — no embedded style payload, no load-time
`update({style})`, no pre-baked CSS equivalents. On air Caspar sends only `data`, so `style` is
empty, `applyStyles` runs with defaults, and geometry/typography/timing revert to the template's
own CSS. Net effect: "only the color changes and nothing else," exactly as reported.

**Fields silently dropped** (all already exist in the registry, `src/cg-studio/lt-param-registry.js`):
- Typography (`:48-54`): `titleFontSize`, `subtitleFontSize`, `titleFontWeight`, `letterSpacing`,
  `textTransform`.
- Layout (`:56-97`): `position`, `marginX`, `marginY`, `opacity`, `boxWidth`, `boxHeight`,
  `boxScale`.
- Animation/timing (`:99-103`): `speed`, `displayDurationSec`, `customFont`.
- Template-extra (`:114-116`): `blurAmount`.

`validateExportedHtml` (`export-template.js:78-81`) only checks for `LTEngine.init` + `lt-engine.js`
presence, so it does not catch the missing style — extend it (see Acceptance).

### Ground truth to read first
- `src/cg-studio/export-template.js` — `bakeDefaults` (`:21-50`) is the defect site; the export
  writes to `template/studio/` (`:98-114`), a *new* file, so exports never mutate existing looks.
- `src/cg-studio/public/app.js:282-299` — what the studio actually sends (full state).
- `template/lower-thirds/lt-engine.js` — the runtime style application the export must reproduce or
  drive; **and its twin** `template/lower-thirds/lt-engine-styles.js`, kept byte-equal by the sync
  test (below).
- `src/cg-studio/lt-param-registry.js` — full field set; note box-size keys are already opt-in /
  empty-safe (`:19-31`), the pattern any export change must preserve.

### Fix direction (owner picks the mechanism — see Ambiguities)
Persist the full `style` on export so an exported template renders identically to the studio
preview. Two options:
- **(a) Seed style at load** — embed the `style` object in the exported HTML and have
  `LTEngine.init` / a load-time `update({style})` apply it. Single source of truth (reuses the
  engine), but adds an engine load-hook that must land in **both** engine copies and stay within
  the sync test.
- **(b) Bake equivalent CSS** — have `bakeDefaults` pre-compute the same rules the engine emits
  (typography `!important`, margins, box width/height/scale, opacity). Leaves the engine untouched
  but duplicates engine logic in the exporter and risks divergence.

Recommendation: **(a)** — it keeps one style-application path and avoids the exporter drifting from
the engine. Confirm with owner.

### Constraints (Part A)
- **Sync-lock test — `tools/smoke/smoke-lt-engine-registry-sync.test.js`.** It asserts `STYLE_KEYS`
  from *both* engine copies (`lt-engine.js:29-35`, `lt-engine-styles.js:9-15`) equals the registry
  field union. The export fix needs **no new style keys** (every dropped field already exists in all
  three sets) so the test should stay green; if the fix ever adds a field, change all three together.
  Do not weaken this gate.
- **Two engine copies stay identical.** Any engine-side change (e.g. a load-time style hook) must
  land in both `lt-engine.js` and `lt-engine-styles.js`.
- **Mirror rule.** Never hand-edit `client/tools/electron-launcher/cg-studio/`. Edit
  `src/cg-studio/` then run
  `HIGHASCG_SERVER_ROOT=/home/casparcg/highascg bash client/tools/electron-launcher/sync-cg-studio.sh`
  (rsync with `--delete`, `sync-cg-studio.sh:29-33`).
- **Live-template caution.** Keep unset fields bit-for-bit identical to today's render (opt-in /
  empty-safe, mirroring the existing box-size keys) so exported files with defaults do not shift.

### Acceptance (Part A)
- Export a lower-third with a non-color change (larger title font, moved position, custom box
  width, non-default duration) → the exported `template/studio/*` file, played on air with only
  `data` sent, renders those changes — not just the color.
- `validateExportedHtml` is extended to assert the style is actually persisted (fails an export
  that would drop non-color style), with a fixture test.
- Registry↔engine sync test passes **unmodified in spirit** (extended, never weakened).
- `npm run test:ci` → 0 fail; no new eslint warnings vs HEAD.

---

## Part B — Studio inspector column shrinks the canvas

### Root cause
The three-column CSS grid gives the inspector a fixed **340px** and the gallery a fixed **220px**,
leaving the preview only `1fr` = viewport − 560px:
`src/cg-studio/public/styles/studio.css:52-57`
`grid-template-columns: 220px 1fr 340px;` (inspector `<aside class="inspector">`,
`index.html:32-36`). The canvas (`.preview-frame-wrap`, `aspect-ratio:16/9`,
`studio.css:134-145`) is scaled by `scalePreview()`/`fitStage` (`app.js:29-37`) into whatever that
middle column leaves — so the wider the inspector, the smaller the 16:9 canvas. There is no
collapse/toggle for either aside, so the canvas is permanently boxed into the middle. Pure layout
issue, independent of Part A.

**Not in scope:** replacing the studio's own inspector with the client's ESM inspector components.
`app.js:90-99` documents why that is infeasible (CG studio is a static, non-module app; the client
inspector is bundled ESM) and WO-285 already settled on "consistency via the shared registry, not a
shared component." Do not reopen that.

### Fix direction
Low-risk: make the inspector (and optionally the gallery) **collapsible** or narrower so the
operator can reclaim canvas width — a collapse toggle on `.inspector` / `.gallery` that reflows the
grid to `1fr` and triggers `scalePreview()`. Confirm scope with owner (collapse toggle vs. larger
redesign).

### Acceptance (Part B)
- Operator can reclaim the inspector (and gallery) width; canvas visibly grows to use it and
  re-fits via `scalePreview()` on toggle/resize.
- No regression to inspector field rendering (still driven by `lt-param-registry.js`).

---

## Ambiguities for the owner
1. **Export persistence mechanism:** option (a) seed-style-at-load vs (b) bake-equivalent-CSS above.
   Recommend (a).
2. **Behavioral fields (`displayDurationSec`, `speed`, `customFont`):** confirm these should also be
   baked — an operator exporting a "10s auto-out" expects that timing to persist; today any
   non-default value is lost.
3. **Canvas fix scope:** collapse/narrow toggle (recommended, low-risk) vs a larger layout redesign.
4. **Export display name:** `export-name` is returned but only `exportId` becomes the filename
   (`export-template.js:106-114`); the human name isn't persisted into the template. In scope or not?
