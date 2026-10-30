# WO-740 — Help pages (Markdown) in a modal: PSN output per lighting desk, calibration guides

**Area:** godot-client, lighting
**Status: DONE (24.10.26) — four pages behind "?" buttons. Verified by Godot 21574/0 and offline rendering
screenshots; full gates green. Owner-QA: open each "?" on the kiosk after the next client restart. The MagicQ
depth-axis note (below) is the owner's decision.**

Owner, 24.10: *"add md help files that can be opened in a modal for things like psn output to different lighting
desks, how to set it up on that desk. calibrating should also have a guide."*

## Investigation

- No help system existed in the Godot client: no prior WO (`rg -il help work/work-orders` → only unrelated hits), and
  the only in-app guidance is muted how-to text and tooltips in each section.
- Where the owner needs the guides:
  - PSN output: Previs → Camera → Follow, `features/previs/tracking/follow_output.gd` (WO-631). Its status line says
    only "On the console: PSN input, map tracker ids to fixtures", with no per-desk steps.
  - Calibrate heads: Previs → 3D → Lighting → "Calibrate heads" fold (`fixtures_section.gd:156`,
    `calibrate_fold.gd`, WO-700 R7 + WO-713 R1).
  - Calibrate tracking cameras: Previs → Camera → Calibrate, `tracking_page.gd` "Calibration points" (WO-616 T3b,
    WO-713 R3 `person_mark_row.gd`).
  - Calibrate a PTZ camera: `ptz_calibrate_fold.gd` (WO-713 R2), its own toggle row.
- The guides have to match the real UI. Reading the code changed the first draft: in Lighting mode
  `calibrate_section.gd:71` hides **Apply pose** (each pin saves itself, WO-700 R7), so the guide says each pin is
  saved at once.
- Export: all three presets in `godot/client/export_presets.cfg` had `include_filter=""`. A `.md` file is not a
  Godot resource, so an exported client would ship without the pages.
- RichTextLabel takes BBCode, not Markdown, so a small converter is needed. A literal `[` in the text has to be
  escaped (`[lb]`) or it opens a tag.
- The kiosk has no browser, so outside links can only be shown, not opened.
- **Desk research** came from a research subagent (sources: MA, ChamSys and ETC manuals, release notes and forums). I
  checked the load-bearing claims myself.
  - **grandMA3** (v1.7+): Menu → In & Out → PSN, Enable Input, Insert new System, Requested = Yes. The multicast IP
    is entered by hand. Tracker ID ↔ Marker ID (CID). MArker in Moving mode, with a DMX address, on a Prio-merge
    universe. XYZ is on in the fixture type.
    - Axes X+ stage left, Y+ upstage, Z+ up (patch_position_fixtures): exactly our `stage`.
  - **grandMA2** (v2.9+): Setup → PSN Network Configuration; View Tracker → Fixture ID = StageMarker. Axis remap
    from v3.8. Axis signs are not stated in the help, so they're marked unconfirmed on the page.
  - **MagicQ**: Setup → View Settings → Network → Tracker Rx = PSN/SpotMe. PSN Function "Normal PSN 1" maps PSN
    id 1 to tracker 1. Our marker ids are 1..MAX (`src/tracking/marker-hub.js:40`), so the default "Normal PSN 0"
    would shift every number. PC/Mac needs an unlocking interface.
  - **Eos, Hog 4/5, Titan, Onyx**: no PSN input in any official manual or release note. Eos and Hog have open
    feature requests. Avolites Capture (a visualiser) reads PSN, which does not drive Titan.
- **MagicQ depth axis: a real mismatch.** I fetched the MagicQ trackers manual myself: *"MagicQ and PSN use the same
  XYZ space (X and Z horizontal, Y vertical)"*, *"PSN has Z positive towards the back of the stage"*.
  - Our `y_up` (`src/fixtures/psn.js:55`) sends `z = −Y`, i.e. depth positive toward the audience, following the
    right-handed reading of the PSN spec text (WO-631).
  - So on MagicQ the depth arrives mirrored. Neither of our axis choices is right for MagicQ out of the box.

## What was done

- `godot/client/app/markdown_bbcode.gd` (new, pure): the Markdown subset the pages use, converted to BBCode.
  - Blocks: `#` / `##` / `###` headings, paragraphs (lines joined), `-` bullets with two-space nesting, `1.` steps,
    `>` notes, `---` rules, and `|` tables with a separator row.
  - Inline: bold, italic (not inside words such as `snake_case`), code, and `[text](target)` links.
  - `title()` returns the first `#` heading.
