# WO-637 — MVR placeholders resolved from GDTF Share automatically

**Area:** lighting
**Status: DONE (2026-10-21) — offline 3079 incl. new smoke, Godot --test 20618/0; box: Pabianice's 5 Capture placeholders → real GDTFs from GDTF Share, 52 fixtures on the real types, models drawn.** Parent: [WO-633](./633_WO_gdtf_replace_stub_types.md) (manual Replace…). Related: [WO-636](./636_WO_mvr_loads_its_gdtf_types.md) (a scene's types load when shown).

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

### Matching measured on the live list (13 315 revisions / 10 397 types, 2026-10-21)

| Placeholder | Taken | Why not the others |
|---|---|---|
| ADJ Focus Profile 36/40/51 | rid 117341 ADJ Focus Profile, Manuf., all modes | only candidate |
| Brighter Pixel Strobe 4/12/15/44/244 | rid 110457, Manuf., all | "User Test", OGSON, PROLIGHT: other makers |
| Clay Paky Sharpy Plus 31 | rid 97983, Manuf. | user uploads of the same; SharpyPlusAqua: name only contains |
| Acme Pixel Line IP (12 footprints) | rid 159025 PIXEL LINE IP (STROBE 3 IP), Manuf., all 12 | exact-name user file 118169 misses 39 ch; "Mode 11" factory file = one mode; TIITEE re-upload |
| Robe Robin 600 LEDWash+ 10/15/21/24/37 | rid 60186 Robe Lighting Robin 600 LEDWash, Manuf., 4 of 5 (no 24) | Robin 600 LEDWash SW 2 of 5 |

So: maker must agree (synonyms ADJ / American DJ, prefix Robe / Robe Lighting), name equal or contained (Share maker
prefix stripped), then channel-count coverage, name, manufacturer upload, rating, newest; taken when coverage ≥ 0.75,
else offered.

## What was done

- `src/fixtures/gdtf-share-match.js` (pure): `rank(stub, list)` → {best, sure, candidates}; `pairModes` = the
  Replace… dialog's footprint pairing (replace_type_model.gd) on the server.
- `src/fixtures/gdtf-share.js`: account `~/.highascg/gdtf-share.json` (0600, box-local, not in the synced repo; the
  password is never returned), login → session cookie (one re-login on 401), list cached
  `~/.highascg/cache/gdtf-share-list.json` (a day; a stale copy is used when offline), `resolve(ids)`: every
  placeholder without an alias → download the taken rid → `ensureGdtf` → `setAlias` (WO-633) with paired modes; not
  sure → `choose` + candidates; not listed → `none`.
- `src/api/routes-gdtf-share.js` (router.js): `GET/POST /api/fixtures/share/account`, `POST /api/fixtures/share/resolve`.
  `docs/wiki/api/contract/http.md` regenerated (469 routes).
- `src/api/routes-stage-mvr.js`: `/types` also says `replacedBy` (alias target).
- Godot `mvr_section.gd` `_load_types` (WO-636): types → `_from_share` (resolve the unaliased placeholders) → the
  file's patch when nothing is patched (the server's patch already follows the aliases), else the existing patch is
  re-pointed (`RM.repoint`). The scene summary drops the "shown as boxes" specs that are now real
  (`mvr_model.without_specs`) and says what GDTF Share did (`mvr_model.share_note`).
- No account UI yet: the box's account was set through the route (owner's account, activated 21.10).

## What was VERIFIED

- `tools/smoke/smoke-wo637-gdtf-share.test.js` (new, in the CI list): matcher on entries shaped like the live list
  (TIITEE re-upload, one-mode factory file, exact-name file missing a mode → the factory full-coverage file; Robe 4 of 5
  taken; 1 of 3 offered), mode pairing, the routes against a fake GDTF Share (no account → nothing fetched, 0600
  account file, password never echoed, login → list → download rid, alias stored, second run idle, stale list used
  offline, fresh cache not refetched). WO-615 patch smoke + `replacedBy` check. Offline suite 3079 tests, 0 fail after
  the contract regen; Godot `--test` 20618 / 0 (+ `share_note`, `without_specs`), `--check` boots; no file > 500.
- Box: account set (file 0600), node restarted, GUI relaunched on godot_test / Pabianice →
  - aliases: Acme → 6ad826d14d1b PIXEL LINE IP (STROBE 3 IP) (13 modes "1: 7 Channel" → "Mode 1 7DMX" …), ADJ →
    cb73a616bb97 (36/40/51 → Basic/Standard/Extended), Brighter → 0db39dd819da (6 modes), Clay Paky → 239be2440419,
    Robe → 289fa8cde237 (5 of 6 stub modes).
  - project patch: all 52 moved onto the real types (12 / 12 / 12 / 8 / 8); journal `52 fixture(s), 52 outputtable`.
  - A fresh `POST /api/stage/mvr/<id>/patch`: 52 entries, 0 skipped, all on real types and modes.
  - Previs: moving heads, washes and strobes drawn from the real models; the "shown as boxes" line gone; after a
    relaunch nothing is re-fetched (all aliased). Mapped LED walls and DMX output (off) unchanged.
- Owner QA: a new MVR import end-to-end; a placeholder that is only offered (`choose`) — Replace… still lists only
  imported types, it does not show the Share candidates yet.
