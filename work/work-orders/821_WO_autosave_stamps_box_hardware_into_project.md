# WO-821 — Autosave stamps this box's hardware config into a project loaded without its hardware

**Status: DONE (29.10, offline smoke 10/10 + suite 3585/0/2 + sandbox e2e across a restart; not deployed live, owner QA pending)**

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

## Investigation 2 (29.10, code read)

### Root cause

The server has no memory of *how* a project was loaded. Every write path stamps the live config over
the project's hardware slice:

- `src/api/routes-data-project-handlers.js:37` (`/api/project/save`): `injectHardwareConfigToProject(ctx, project)`,
  unconditional.
- `src/api/routes-data-project-handlers.js:386` (`/api/project/autosave`):
  `injectHardwareConfigToProject(ctx, project, { preserveWhenEmpty: true })`.
- `src/engine/project-hardware-config.js:232-252`: the `preserveWhenEmpty` branch (line 236) only engages when
  the LIVE config has no operator intent (`hardwareConfigHasOperatorIntent`, edges or destinations). A box with
  its own cabling always has intent, so line 251 `project.hardwareConfig = hc` runs and the box's rig replaces
  the show's.
- `src/api/routes-data-project-handlers.js:197-200` → `src/engine/project-activate.js:194`: `applyHardware` is
  only used to decide whether to apply. Nothing records that the load skipped it.
- The server never applies a project's hardware at boot (`applyHardwareConfigFromProject` has one caller,
  `project-activate.js:196`). After the 17:10 restart the live config was still the box's, the active slug was
  still `frontex_big`, and the first client autosave stamped the box's rig. An in-memory flag would not have
  helped: the restart sat between the load (17:01) and the autosave.

### Paths that load a project without applying its hardware

| Path | applyHardware | Notes |
|---|---|---|
| `POST /api/project/load {slug}` without the flag (API, tools, the WO-820 test) | false (default) | the incident |
| Web load modal `client/components/load-project-modal.js:347` → `client/lib/project-files.js:157` `{slug}` | false | first step only |
| Web load modal `load-project-modal.js:286` `{slug, applyHardware:false}`, then `:292` `{applyHardware:true}` | false → true | the second call applies. It is skipped when the reconcile import returns `cancelled` (`client/lib/project-import-flow.js:168`) or when the import throws. The project is then left loaded without its hardware. |
| Web bootstrap `client/lib/project-load.js:40` `{}` (no slug) | false | re-reads the ACTIVE project. It must neither set nor clear anything, or every page load would change the state. |
| Godot header Load `godot/client/app/header_project.gd:138` | **true** | always applies |
| Godot load-from-file `header_project.gd:227` (save) then `:138` (load) | true | see "Pre-existing, not fixed" below |

Writes that are explicit saves but are not the operator capturing the rig:
- Godot `ProjectSync.save_now()` (`godot/client/core/project_sync.gd:163`) is also called by the stick dialog
  before copying the show to a stick (`godot/client/app/stick_dialog.gd:105`).
- Godot load-from-file posts `/api/project/save` (`header_project.gd:227`).
- Web header Save (`client/components/header-bar.js:128`), Ctrl+S in both clients. This is the gesture an
  operator makes after editing looks.

### Constraints from earlier WOs

