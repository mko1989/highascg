# WO-785 — Better GDTF Share recognition of MVR heads

**Status: IN PROGRESS (26.10 — part 1 matcher DONE: smoke + evaluation on the owner's 18 placeholders against the live Share list; part 2 "Replace… lists Share candidates" OPEN)**

Owner, 26.10 (with WO-784):
> the auto recognition of heads doesnt work too well. need to work on that.

Parent: [WO-637](./637_WO_gdtf_share_auto_resolve.md) (Share auto-resolve of MVR placeholders).

## Investigation

The owner's MVR has 18 placeholder types. The matcher (`src/fixtures/gdtf-share-match.js` `rank`) was run against the
cached Share list (`~/.highascg/cache/gdtf-share-list.json`):

- **The tokeniser dropped the spaces.** `tokens()` went through `norm()`, which strips everything but `[a-z0-9]`. The
  token set of a name was therefore one word, and the word-subset test never matched.
- **A variant letter blocked the right file.** Capture's "Robin 600 LEDWash+" did not relate to Robe's "Robin 600X
  LEDWash" (all 6 footprints). "Robin 600 LEDWash" was taken at 5/6 coverage (0.80).
- **Firmware-variant modes held a factory file back.** Brighter X-Dot's placeholder has 9 modes (28/35/51/107/128 plus
  26/49/105/127). The factory file covers 5 of them (0.56), so it was only offered. All 24 heads in the scene use
  "28 Channel 3", and the file has that mode. The matcher never saw which modes the scene uses.
- **Types not on Share got nothing.** Micro Wash, ELP WW LED Profile and Teclumen came back `none` with no
  candidates. For ELP WW, Martin's own ELP CL (same body, different engine) is on Share.

## What was done (part 1)

- **`src/fixtures/gdtf-share-match.js`**
  - `tokens()` splits the raw lowercase name into words. `bareTokens()` does the same for a Share name with its maker
    prefix removed.
  - `nameRank` = 1 also when every word of one name is in the other: "Robin 600 LEDWash+" → robin 600 ledwash ⊂
    "Robin 600X LEDWash" → robin 600 x ledwash (letter and digit runs are separate words).
  - `similarity()`: Jaccard on the words.
  - `coverage(stubModes, shareModes, only)`: `only` limits it to the modes the scene patches.
  - `rank(stub, list, max, used)`:
    - Each candidate carries `used` (coverage of the patched modes) and the Share `modes`.
    - Sorted by used, then coverage, name, Manuf. upload, rating, newest.
    - Taken (`sure`) at coverage ≥ 0.75, or when every patched mode is covered under the same name (nameRank 0).
  - `loose(stub, list)`: when `rank` finds nothing, it returns candidates that are only offered, never taken:
    - a same-maker sibling with similarity ≥ 0.5;
    - or another maker's upload of the same name (similarity ≥ 0.99 after stripping the stub maker).
    - It keeps one entry per manufacturer|fixture, the best by similarity and then by rank.
- **`src/fixtures/gdtf-share.js`**
  - `resolve(ids, deps, used)` passes each type's patched modes to `rank`.
  - A `none` result carries `candidates: loose(...)` when there are any.
- **`src/api/routes-gdtf-share.js`**: the resolve body may carry `used: {typeId: [mode names]}`.
- **`src/api/routes-stage-mvr.js`** `handleTypes`: each type lists `used`, the distinct `fixture.mode` values of its
  objects in the scene.
- **`godot/client/features/previs/mvr_section.gd`** `_from_share` posts `{"ids", "used"}`.

Aliases (`projects/_gdtf/aliases.json`) take precedence. Existing ones are not changed, so the owner's Robin 600 alias
still points to 600 LEDWash until it is switched with Replace….

## Verified (part 1)

- `tools/smoke/smoke-wo785-gdtf-share-recognition.test.js`, 4 tests:
  - the variant letter now relates, and channel counts pick 600X;
  - X-Dot is offered without the patch info and taken with it, but not when a patched mode is missing;
  - loose offers return the re-upload first and the sibling once;
  - source pins for the API and client paths.
- Offline suite: 3386 tests, 3384 pass, 2 skipped. Lint 215 warnings (budget 216). Prettier OK. No file over 500
  lines. No new unwired exports. Godot `run-client.sh --check` boot OK.
- Evaluation on the 18 placeholders against the live list:
  - X-Dot is taken: rid 147670, with used = ['28 Channel 3'].
  - Robin 600 LEDWash+ now resolves to Robin 600X LEDWash (57382, coverage 1.0), up from 600 LEDWash at 0.80.
  - The other matches are unchanged.
- Live resolve after a server restart:
  - Micro Wash: none.
  - Teclumen: none.
  - ELP WW: none, with the loose offer ELP CL LED Profile rid 73188.
    - Both ELP CL revisions (73188 and 84089) cover the same share of the WW footprints.
    - 73188 wins on its rating (1.0 against N/A), even though 84089 has one more mode.

## Part 2 (OPEN)

- Replace… should list the Share candidates (`candidates`, including loose ones) next to the local library, and gain a
  route that takes the chosen rid: download, then alias.
- The owner's Robin 600 alias could then be moved to 600X from the dialog.
