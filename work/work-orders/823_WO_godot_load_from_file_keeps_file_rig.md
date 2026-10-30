# WO-823 — Godot "Load from file" stamps this box's rig over the file's own hardwareConfig

**Area:** devices-config, godot-client
**Status: DONE (29.10, smoke 8/8 + suite 3595/0/2 + Godot 22755/0 + sandbox e2e) · live e2e 30.10: server contract PASS on the box (`keepPayloadHardware` save stores the file's rig, journal line, survives load + autosave + restart; see WO-821 "Live e2e"). The Godot "Load from file…" click-through was not driven: no pointer automation on :0 while the owner works; the client call site is covered by the headless test**

## Investigation

Found while fixing WO-821 ("Pre-existing, not fixed here").

- `godot/client/app/header_project.gd:227` (`_load_file`): the picked file is posted as
  `POST /api/project/save {project, allowReplace:true}`, then `load_slug()` (`:138`) posts
  `/api/project/load {slug, applyHardware:true}`.
- `src/api/routes-data-project-handlers.js:37-40` (`/api/project/save`) runs `stampProjectHardware(...)` before
  `persistProject`. Not held (a freshly imported slug has no hold), it falls through to
  `injectHardwareConfigToProject` (`src/engine/project-hardware-hold.js`, "Not held" branch), which sets
  `project.hardwareConfig = <this box's live config>` (`src/engine/project-hardware-config.js:251`).
  The file's own `hardwareConfig` is gone before the file is stored.
- The `applyHardware:true` load then reads the stored project (`routes-data-project-handlers.js:197-200` →
  `project-activate.js:194-196`, `applyHardwareConfigFromProject`) and applies **this box's own rig back to itself**.
  Result: loading a show file always yields this box's rig; a file's screens and destinations are never restored.
- Worse with a hold: if a project with the same name was loaded earlier without its hardware (WO-821 hold), the
  save wrote the OLD stored slice over the file's. Either way the file's rig loses.
- Web does not have this bug and has no server import endpoint to reuse. `client/components/header-bar.js:160-176`
  (`loadFromFile`) → `client/lib/project-import-flow.js:60-77` (`source: 'file'`) imports into the client state and
  calls `applyServerHardwareConfigOnly(project.hardwareConfig)` (`project-hardware-apply.js:12`, i.e.
  `POST /api/project/apply-hardware {hardwareConfig}`) with the file's rig; the client's own autosave stores it
  afterwards. `client/lib/project-files.js` has only slug loads. So there is nothing server-side to reuse; Godot is
  the only client that stores a file through `/api/project/save`.
- Side observation, not changed here: a file whose name differs from the active project is a "rename" to
  `/api/project/save` (`prevSlug !== slug`, `:57`), so the previously active project is retired to trash
  (`retireSlugWithReplication`). Loading a file therefore trashes the project that was open. It is recoverable
  from the trash and predates this WO, but the owner may not expect it.

## Decision

A small explicit contract on the save: **`keepPayloadHardware: true`** writes the payload's `hardwareConfig` exactly
as given. Only Godot's load-from-file sends it. The following `load {applyHardware:true}` then applies the file's
rig and ends any hold.

Why this and not the alternatives:
- A new `/api/project/import` endpoint would duplicate the whole save path (validate, WO-614 client slices,
  autosave copy, replication, media dir, rename retire) for one flag.
- Dropping the stamp for every payload that carries a `hardwareConfig` would let any Godot autosave (the client
  sends its in-memory slice) overwrite the stored rig, undoing WO-821. The flag is per request and on `save` only.
- `captureHardware` is the opposite gesture (take this box's rig) and keeps priority if both are sent.

Kept intact:
- WO-821: autosave never reads the flag; a plain save is unchanged; the flag does not end a hold (only the apply
  does, so an autosave between the save and the load still writes the stored file rig); the previous slug's hold is
  released because the same save retires it.
- WO-311: the empty-config guard is for stamping the LIVE config; with the flag nothing is stamped, so a factory
  box (empty live config) still stores the file's rig. The 410 `project_gone` check is on autosave and untouched.
- WO-614: `preserveClientOwnedSlices` still runs after the stamp, before `persistProject`.
- A file with no `hardwareConfig` stores none (nothing is invented from this box); the apply then skips
  (`project-hardware-config.js:285`), so the box keeps its rig.

## What was done

| File | Change |
|---|---|
| `src/engine/project-hardware-hold.js` | `stampProjectHardware` option `keepPayload`: returns `'payload'` before the capture/hold/live branches (capture still wins), releases the retiring previous slug's hold, logs `save kept the file's own hardwareConfig for "<slug>" (import, WO-823)`. |
| `src/api/routes-data-project-handlers.js` | `/api/project/save` passes `keepPayload: b.keepPayloadHardware === true`. Autosave does not. |
| `godot/client/app/header_model.gd` | New `file_import_body(project)` builds the save body `{project, allowReplace, keepPayloadHardware:true}`. |
| `godot/client/app/header_project.gd` | `_load_file` posts `HeaderModel.file_import_body(parsed.project)`. One line; whole file stays valid. |
| `godot/client/tests/test_header_model.gd` | `test_file_import_body`. |
| `tools/smoke/smoke-wo823-load-from-file-keeps-rig.test.js` + `tools/ci/offline-test-files-2.js` | New smoke, registered. |
| `docs/wiki/api/project.md` | Documents `keepPayloadHardware` next to the hold. |

## Verified (29.10)

- **Smoke** `tools/smoke/smoke-wo823-load-from-file-keeps-rig.test.js`: 8/8, real handlers on a private state file and
  projects dir. Old flow without the flag loses the rig (documented); file import → stored + `_autosave` + fingerprint
  keep the file rig, live untouched by the save, live = file rig after the apply, hold ended, later rewire flows into
  the show; import over a held same-name project keeps the file rig, hold survives the save and an autosave in
  between, ends at the apply; empty live config (WO-311); file without hardware; autosave ignores the flag, capture
  beats it, plain save still stamps; source pins that the flag is only in the Godot model and `project_sync.gd` never
  sends it. **Mutation**: with the `keepPayload` branch disabled, 4 of 8 fail (the import tests); the 4 that pass are the
  old-flow contrast, the guard test, the source pin and cleanup.
- **Offline suite** `node tools/ci/run-offline-tests.js`: **3595 pass / 0 fail / 2 skipped** (baseline 3585; +8 mine,
  +2 from other agents' concurrent work).
- **Godot** `run_tests.gd`: **22755 passed, 0 failed** (baseline 22750; +5 assertions).
- `check-max-file-lines.js`: 0 over (`routes-data-project-handlers.js` 495). eslint on touched JS: 0 errors (the one
  `'slug' unused` warning at `:169` is the pre-existing one from WO-821). `format:check` clean.
  `gen-api-contract.js --check`: exit 0 (no route changes).
- **Sandbox e2e** (`tools/e2e/sandbox-server.js`, own root and port, live server untouched). Script:
  `/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/wo823-sandbox-e2e.js`.
  ```
  box rig applied (live box_dst)
  OLD flow  save (no flag) + load applyHardware:true  → stored box_dst, live box_dst      (the bug)
  NEW flow  save keepPayloadHardware:true             → stored show_dst, _autosave show_dst, live box_dst
            load applyHardware:true                   → stored show_dst, _autosave show_dst, live show_dst
            GET /api/project                          → hardware show_dst; fingerprint {"hostname":"venue-box"} kept
            client autosave (rev 43)                  → stored show_dst, live show_dst
            sandbox restart, live show_dst, autosave (rev 44) → stored show_dst, live show_dst
  ```
  server.log: `save kept the file's own hardwareConfig for "wo823_file_show" (import, WO-823)`, then
  `Loaded hardware configuration (v2)`.
- **Not done**: no live deploy, no real Godot GUI click-through (the live node and the Godot client on :0 were not
  restarted: another agent is running live QA). The Godot client change is one call-site line plus a pure helper
  covered by the headless test; the server contract is proven end to end in the sandbox.
- **Owner QA (live round)**: after the node restart and a Godot relaunch, header right-click Load → "Load from
  file…" with a show file whose screens differ from this box → Device View / Devices show the file's destinations;
  `projects/<slug>.json` `hardwareConfig` is the file's; restart node, edit a look, check it again. Note that
  the previously open project goes to the trash if the file's name differs (see the side observation).

## Follow-ups / open

- Loading a file with a different name retires the active project (rename semantics of `/api/project/save`). Decide
  whether import should use a path that does not retire.
- The web "Shift+click load" and Godot differ in order (web imports in the client, then applies; Godot stores then
  applies). Both now end with the file's rig.
