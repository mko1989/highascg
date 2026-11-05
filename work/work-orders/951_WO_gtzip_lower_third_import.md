# WO-951 — Import a .gtzip lower third (NewTek LiveGraphics-style) as a CG Studio template

**Area:** media, godot-client
**Status: DONE (05.11.26 — 5 new smokes + related 13/13, lint / unwired-exports / file-lines / require-integrity green; the owner's file imported on the second dev box and played in Caspar, in / out animations and accent recolour probed) — owner QA**

Owner 05.11: *"see if we can import this kind of lower thirds templates like the one attached in the gtzip"*
(attached: `Kopia belka ekf - nalezy dopasowac  kolor.gtzip` — "copy of the EKF bar, the colour must be matched").

Related: [WO-950](./950_WO_dock_colour_picker.md) (the colour picker, to match the colour the file name asks for).

## 1. Investigation

- A `.gtzip` is a plain ZIP: `document.xml`, `resources.xml`, one entry per image named by GUID, `thumbnail.png`.
- `document.xml` is declared `encoding="utf-16"` but the bytes are ASCII, so a strict XML parser refuses it. The
  declaration is dropped and the encoding is taken from the bytes (BOM / zero-byte check).
- The structure is a WPF/XAML-like `<Composition Width="1920" Height="1080">` of `<Layer Location Dimensions>`s, each
  with its own inner `<Composition>` of `Rectangle` / `Image` / `TextBlock` (+ `Ellipse` in the schema). Colours are
  `#AARRGGBB` brushes; `Skew` is an effect; `Rectangle.Mask` references a mask object.
- Animations are `<Storyboard>`s of `Fly` / `Expand` / `Fade` / `Rotate` with `Object`, `Delay`, `Duration`, `Direction`,
  `Interpolation`. The untyped storyboard plays in, `Type="TransitionOut"` plays out, `Page1` is a page change.
- `resources.xml` maps the `Bitmap Source` path (`folder\IMAGE1.gif`) to the GUID entry holding the bytes.
- The owner's file: 7 elements (Grey / White rectangles, Logo image, Rectangle End, a skewed + masked Vertical
  Line, Description, Headline), 7 in-animations, 2 out-animations, a Page1 storyboard.
- CG Studio lower thirds are HTML on the lt-engine contract (`template/studio/lt-*.html`,
  `LTEngine.init({ titleSel, subtitleSel, applyStyles, animateIn, animateOut })`, GSAP).
  `src/cg-studio/studio-lt-defaults.js` reads the baked h1 / `div.subtitle p` text and the `:root` `--primary` /
  `--text` variables, so an import that emits that shape is listed, taken and edited like any studio export.

## 2. What was done

- `src/cg-studio/gtzip-import.js` — parse: byte-sniffed XML decode, layers flattened to canvas px (document order =
  stacking order), solid fills, Skew, images found through resources.xml, text (font, size, weight, alignment,
  "Shrink" auto-size), the in / out storyboards. Everything not mapped goes to `warnings` (masks, gradients, other
  effects, other storyboards, unknown shapes) — never silently dropped. `importGtzip` writes `lt-<slug>.html` +
  `assets/lt-<slug>/` and never overwrites (`-2`, `-3` …).
- `src/cg-studio/gtzip-import-html.js` — the template: absolutely placed elements; largest text → title `<h1>`, next →
  subtitle `div.subtitle p`; the most-used saturated fill → `var(--primary)` and a single text colour → `var(--text)`,
  so the inspector's Primary / Text colour re-colour the import (what the file name asks for). Shrink text fits its box on
  every play; Fly / Expand / Rotate / Fade become GSAP tweens with the same delay / duration / direction / ease; no
  out-storyboard = a fade.
- `src/api/routes-lower-third-gtzip.js` + `routes-lower-thirds.js` — `POST /api/lower-thirds/import-gtzip
  { name, data: base64 }` → `{ ok, id, casparPath, fields, warnings }`; 400 missing, 413 over 7 MB (base64 stays
  under the 10 MB body limit), 422 not a .gtzip.
- Godot client: Media panel "+" menu → "Lower third template (.gtzip)…" (`media_add_menu.gd`), a file dialog, the result
  line (id + warnings) and a switch to the Templates tab (`media_panel.gd`).
- `src/engine/timeline-playback-runtime.js` — the WO-949 `_hydrate` method became the module function
  `hydrateFromProject(eng, id)`: as an exported method it was a new orphan for `check-unwired-exports` (the baseline may
  only shrink). Same behaviour.

## 3. Verified

- `tools/smoke/smoke-wo951-gtzip-import.test.js` (curated in `offline-test-files-3.js`): 5 tests — decoding, the
  composition model, the template against `studio-lt-defaults` / `parseInitSelectors`, file writing with free ids,
  the API's status codes. With the WO-949 / WO-598 smokes: 13/13. eslint, `check-unwired-exports` (no new orphans),
  `check-max-file-lines`, `check-require-integrity` green.
- The owner's file on the second dev box → `studio/lt-kopia-belka-ekf-nalezy-dopasowac-kolor` (+ `image1.gif`,
  `thumbnail.png`). Warnings shown: the Vertical Line's mask (drawn unmasked), the Page1 storyboard.
- Listed with the defaults title HEADLINE, subtitle Description, primary #50adcc, text #000000; Caspar `TLS` shows it.
- Played in Caspar on PRV ch3: layout as the thumbnail; in and out animations probed frame by frame, directions right;
  `primaryColor #e01b24` → the accent pixels read (224, 27, 36).
- Godot: the menu item, the file dialog and the result line used on the box.
- After the hydrate refactor: deployed, server restarted clean; against the real stored project the function loaded
  "ZZ ramp" into an empty engine and logged "loaded from the stored project".

Owner QA: import your other .gtzip files — anything the importer does not map is listed in the result line; masks and
gradients are the likely ones.
