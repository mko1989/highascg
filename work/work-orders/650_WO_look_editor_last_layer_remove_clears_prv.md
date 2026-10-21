**Status: DONE (2026-10-21; smoke 26/0 over the preview-push suites, node restarted clean). Owner QA: remove the only layer of a look in the Godot look editor → PRV goes empty at once.**

# WO-650 — Look editor: removing the only layer leaves it on PRV until the editor closes

Owner, 21.10: *"it also doesnt let me delete an only layer in a looks editor. i can click delete but it kindo f stays
there and lingers till i close the looks editor."*

## Investigation

- `godot/client/features/live/look_editor.gd:410` `_remove_layer()` takes the layer out of the look, clears the list
  and schedules a PRV push (`preview_pusher.gd` → `POST /api/scene/preview-push`). The editor itself is right: the
  list is empty and the frame draws no box.
- `src/api/routes-scene-preview-push.js` `decidePreviewPush`: a look with no sourced layer always takes the `take`
  path (`sourced.length === 0 → 'take'`).
- The take refuses an empty look: `src/engine/scene-take-lbg.js:82` throws *"incomingScene has no layers with sources
  — cannot take an empty look"*. Nothing clears PRV, so the removed layer's picture stays there. `look_editor.gd:134`
  already knew that rule for a new empty look ("the take route refuses a look with no sources").
- PRV changes again only when something else is staged (closing the editor, another look). That is the "lingers till
  I close" part.
- A clear already exists: `POST /api/scene/live/preview/clear` (`routes-scene-preview.js handlePreviewLiveClear`). It
  stops the PRV look-stack layers on the per-channel take chain and drops the live-map entry. The web uses it
  (`client/lib/scene-live-sync.js:66`).

## What was done

- `routes-scene-preview-push.js` `handlePreviewPush`: when the look has no sourced layer, it calls
  `handlePreviewLiveClear({ mainIndex })` and answers `mode: 'clear'`. The check runs after the PGM-only check, so a
  PGM-only main still answers `none`.
  - Done on the server, not in the Godot editor, so that every caller of preview-push gets the same rule, and the
    editor keeps one call per edit.
- `tools/smoke/smoke-wo598-preview-push.test.js`: an empty-source layer and a layer-less look both answer `clear`,
  and they never take.

## What was VERIFIED

- `node --test` over `smoke-wo598-preview-push`, `smoke-wo601-pip-preview` and `smoke-wo601-effects-nudge`: 26 pass,
  0 fail.
- Box: node restarted with the change, no errors in the journal.
- Not done on the box: the remove itself. The only look in the project is the owner's "Look 1" (one layer). Removing
  it here would edit the owner's look, so this is owner QA.
