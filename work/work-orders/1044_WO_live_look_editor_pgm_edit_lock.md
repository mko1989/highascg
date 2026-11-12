# WO-1044 — Live tab: "PGM edit" — open the look editor on the look on PGM, edits go to air

**Area:** godot-client, engine
**Status: IN PROGRESS (12.11 — built; server smoke 7/7, Godot suite 28099/0, `--check` boot OK; live route answers on the box; an on-air edit not yet driven — the owner was taking looks on PGM during the session)**

Owner, 12.11 (with the PixelHue P80 work, WO-1042): *"there is also pgm edit for the screens"* — clarified: *"the lock
is for looks programming in the live tab, so i can edit the look that is currently on pgm"*. PixelHue screens carry a
per-screen `pgmEdit` flag (0 = PGM locked; HighAsCG shows it in the PixelHue tab, `programming_bands.gd:71`, and
`pixelhue-read.js` `pgmLocked`). First built as a per-screen lock in the editor header; the owner then (same evening):
*"instead of PGM-edit lock. i need a button PGM-edit between the ftb and timer that will bring the look editor of the
current pgm."* — the lock was replaced by that button before it shipped (commit 95673f26 had the lock).

## Investigation

- The Godot look editor (`godot/client/features/live/look_editor.gd`) only ever edits **PRV**: every edit →
  `preview_pusher.gd` → `POST /api/scene/preview-push {sceneId, mainIdx}` (`src/api/routes-scene-preview-push.js`),
  which nudges or re-takes the look on the main's PRV channel. Opening the editor on the look that is on PGM stages a
  copy on PRV; the change reaches air only with TAKE. There was no way to edit the on-air look in place.
- The web client had exactly this as WO-272 "edit live on PGM" (`client/components/scenes-editor.js:408`,
  `scenes-preview-runtime.js:262 pushEditsToPgmLive`, `scenes-preview-runtime-mixer-nudge.js:100`): geometry edits →
  `/api/preview/mixer-nudge` with `target: 'pgm'` (bank-aware, staleness-guarded against what is live on the program
  channel — `src/api/routes-preview-nudge.js:18`), content edits → a forceCut `/api/scene/take` at the program channel
  with `previewExchange: false`. The server half (PGM nudge) survives; the Godot port (WO-600) never carried the mode.
- **Found on the box while testing (would have bitten on air):** the live entry and the look name the same file
  differently. Live ch 2 held `projects/narvil/Czarek 35 lat.mp4`, the stored look `Czarek 35 lat.mp4` (another take a
  minute later stored the bare form). `decidePreviewPush` compares the raw values, so an *untouched* look on air read
  as new content → `take` — the first nudge-sized edit with PGM unlocked would have cut-restarted the clip on air.
  Reproduced offline with the box's live entry + project: `stored→ take`; with canonical media ids `→ nudge`.

## What was done

- `src/api/routes-scene-pgm-edit-push.js` (new) — `preview-push` with `target: 'pgm'`: the PRV decision rule made
  against what is **live on the program channel**:
  - only the look that IS on air on that screen is pushed (409 `not_on_air` otherwise — an edit never puts a look on air);
  - geometry / opacity / crop / effects → PGM MIXER nudge (the existing WO-272 `target: 'pgm'` path); the live entry is
    then updated in place, keeping its take time (`updatedAt`: clip clocks, timers) and its global-border slot;
  - content changes → a forceCut program take of the same look with `previewExchange: false` (PRV left alone);
  - the nudge reporting the look left air inside the take chain → 409, never a re-take;
  - a look edited down to no sources → 409 (blanking a screen is a take, not an edit);
  - media ids compared canonically (project-relative expanded under the active show, NFC, any case — `canonValue`).
- `src/api/routes-scene-preview-push.js` — routes `target: 'pgm'` to it (after the cluster relay, so a screen on
  another server gets the target too via `dest.preview`).
- `src/api/routes-scene-take-look.js` — passes `previewExchange: false` to the take engine for program takes, and
  through the cluster relay (`relayArgs`).
- Godot:
  - `features/live/deck_head.gd` — "PGM edit" in each screen column between FTB and the timer; disabled when nothing is on
    that PGM; emits `deck_view.pgm_edit_requested(look on PGM, main)` → `live_tab.gd` → `editor.open(id, main, true)`.
  - `features/live/look_editor_pgm.gd` (new) — the rule `goes_to_pgm(scene, pgm_session, pgm look)`, the PGM look of a
    main exactly as the deck resolves it, and `refresh(ed)` when PGM changes under the open editor (another look taken:
    frame and title go back to PRV, "No longer on PGM — edits go to PRV"; nothing is pushed by itself).
  - `look_editor.gd` — `open(id, main, pgm)`: a PGM session does not push on open (no re-take, no PRV staging), hides
    TAKE, titles `→ PGM ● LIVE` in red; the session ends on close or when a card opens another look; re-evaluated on
    `scene.*` store changes.
  - `preview_pusher.gd` — asks `to_pgm` per push and adds `target: 'pgm'`; status reads `PGM: nudge` / `PRV: …`.
  - `look_editor_backdrop.gd` — the frame shows the `pgmN` surface while editing air (`backdrop_bus` meta).

Why a server mode rather than the web's two client calls: the Godot editor already hands every decision to the server
(WO-598 C2); one target flag keeps that, and the staleness / not-on-air rules live in one place.

## What was verified

- `tools/smoke/smoke-wo1044-pgm-edit-push.test.js` (curated, `offline-test-files-3.js`): 7/7 — geometry → PGM nudge on
  the program channel + live refresh; content → `{target: 'program', forceCut: true, previewExchange: false}`; not on
  air → 409 with no nudge/take; left air mid-chain → 409, no take; last source removed → 409; the two-names case →
  nudge; take-look carries the flag (both paths). Every smoke touching preview-push / take-look: 154/154.
- Godot: `tests/test_look_editor_pgm_wo1044.gd` (rule; FTB · PGM edit · timer order; opens in a PGM session); suite
  28099 passed / 0 failed (an earlier run hit the timing flake in `test_pixelhue_programming_panel` coalescing, unrelated).
  `run-client.sh --check` boot OK — the Live tab builds the editor, so the edited scripts compile with autoloads.
- `npm run format:check`, `check-max-file-lines` (look_editor.gd 480 lines) clean.
- On the box (node restarted on this code): `POST /api/scene/preview-push {Look 17, mainIdx 0, target pgm}` while ch 2
  played another look → `409 not_on_air`, no AMCP on channel 2 (Caspar log). Offline against the box's own live entry
  and project: the untouched on-air look decides `nudge` (was `take` before the canonical compare).
- **Not yet proven on air:** a PGM-edit session through the GUI (nudge visible on PGM, content edit cut). The owner was
  taking looks on PGM during the session (Czarek 35 lat twice, IDE intro bazowka); the GUI was not relaunched and air
  was not touched. The GUI picks this up on its next relaunch.
