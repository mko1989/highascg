# WO-1072 — Match the project to the lighting console's head positions (MagicQ CSV)

**Area:** lighting, tracking-vr, godot-client
**Status: IN PROGRESS (14.11.26 — matcher live and run on the owner's real MagicQ export; export tested against MagicQ PC 1.9.8.3 on a hidden display; not tried on the real desk)**

Owner, 14.11: *"how do i make sure that our 0,0,0 points align from the start"* … *"how can we automate it so highascg
matches chamsys positions"* … *"yes lets do the import csv matching."*

## Investigation

1. **Why the origins differ.** HighAsCG shows an MVR moved by `project.previs.mvr.place`
   (`godot/client/features/previs/mvr_model.gd` `placement`), while the MVR staged for MagicQ keeps the file's matrices
   byte for byte (`src/vr/magicq-mvr.js`). Head 1 of "Narvil IDE 11.2026": file 10.05 / 59.10 / 5.73, ours −3.95 / 9.10 /
   5.73 with Place −14 / −50. The desk's own patch had head 1 at X −9, Y 5.5 (up), Z −9.
2. **What depends on the frame.** PSN output (`src/fixtures/psn.js`, axes `y_up`: x = X, y = Z, z = −Y) sends hub-frame
   marker positions to the desk, which aims its own heads from its own patch positions. So the two frames must agree.
3. **MagicQ sends no positions over OSC** (`/opt/magicq/manual/magicq/manual/OSC.html`: playback / execute feedback and
   cue-stack macros only). It prints them: Patch → View Heads → File → Print Window → Create CSV. Its CSV import has a
   "Vis only" mode for the other direction (`patching.html`, "Importing Heads").
4. **What sits in the stage frame in a project:** `previs.mvr.place`, `previs.stage.objects[].position` (Godot frame),
   `previs.tracking.grid` offsets, `previs.tracking.cameras[].cam.pos_*` and `.points[].world`, `previs.tracking.ptz[].pose`,
   `fixtures.patch[].pose`, `fixtures.marks[]`. `aim_z` is relative to the marker and stays.
5. **Done by hand first (14.11, after the show):** the live project moved by −5.052 / −0.102 / −0.225 from the one head
   the owner read (autosave POST, rev 1189 → 1190; backup `~/highascg-backups/narvil-before-origin-shift-2026-11-14.json`).
   One head cannot tell a shift from a mirrored or differently spaced rig — hence the fit over all heads.

## What was done

- `src/fixtures/console-match.js` (pure): `parseCsv` (the manual's column headings, `,` / `;` / tab, mm → m,
  "1-001" addresses), `pair` (universe + address with offset 0 or +1, else head number through `console-fid-map`),
  `fit` (median offset per axis, per-head error, turn of the plan, mirrored-plan detection), `shiftProject`, `setHeads`.
- `src/api/routes-console-match.js`: `POST /api/fixtures/console-match { csv, apply? }` — preview without `apply`;
  `'shift'` moves the project, `'heads'` also gives every paired head the console's position; a mirrored plan is
  refused. The write goes through the autosave handler so clients reload it as a remote sync.
- Godot: Previs → Fixtures → fold "Match console positions" (`console_match_fold.gd`, text in `console_match_model.gd`).
- Translation only on purpose: the tracking stage has no rotation, so a turned rig is reported, not applied.

## Verified

- `tools/smoke/smoke-wo1072-console-match.test.js` 5/5 (in the curated list); offline suite 6231 pass, 0 fail.
- Godot `--test` 28486 passed, `--check` boot OK. Line limit, unwired exports, lint, format, `--no-http` clean.
- NOT verified: a real MagicQ export (the owner's first file was a PDF print, the box has no PDF text tool); the
  fold in the running client; the route on the running server (needs a node restart). Hub markers held by an
  operator pin are runtime state and do not move with the project.

## 14.11, later — the real desk data, and the other direction

- **The owner's MagicQ exports** (`~/Documents/…tamoos-narvil-Positions.csv`, `…Truss_and_Pipes.csv`): the preview on the
  running server paired 90 of 90 heads by DMX address (universe offset +1) and reported an average leftover of 14.4 m,
  48.5 m at worst, plan turned 35.8°. The desk's positions are MagicQ's plot: heads spread evenly along 22 m trusses
  at Z 3 / 9 / 15 …, heads 1–14 all on "TRUSS 1" at one height. Not the rig. Nothing was applied.
- **The 14.11 hand move was undone** (inverse shift through the same code; poses equal the pre-move backup to 1e-14).
- **Patch addresses taken from the desk** (`tamoos-narvil_PATCH.csv`, by head number): 18 heads re-addressed
  (Quantum 6–14, Pixel Strobe 708–712, Pixel Line 1042–1045); 90 of 90 now equal, no overlaps (`/api/tracking/follow`).
- **Export added:** `exportCsv` + `GET /api/fixtures/console-match/export` + the fold's "Export our positions for the
  console…" — head number, DMX, X / Y / Z (console frame) for MagicQ's Import Heads → "Vis only". Rotations are not
  written. NOT verified: that MagicQ's Vis-only import accepts the file and what it does to rotations.

## 14.11, evening — the export tested against MagicQ PC (owner: "test it against the magicq ran on virtual display")

MagicQ PC 1.9.8.3 on Xvfb :99 with the owner's show (`lastshow.shw` = tamoos-narvil), driven with xdotool; its console
files were backed up first and put back afterwards, MagicQ and the Xvfb stopped. Patch → View Chans → Import Heads →
the CSV → "Vis data only", then Patch → View Vis → Vis Heads read from screenshots.

- **Positions:** head 1 −3.95 / 5.73 / −9.10, head 6 −6.02 / 2.95 / −4.06, head 21 2.46 / 6.04 / 10.99, Pixel Line 1001
  −3.59 / 6.07 / −9.06 — the file's values, two decimals. Patch (DMX, head numbers, names) untouched.
- **Bug found and fixed:** MagicQ drops the last character of a line's last field — `RotZ` 180 arrived as 18.0 on the
  floor heads. Every row now ends with a comma (`exportCsv`); the re-import shows Y rot 180.0 / Z rot 180.0 on heads 6–10
  and X rot −68.8 on the Pixel Lines.
- **Rotation direction:** head 1 imported with X Rot +45 → in the visualiser's side view its lens end swings towards
  the upstage wall (−Z). The previs's `Basis.from_euler` pitch does the same (−Y → −Z), so pitch → X Rot keeps its sign.
- NOT checked: the five heads with two angles (1041–1045: Y 68.82, Z −90) against MagicQ's rotation order; the real
  desk. MagicQ's own trusses / stage and its 42 heads HighAsCG does not have stay where MagicQ drew them.
