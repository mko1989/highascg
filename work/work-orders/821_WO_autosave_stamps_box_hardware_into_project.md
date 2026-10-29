# WO-821 — Autosave stamps this box's hardware config into a project loaded without its hardware

**Status: OPEN (29.10, found during the WO-820 frontex_big check; not investigated further, no fix)**

## Investigation (what was seen)

- WO-820 real-content check, 29.10: `frontex_big` was loaded with `POST /api/project/load` and **applyHardware off**
  (17:01:48), so the box kept its own screens and destinations while the show's looks ran.
- At 17:10 the node restarted (Caspar binary swap). A client autosave after the restart overwrote
  `projects/frontex_big.json` and its `_autosave` copy: the show's own screen and destination setup
  (`hardwareConfig`) was replaced with this box's.
- Cause on the write path: `POST /api/project/autosave` calls `injectHardwareConfigToProject(ctx, project,
  { preserveWhenEmpty: true })` (`src/api/routes-data-project-handlers.js:386`). That guard only keeps the stored slice when the
  live config is *empty* (the WO-311 factory-reset case). A live config that is simply *different* (the project was
  loaded without applying its hardware) is written over the project's own.
- Both files were restored from backups taken before the test (md5 3cde5978).

## Why it matters

Opening a show project on a box with different hardware (a second server, a rehearsal box, a test like this one)
without applying its hardware silently rewrites the show's hardware slice on the next autosave. The show then
arrives at the venue with the wrong screens.

## Open questions for the fix

- Should a project loaded without its hardware be marked so that its autosaves keep the stored `hardwareConfig`
  until an explicit apply or save?
- Which UI paths can load without applying hardware? Only the API flag, or also the Godot/web project load?

## Verified

Nothing yet. The restore of the two frontex files is the only action (md5 checked 29.10).