- WO-76 §3.3: load must not apply hardware by default; applying is explicit. Its T76.B.4 ("keep
  `injectHardwareConfigToProject` on save/autosave only") is the rule this WO narrows.
- WO-311 / 5d01bca: an autosave must not stamp an empty (factory-reset) config, and a retired slug must not be
  resurrected (410 `project_gone`). The 410 check must still run before any write.
- WO-614 / WO-807: `preserveClientOwnedSlices(project, existing)` runs in both save and autosave before
  `persistProject`. `smoke-wo614-project-client-slices` pins exactly two calls with that text.
- WO-79: autosave pushes to the replication peer. Peers strip the machine slices (`stripDeviceLocalFromProject`),
  so this WO does not change replication.
- Test isolation: `.highascg-state.json` is machine-local (`.gitignore`/`.stignore`), and node:test redirects it to
  a temp file (`src/utils/persistence.js:16-20`). The sandbox uses `HIGHASCG_STATE_FILE`.

## Decision: an explicit hardware APPLY ends the hold, a plain save does not

A project loaded without applying its hardware is put on a persisted **hardware hold** (per slug, in
`.highascg-state.json` key `project_hardware_hold`). While it is held, save and autosave both write the
project's STORED `hardwareConfig` back unchanged. The hold ends when:

- the project is loaded with `applyHardware: true` (Godot Load, the second step of the web load modal), or
- hardware is applied to the active project through `POST /api/project/apply-hardware` (the "Apply project
  hardware" banner `POST /api/project/hardware-apply`, and the web reconcile `applyFull`), or
- `POST /api/project/save` carries `captureHardware: true`. This is the deliberate "take this box's rig into the
  show" escape hatch. No UI sends it yet.

Why apply and not save:
1. A plain save would cause the same damage the WO describes, only less silently. An operator who opens the show
   on a rehearsal box, edits looks and presses Ctrl+S still means "save my looks", not "replace the venue's
   screens with this box's".
2. Saves also come from automation: the Godot stick dialog saves before copying to a stick (`stick_dialog.gd:105`).
   If a save ended the hold, the show copied to the stick would carry the wrong box's rig.
3. Applying is the only gesture after which live hardware equals the project's hardware again. From that point,
   stamping the live config is correct again, and later Device View edits flow into the project as before.

Unchanged: a load without a slug (bootstrap) neither sets nor clears the hold, so the hold survives page reloads
and node restarts. WO-311's empty-config guard still applies when the project is not held. If a held slug has no
stored file (it was trashed, or the name is new), the hold has nothing to protect and the old stamping path runs.
A rename (the autosave name changes while the old slug is held) takes the old file's slice and moves the hold to
the new slug.

### Pre-existing, not fixed here

The Godot load-from-file flow (`header_project.gd:227`) posts the file through `/api/project/save`, which stamps
the live config, and only then loads it with `applyHardware: true`. The file's own `hardwareConfig` is lost before
the apply, so "load from file" never restores a file's rig. This is out of scope here: it needs a client change
in the live Godot tree. It should get its own WO.

## What was done (29.10)

| File | Change |
|---|---|
| `src/engine/project-hardware-hold.js` (new) | Per-slug hold in persistence key `project_hardware_hold`: `holdProjectHardware` / `releaseProjectHardware` / `isProjectHardwareHeld`. `stampProjectHardware(ctx, project, { slug, prevSlug, existing, autosave, capture })` is now the only place save/autosave set `hardwareConfig`. When the project is held, it writes the stored slice back (or no slice, if the stored file has none). When it is not held, or nothing is stored, it calls the old `injectHardwareConfigToProject` (the autosave keeps `preserveWhenEmpty`, WO-311). A rename takes the old slug's file and moves the hold. `capture: true` releases the hold and stamps the live config. |
| `src/api/routes-data-project-handlers.js` | save + autosave: `stampProjectHardware` runs after `slug`/`existing` are read (it needs both), and still before `preserveClientOwnedSlices` and `persistProject` (WO-614 order is unchanged). The WO-311 410 check is unchanged. load: a `slug` load without `applyHardware: true` holds the slug before activation. A load with `applyHardware: true` releases the slug after activation. A load with no slug does nothing. `apply-hardware` success releases the active slug. `new` releases its slug. The rename route moves the hold. |
| `src/utils/persistence.js` | `project_hardware_hold` added to `IMMEDIATE_KEYS`, so a load followed by an immediate restart keeps the hold. |
| `docs/wiki/api/project.md` | Documents the hardware hold and `captureHardware`. |
| `tools/smoke/smoke-wo821-hardware-hold.test.js` + `tools/ci/offline-test-files-2.js` | New smoke, registered in the curated list. |

Why a server-side persisted hold and not a client flag: the incident autosave came from a client after a node
restart. Only the server sees every write path (web, Godot, API, stale tabs), and only persisted state outlives
the restart. No client was changed. The web modal's second load (`applyHardware: true`) and Godot's Load already
release the hold.

## Verified (29.10)

- **Smoke** `tools/smoke/smoke-wo821-hardware-hold.test.js`: 10/10, running the real handlers on a private state
  file and projects dir. It covers: load without hardware → 2 autosaves (web-shaped, and Godot-shaped carrying
  a box `hardwareConfig`) → stored file and `_autosave` copy keep the show rig, fingerprint included; a bootstrap
  load `{}` and a plain save keep the hold; **restart**: a second `node` process on the same state file autosaves
  a real look edit (rev bumps), and the show rig stays; a rename moves the hold; load `applyHardware:true` releases
  it, and later autosaves take the live (rewired) rig; `apply-hardware` releases it; save `captureHardware:true`
  takes the live rig; a project that is not held still gets the live rig.
- **Mutation check**: with the pre-WO-821 stamping restored (a `--require` preload that swaps
  `stampProjectHardware` for the old `injectHardwareConfigToProject` call, no tree edit), 6 of the 10 tests
  fail. The 4 that pass are setup, cleanup, the not-held case and apply-hardware.
- **Offline suite** `node tools/ci/run-offline-tests.js`: **3585 pass / 0 fail / 2 skipped** (baseline
  3575/0/2, +10 new).
- `node tools/ci/check-max-file-lines.js`: 0 files over 500 (`routes-data-project-handlers.js` is 493).
  `npx eslint` on the touched files: 0 errors. One warning, `'slug' is assigned a value but never used` in the
  load handler, was already there at HEAD (checked with `git show HEAD:… | eslint --stdin`).
  `npm run -s format:check`: clean. `node tools/dev/gen-api-contract.js --check`: clean (no route changes).
- **Sandbox e2e** (`tools/e2e/sandbox-server.js`, own root and port, live server untouched). Script:
  `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo821-sandbox-e2e.js`.
  ```
  apply show rig → save wo821_show            → stored show_dst
  apply box rig                               → live box_dst
  load {slug}                                 → stored show_dst
  autosave 1 / 2 (rev 2, 3, changed:true)     → stored show_dst, _autosave show_dst
  state.json project_hardware_hold            → {"wo821_show":{"reason":"load",…}}
  sandbox stop + start (new pid), live box_dst, bootstrap load {} 200
  autosave after restart (rev 4)              → stored show_dst, _autosave show_dst
  plain save                                  → stored show_dst
  load applyHardware:true                     → live show_dst, hold null
  apply rewired rig → autosave                → stored rewired_dst
  ```
  server.log: `[info] [project] "wo821_show" loaded without its hardware: saves keep its stored hardwareConfig
  until the hardware is applied (WO-821)`, then `autosave kept the stored hardwareConfig …` ×3 (one after the
  restart) and `save kept …` ×1.
- **Not done**: no live deploy. The live node (pid 919403) was not restarted, because another agent is running
  live QA. Until it restarts, the box runs the old code. The hold is only recorded by a load made on the new code.
  A project that was loaded without its hardware before the deploy is not held.
- **Owner QA**: load a show without hardware on the live box (API flag) → edit a look → check the project's
  `hardwareConfig` is unchanged → restart node → edit again → check again → Godot Load (applies) → the hold is gone.

## Follow-ups / open

- Godot load-from-file loses the file's rig (see "Pre-existing, not fixed here"). It needs its own WO.
- Web header "Save to file" (`client/components/header-bar.js:142`) falls back to `POST /api/project/load {slug}`
  only when `GET /api/project/file/:slug` fails. That fallback would hold the active project. This is harmless
  (stored slice kept) but surprising. It could pass `applyHardware` or use the GET only.
- No UI shows that a project is held, and no UI sends `captureHardware`. Add both if the owner wants them.
