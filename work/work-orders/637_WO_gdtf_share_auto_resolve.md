**Status: OPEN (2026-10-21) — investigation + plan; blocked on a GDTF Share account for the box.** Parent: [WO-633](./633_WO_gdtf_replace_stub_types.md) (manual Replace…). Related: [WO-636](./636_WO_mvr_loads_its_gdtf_types.md) (a scene's types load when shown).

# WO-637 — MVR placeholders resolved from GDTF Share automatically

Owner 21.10: "can we somehow automate the mvr import with gdtf share so the fixtures are auto loaded correctly?"

## Investigation

- Today (WO-633 + WO-636): showing Pabianice loads its 5 GDTFs, all Capture stubs (placeholder: `description.xml`
  only, `DimmerN` channels, no model → boxes). The real type has to be imported by hand (a .gdtf from this machine),
  then Replace… pairs the modes by footprint and stores a box-level alias (`projects/_gdtf/aliases.json`); every later
  MVR patch of that rig uses the real type.
- GDTF Share has a public API ([GDTF Hub: Share API](https://www.gdtf.eu/gdtf/share_api/share-api/)):
  - `POST https://gdtf-share.com/apis/public/login.php` JSON `{user, password}` → session cookie (2 h idle timeout).
  - `GET …/getList.php` → every revision: `rid`, `manufacturer`, `fixture`, `revision`, `uuid` (fixture type id, stable
    across revisions), `uploader` (`Manuf.` / `User`), `rating`, `version`, `lastModified`, `filesize`,
    `modes[{name, dmxfootprint}]`.
  - `GET …/downloadFile.php?rid=N` → the .gdtf.
  - A free GDTF Share account is required (anonymous getList → 401); integrations must send non-account users to the
    site to sign up. No documented rate limit.
- The list carries mode footprints, so a candidate can be checked against the stub's modes before anything is
  downloaded — the same footprint key WO-633 pairs by (`replace_type_model.gd pair_modes`).
- Names differ between Capture and the Share (`ADJ` vs `American DJ`, `Robin 600 LEDWash+` vs `…Plus`); WO-633's
  `norm` + maker containment already ranks these for the manual dialog.
- The box is offline at shows: anything fetched must be stored (type store + alias), never fetched at show time.

## Plan

- T1 Settings: GDTF Share user + password, box-level, password write-only (redacted in GET; added to the hand-listed
  settings POST — see the WO-619 lesson).
- T2 Server `src/fixtures/gdtf-share.js`: login, cached list (`projects/_gdtf/share-list.json`, refreshed when older
  than a day and online), `match(stub)` → ranked candidates (maker + name normalized, every stub footprint present,
  manufacturer upload > user, rating, newest), `fetch(rid)` → `importGdtf` + alias with modes paired by footprint.
  Route `POST /api/fixtures/share/resolve {ids}` → per placeholder: replaced / ambiguous (candidates) / not found.
- T3 Godot: after a scene's types load (WO-636), placeholders without an alias are resolved automatically when an
  account is set and the box is online; the MVR section says what was replaced, ambiguous ones open Replace… with the
  candidates. Tests: matching + pairing on a canned list (Pabianice's 5 stubs).
- T4 Box: Pabianice → real types for all 5, patch, models drawn instead of boxes.
