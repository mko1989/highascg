# WO-695 — Previs fixtures: re-patch a head (mode / universe / address), the operator's patch survives an MVR re-patch, and heads on the box's own input universe still light up

**Status: DONE (2026-10-23, smoke 4/4 new + wo615/616 15/15, test:ci 2834/2837 (only the known pointer-confine fail + 2 skipped), Godot 21146/0; box: beams + programmer react, 36ch re-patch applied / survived an MVR re-patch / then rolled back to the owner's 40ch state)**

Owner, 23.10: *"cant change patch of a fixture. also its patching automatically with wrong ch layout even when i choose
a correct on 36ch in my case."* and *"the heads dont produce beams and dont react at all to the programer"*.

## Investigation

Live project `projects/new_project_1.json` (rev 66 at the start), MVR scene `projects/_mvr/84fbc3cad6e9.mvr`
("Stage 6x3 Focus Profiles", exported by HighAsCG itself):

- **The wrong channel layout came from the MVR file.** Its `GeneralSceneDescription.xml` patches both heads with
  `<GDTFMode>Standard Mode 40ch</GDTFMode>` at `<Address>1</Address>` / `41`. When a scene is shown with none of its
  fixtures patched, `mvr_section.gd` `_load_types()` patches it from the file automatically (WO-636), so both heads
  arrived as 40ch. The owner's real heads run 36ch.
- **The owner's 36ch choice only reached the Add path.** The deleted `fx1 "FocProf 1"` (backup from WO-691) was the
  owner's own: `mode "Basic Mode 36ch"`, address 81, the next free address after the two 40ch heads. The Fixtures
  section's type / mode picker (`fixtures_section.gd` `_add`) feeds only "Add".
- **A patched head could not be re-patched.**
  - There was no mode control for a patched fixture anywhere.
  - Universe / address are editable only in Previs → Camera → Tracking → **Follow**
    (`follow_section.gd:13` `FIELDS`), which nobody would look for.
  - An MVR "Re-patch fixtures" re-applied the file's typeId / mode / universe / address over any edit:
    `mvr_model.gd` `merge_patch` kept only follow / fixed / aim_z / enabled / pan / tilt / name.
- **No beams, no programmer reaction: the self-loop guard.** `GET /api/tracking/fixtures` returned
  `{"fixtures": []}` with both heads patched. `GET /api/fixtures/dmx` showed both heads with
  `problem: "would loop into this box's Art-Net input (universe 0)"`.
  - Every MVR head lands on Art-Net universe 0 with the broadcast destination, the port-address the box's own Art-Net
    lighting input listens on.
  - `follow-engine.js` `configure()` made that a fixture `problem`, and a problem is skipped twice: `tick()`
    (`if (fx.problem || …) continue` — no frame is built) and `follow-service.js` `visual()`
    (`if (… || fx.problem) continue` — no beams).
  - So the Programmer's `POST /api/fixtures/program` changed values that nothing ever rendered.
  - Ruled out: modules on (WO-690), DMX master on with `artnet:0` listed, visualise off, values reaching the engine
    (`changed: [both ids]`).

## What was done

- **`src/fixtures/follow-engine.js`:** a self-loop is now `fx.noSend`, not `fx.problem`.
  - The fixture is still aimed and its frame is built (beams, programmer, fades). Only its universe is muted:
    `u.noSend`, and `_live()` returns false. It still never reaches the box's own input.
  - Status keeps reporting it: `problem: fx.problem || fx.noSend`, `state: 'not output'`, the same wording.
  - The same `problem` fallback is in `src/api/routes-fixture-dmx.js` (usage map) and
    `src/fixtures/calibrate-session.js`, and `follow-service.js` logs it as "not sent — …".
- **New `godot/client/features/previs/fixtures/patch_edit_model.gd`:** `repatch(patch, types, ids, mode, protocol,
  universe, start)`.
  - Heads keep their address order and run on by each one's footprint.
  - Refuses overlaps (naming the other head and the channel), anything past 512, and a mode the type doesn't have.
  - Keeps a unicast Art-Net destination; sACN gets no destination.
  - Sets `manual_patch: true`.
- **New `patch_edit_section.gd`** ("Patch (selected heads)", in Previs → Fixtures above the Programmer; hidden
  without a selection):
  - Fields: mode (when the heads share a GDTF type), Art-Net / sACN, universe, start address, and Apply.
  - Under the fields it shows the server's reason a head is not sent. For the self-loop it says the previs still
    shows the heads and to patch them on another universe to drive real ones.
- **`follow_model.gd` `normalize_fixture`:** keeps `manual_patch` (only when true, so no other patch data changes).
  **`mvr_model.gd` `merge_patch`:** a `manual_patch` entry keeps its typeId / mode / protocol / universe / address /
  dest on an MVR re-patch. An untouched head still takes the file's patch. A placeholder → real-type swap
  (`replace_type_model.gd` `RM.repoint`, WO-637) still repoints it.
- **`fixtures_section.gd`:** hosts the section and passes it the type list.

Not changed:
- The automatic patch of a freshly shown scene (WO-636) stays. The operator now fixes the mode afterwards and it
  sticks.
- The loop guard itself stays. Driving real heads on universe 0 needs them patched on another universe, or the box's
  lighting input moved off universe 0.

## Verified

- **Offline tests:**
  - `tools/smoke/smoke-wo695-fixture-repatch.test.js`, 4/4: a head on the own-input universe gets a frame with dimmer
    255 and sends 0 packets; status says not output; moved to universe 1 it sends; the universe stays muted for a later
    head; `visual()` skips only real problems.
  - `smoke-wo615-dmx` sACN-loop test repointed to `noSend` (same intent, now also asserts the status reason);
    wo615 + wo616 15/15.
  - Godot 21146 passed / 0 failed, including the new `tests/test_patch_edit.gd`:
    - the owner's case: two heads 40 → 36ch, packed at 1 / 37, the next free address 73;
    - refusals for overlap, past 512, unknown mode and an empty selection;
    - sACN destination, and moving onto a head's own old channels;
    - `manual_patch` kept through normalize and winning in `merge_patch`, while an untouched head takes the file.
- **Box** (node server restarted once for the engine change):
  - Before the restart `GET /api/tracking/fixtures` returned `{"fixtures": []}`; after it, both heads.
  - `POST /api/fixtures/program {Dimmer: 1, Color1: Red}`: beams went `i 0 → 1`, `c [1, 0, 0]`, and `packets_sent`
    stayed 0 on the muted universe.
  - Second client instance (screenshots in `/tmp/claude-1000/-home-casparcg/daed53bd-d6cf-409c-8b5b-90a4cc140fc5/scratchpad/wo695/`):
    - `a.png`: a red beam in the 3D previs;
    - `c.png`: All selected, the Patch section showing "2 heads", 40ch, U0 @1 and "Not sent — … would loop into this
      box's Art-Net input";
    - `e.png`: after Basic Mode 36ch → Apply, autosaved, engine shows both at 36ch @ 1 / 37, usage 72 / 512, beams
      still lit.
  - Pressed MVR "Re-patch fixtures": the project kept 36ch @ 1 / 37.
- **Rolled back:** the project's `fixtures.patch` was restored to the pre-test state (40ch @ 1 / 41, no `manual_patch`)
  by `POST /api/project/autosave` (rev 67; every other key identical to the backup). Programmer released
  (`DELETE /api/fixtures/program` → `values {}`). Backup: `scratchpad/wo695/project-before-wo695.json`.
- **Owner QA:**
  - select the two Focus Profiles → Patch → Basic Mode 36ch, Apply.
  - To drive the real heads, patch them on a universe other than the box's lighting input, e.g. U1, and tick that
    universe under Send ▾.