- `godot/client/app/help_dialog.gd` (new):
  - `button(topic)` makes a flat "?" with the tooltip "Help: ‹page title›".
  - `beside(control, topic)` puts a control and its "?" in one row.
  - `open()` shows a modal AcceptDialog with a selectable RichTextLabel, sized to 80 % of the window (at most
    900 × 760) and titled with the page title.
  - A link to another `.md` page switches the page in place. A missing page shows a one-line notice.
  - Topics resolve inside `res://help/` only (`get_file()`).
- `fold_section.gd`: an optional third argument `help` puts the "?" on the fold's title row. A fold without it is
  unchanged.
- The "?" buttons:

  | Where | Page |
  |---|---|
  | Calibrate heads fold title | `calibrate-heads.md` |
  | "Calibration points" heading | `calibrate-cameras.md` |
  | the PSN / Art-Net protocol choice | `psn-output.md` |
  | "Calibrate on a person" toggle (PTZ) | `calibrate-ptz.md` |
- Pages, in `godot/client/help/`:
  - `calibrate-heads.md`: marks, pinning, a person on the mark, the beam offset, and what to do when it looks wrong;
  - `calibrate-cameras.md`: grid, clicking, Solve, Fit lens, RMS, and a person on a mark;
  - `calibrate-ptz.md`: hold, jog, pins, Done.
  - `psn-output.md`:
    - what this box sends (group, port, rate, ids, units, axes);
    - a desk table (PSN input yes/no and which axes to pick);
    - step-by-step grandMA3, grandMA2 and MagicQ setup;
    - the four desks without PSN, with Art-Net backup as their route;
    - network / IGMP querier;
    - an axis walk-test.

    Statements the sources don't confirm are marked as such on the page.
  - **MagicQ depth: documented, not changed in code.** The page says to pick Y up and set a negative Z scale per
    tracker in MagicQ (Macro → View Autom → View Trackers; MagicQ documents negative scales), then walk-test.
    - Why not change `psn.js`: it is a live output, `y_up` follows the spec's right-handed text, and there is no
      MagicQ here to test against.
    - Owner decision: a third axes option ("Y up, depth upstage") would remove the desk-side step. It is ~3 lines in
      `psn.js` plus the Godot choice and the smoke.
  - The pages link to each other.
- `export_presets.cfg`: `include_filter="help/*.md"` on all three presets.
- `godot/client/tests/test_help_pages.gd` (new):
  - blocks, inline marks and escaping, tables;
  - every page loads, has a title, and every link between pages resolves;
  - a topic cannot leave `res://help/`;
  - "?" button and fold row;
  - each wiring pin and the export filter.

## What was VERIFIED

- Godot `--test` **21574 passed / 0 failed**. The new `test_help_pages.gd` covers:
  - every page loads and has a title;
  - every link between pages resolves;
  - a topic cannot leave `res://help/`;
  - the converter's blocks, inline marks, escaping and tables;
  - the "?" buttons and the fold row;
  - each wiring point and the export filter.
- Godot `--check`: boot OK, no script errors.
- `tools/smoke/smoke-wo700-calibrate-heads-lighting.test.js` pins the exact fold line. It was repointed to the new
  form (`…[CalibrateFold.new()], "calibrate-heads"))`), keeping its "just below the Programmer" order assertion.
  14/14.
- Clean export (`git archive` + the changed files):
  - repo-integrity OK; 0 files over 500 lines; no new unwired exports; prettier clean; `index.js --no-http` boots;
  - `test:ci`: 3194 tests, 3189 pass, 3 skipped, 1 fail (WO-498, export-only). The wo700 fail in that first run is
    the pin above, fixed.
  - Lint in the repo: 214 warnings (cap 216), 0 errors.
- Rendering: the real `help_dialog.gd` was opened in a 1600×1000 Xvfb window by a scratch SceneTree script, and
  screenshots were read.
  - The first render showed two defects, both fixed and re-rendered:
    - no space between blocks;
    - a wrapped step line falling out of its numbered item.
  - The final renders of the calibrate-heads, PSN and list test pages show headings, steps, nested bullets with a
    hanging indent, numbering resuming after a nested list, tables and notes.
- Not yet done on the kiosk (owner-QA): the "?" in each of the four places, after the client is restarted on the new
  build.
