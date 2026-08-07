# WO-456 — Starter-layout zips: exFAT refresh to canonical tree + first bridge (HIGHASCGDAT) zip

**Status: DONE (2026-08-07 — both zips rebuilt + snapshot-committed, attached to the new release; see status update at bottom for the tag.)**

Owner: "make a new github release as well as the new folder layout for usb stick and bridge partition zip".

## Investigation

- The checked-in `docs/guides/stick/HIGHASCGEXF-starter-layout.zip` was a 2026-06-28 snapshot:
  missing `network/` (WO-95) and `decklink/`, which the seed script has created for weeks —
  exactly the snapshot-lag the WO-453 guide audit flagged.
- The packer's in-zip `README.txt` still described the old folder set.
- There was NO bridge-partition (HIGHASCGDAT) starter zip at all, and
  `seed-bridge-operator-layout.sh` lacked `drop-update/` even though the WO-455 update helper
  stages drops onto the bridge (`stage_drop_to_volume "$BRIDGE_ROOT"`) and
  `server-update.js getVolumeStatus` reads `bridge/drop-update`.

## What was done

- `seed-bridge-operator-layout.sh`: + `drop-update/`, `drop-update/applied/`; README lists
  drop-update/ + decklink/.
- `pack-exfat-starter-zip.sh`: in-zip README now covers network/, decklink/, projects/,
  `.private/`, drop-update/applied.
- NEW `pack-bridge-starter-zip.sh` + `npm run bridge:starter-zip` →
  `dist/HIGHASCGDAT-starter-layout.zip` (10 entries incl. `.private/` placeholder).
- Both zips rebuilt; snapshots refreshed under `docs/guides/stick/` (now includes the DAT
  zip); STICK_QUICK_START + BRIDGE docs updated ("in the zip since 2026-08-07").

## What was VERIFIED

- Zip listings inspected: exFAT 36 entries (network/network.conf, decklink/README, .private
  README, factory configs + starter show), DAT 10 entries.
- `configs/` in the exFAT zip confirmed FACTORY-generated (`write-exfat-starter-bundle.js` →
  `buildFactoryModularConfig`), `security.json` = enforceAuth false / empty apiToken — no live
  box config or secrets published.
- `bash -n` all three scripts; package.json parses.
