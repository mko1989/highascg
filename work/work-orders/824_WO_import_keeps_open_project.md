# WO-824 — Opening a show file trashes the project that was open

**Area:** devices-config
**Status: DONE (29.10, smoke 6/6 + WO-821 10/10 + WO-823 8/8 + suite 3626/0/2; live check in the deploy round) · live e2e 29.10: PASS on the box (journal line, mhp_harder kept and not trashed, reloaded)**

## Investigation

Side observation of WO-823 ("Loading a file therefore trashes the project that was open").

- `/api/project/save` and `/api/project/autosave` both treated **any** change of name as a rename:
  `if (prevSlug && prevSlug !== slug) retireSlugWithReplication(ctx, prevSlug, { reason: 'rename' })`
  (HEAD `src/api/routes-data-project-handlers.js:78-86` save, `:451-459` autosave). `prevSlug` is the active slug.
- Godot "Load from file" (`godot/client/app/header_project.gd` `_load_file`) stores the file through
  `/api/project/save` under the file's own name → the open show is moved to `projects/_trash/` and a replication
  tombstone goes to the peers. The web import (`client/lib/project-import-flow.js`, `source: 'file'` / load modal)
  imports into the client state and its autosave posts the show under its own name → same result.
- Recoverable from `_trash/` by hand, but the open show silently disappears from the project list, and peers
  retire it too (`replication/project-tombstone.js`).
- Second hole, same root: WO-821's "a rename of a held project: the hold moves with it"
  (`src/engine/project-hardware-hold.js:72-74`) fired on every new name. A different show saved/autosaved while the
  open show was held (loaded without its hardware) inherited the **open show's stored rig**.
- Trap found while writing the smoke: the autosave handler replaces the payload's looks with the live deck
  (`enrichProjectScenesFromLiveDeck`, `src/engine/project-scenes-load.js:119`). Until the importing client's
  `scene_deck_sync` lands, the deck still holds the open show, so a rename check on the enriched copy compares the
  open show with itself and always says "rename". Reproduced in the smoke (`ctx.sceneDeck` is set by the first save).

## What was done

- `src/api/routes-data-project-slug.js`: `previousSlugKind(prevSlug, slug, payload, {imported})` →
  `null | 'rename' | 'imported' | 'other_show'`, decided **before** persisting (reads the previous project from
  disk). `other_show` = no/low look overlap, the existing `isLikelyStaleProjectReplace` heuristic (the same one that
  guards stale-tab replaces), so a rename that keeps the show's looks still counts as a rename.
  `retireRenamedSlug(ctx, prevSlug, slug, kind)` retires only on `'rename'` and logs why it kept the old slug.
- `src/api/routes-data-project-handlers.js`: save — `imported` = `keepPayloadHardware` (only Godot's Load from file
  sends it, WO-823); autosave — judged on the **client's payload**, not the deck-enriched copy. Both pass
  `prevSlug` to `stampProjectHardware` only for a rename, so the WO-821 hold moves (and `captureHardware` releases
  the previous hold) only when the previous project really is being renamed away.
- `src/engine/project-hardware-hold.js`: the keepPayload branch no longer releases the previous slug's hold (that
  project now stays, and so does its hold).
- Why not "never retire on save": a real Save As/rename from the name field must still drop the old slug, or every
  rename leaves a duplicate show behind (that is what the retire was added for).

Residual risk (not changed): the autosave stores the deck-enriched looks. If an importing web client's deck sync
were lost (WS down) and only the autosave arrived, the imported show would be stored with the open show's looks.
In normal operation the deck sync goes out after 100 ms (`client/lib/app-scene-deck.js:45`) and the autosave after
3 s (`client/app.js` `scheduleAutosave(3000)`), so the deck is current first. Godot uses the save path (no enrichment).

## What was verified

- `tools/smoke/smoke-wo824-import-keeps-open-project.test.js` 6/6: Godot import keeps the open show (even a copy
  with the same looks); web-import autosave of another show keeps it with the deck still holding the open show;
  save and autosave renames still retire; the held open show keeps its hold; another show does **not** inherit
  the held rig while a real rename still carries it. Mutation check: putting `prevSlug` back into the autosave stamp
  fails the hold test.
- WO-821 smoke 10/10, WO-823 smoke 8/8 unchanged; offline suite 3626 pass / 0 fail / 2 skipped; 0 files over 500
  lines; eslint clean on the touched files (one pre-existing warning in the load handler).

## Live e2e (29.10, on the glass — real Godot client on :0, real PGM/PRV)

**PASS.** With mhp_harder open, a copy of a project JSON (its `name` changed to `wo824_import_copy`) was opened
through Godot right-click Load → "Load from file…".
- Journal at 20:21:35.237: `[project] "wo824_import_copy" imported: the previous project "mhp_harder" stays in the list`.
- `GET /api/project/list` still had mhp_harder, and it was not in `projects/_trash`.
- mhp_harder was reloaded at 20:21:56 with 22 looks. ch1 = Intro, ch2 = Intro and ch4 = blackFHD match the start.
- Cleanup: `DELETE /api/project/wo824_import_copy` (→ _trash) and an rmdir of the empty
  `media/projects/wo824_import_copy`. The import had also pushed `bridge/projects/wo824_import_copy.json`, which was
  moved to the scratchpad. The list is back to 57 projects.

Evidence: session scratchpad `live-e2e/` (screenshots were read before they went in here; `onair.log` has every click with its epoch).
