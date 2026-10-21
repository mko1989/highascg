**Status: IN PROGRESS (2026-10-21) — investigation written; implementation started. Parent: [WO-615](./615_WO_previs_fixtures_gdtf_patch_dmx_out.md) (T10 found the stubs). Related: [WO-612](./612_WO_previs_mvr_import.md).**

# WO-633 — Replace a stub GDTF (Capture placeholder) with the real fixture file

Owner 21.10: "what can we do about the missing gdtf files from the import" → "make work orders for those additions and
start working on them".

## Investigation

### What the MVR exports carry (7 real files, `~/Downloads`, 2026-10-21)

Profiled with a scratch script (zip listing + `description.xml` per embedded GDTF):

- Capture (MVR 1.4): every embedded GDTF is a **stub** — `description.xml` only, `<Model Name="Base"/>` with no size or
  file, one empty `Base` geometry, every channel a generic `Dimmer1…N` attribute. Names keep Capture's library revision:
  `ADJ@Focus Profile@r3009.gdtf`, `Brighter@X-Dot Max@r3006.gdtf`. Mode names are Capture's (`40 Channel`,
  `Basic [Control=Single]`).
- Another exporter (MVR 1.5, no provider: SLUZEW, TAMOOS) writes stubs named `Dummy - <type>` with makers spelled
  differently (`American DJ` for ADJ) and modes like `Mode 0`, `Standard 40 channel`.
- Full GDTFs appear too: `guttmany25` carries 8 (e.g. `ADJ@Focus_Profile@25-13-11_Release.gdtf`), SLUZEW 2, TAMOOS 2.
  So one owner file set already holds stub + real pairs of the same fixture.

### What a stub costs

- The patch is right (address, footprint per mode — WO-615 T10), the previs draws a 0.3 m box (`fixtures_3d.gd`
  placeholder), but there is no pan / tilt / colour / gobo meaning: the programmer, looks, follow and visualiser have
  nothing to drive.
- The real file cannot come from the MVR. It comes from GDTF Share (gdtf-share.com — an account; the box is offline at
  shows) or the manufacturer.

### Pairing modes: the footprint is the reliable key

Parsed with `src/fixtures/gdtf-parse.js` (scratch, real files):

| Stub (Capture) | Real | Pairs by footprint |
|---|---|---|
| ADJ Focus Profile: 36 Channel 36, 40 Channel 40, 51 Channel 51 | Basic Mode 36ch 36, Standard Mode 40ch 40, Extended Mode 51ch 51 | all 3, one-to-one |
| Brighter X-Dot Max: Basic 28, Effects 35, Rings 40, Pixelmap 99 / 252 / 322 [Single], Pixelmap 99 A 23 / 252 A 24 / 322 A 18 [Dual] | 28Ch, 35Ch, 40Ch, 99Ch, 252Ch, 322Ch | 6 of 9; the Dual modes have no counterpart |

Names never match (`40 Channel` vs `Standard Mode 40ch`); the footprint does, except where two modes share one (X-Dot
"28 Channel 3" / "28 Channel 2") — then the operator picks.

### Where things live

- Types: box-level store `projects/_gdtf/<id>.gdtf|.json` (`src/fixtures/gdtf-store.js`, id = content hash; summary
  has `modes[{name, footprint, channels, breaks}]`).
- Patch entries: `project.fixtures.patch[{typeId, mode, …}]`, client-owned (CLIENT_OWNED_SLICES) — the Godot client
  writes them (`fixtures_section.gd _persist`, `mvr_section.gd _persist_fixtures`).
- MVR patch: `POST /api/stage/mvr/<id>/patch` → `ensureGdtf(stub)` → `buildMvrPatch(typeFor)` (`routes-stage-mvr.js`).

## Design

- **Alias** (box-level, `projects/_gdtf/aliases.json`): `{ "<stub id>": { to: "<real id>", modes: { "<stub mode>":
  "<real mode>" }, maker, name } }`. Box-level because the same stub arrives in every Capture export of that rig; a
  later MVR patch uses the real type without asking. Looked up by the stub's id, then by its maker + name (another
  revision of the same Capture stub). A dangling alias (real type removed) is ignored.
- **Stub flag** on the type summary (`stub: true`): no geometry with a model file / size, no Beam, and every channel
  attribute `DimmerN`. The Fixtures section labels such types "(placeholder)".
- `POST /api/fixtures/types/<stub>/replace {to, modes}` stores the alias (both types must exist, every mode named must
  exist on its side); `DELETE …/replace` clears it. The summary carries `replacedBy`.
- MVR patch: an aliased stub resolves to the real type and translates the mode; a stub mode without a pair keeps the
  stub type (footprint still right).
- Godot Fixtures section: **Replace…** (enabled on a placeholder type) → dialog: real type (non-stub types, the best
  name match first — maker spelling and "Dummy -" ignored), one row per stub mode with the real mode prefilled by
  footprint ("— keep placeholder —" when none). OK → alias saved, this project's patch entries re-pointed (typeId +
  mode). The real file has to be imported first (Import GDTF…); the dialog says so when there is none.
- Later (not this WO): GDTF Share search / download on the box with the owner's account.

## Tasks

- [ ] T1 Server: stub flag, alias store, replace route, MVR patch uses aliases (+ smoke).
- [ ] T2 Godot: Replace… dialog, mode pairing, re-point the project's entries (+ tests).
- [ ] T3 Box: Pabianice patched with the stub, replaced by the real Focus Profile from guttmany25, re-patch keeps it.

## What was done

## What was VERIFIED
