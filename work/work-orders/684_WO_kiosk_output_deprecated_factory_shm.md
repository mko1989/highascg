# WO-684 — Kiosk GUI deprecated for good: factory reset / New project / ISO seed the Godot shm output

**Status: DONE (22.10, offline smokes + full suite; factory output generated and diffed; live config untouched)**

Owner, 22.10: *"We can mark the whole kiosk gui as deprecated so it won't come back after a factory reset."*

## Investigation (22.10)

- The kiosk *code* is gone ([WO-646](./646_WO_kiosk_decommission.md), 21.10). What still came back after a reset is
  its **output mode**:
  - `factory-starter.js` built the operator destination with no `videoOutput`;
  - `normalizeScreenDestinations` (`screen-destinations.js:161`) reads a missing value as `'screen'`, which means a
    Caspar `<screen>` window on the operator monitor — the picture the Firefox kiosk used to sit on top of;
  - the Godot GUI reads the operator channel from the shm segment (`videoOutput: 'shm'`, WO-597) instead.
- `factory-starter.js` is the one seed for New project (`src/engine/new-project.js`) and for the full factory /
  stick reset (`src/config/factory-defaults-manifest.js`). The ISO ships the factory `config/` (a stick insert /
  `eggs produce` resets to it on purpose; see the owner's standing rule).
- `new-project.js` `keepOperatorVideoOutput`:
  - its comment said "Factory reset and the ISO still seed 'screen' — the ISO carries no Godot client (WO-609)";
  - that is no longer true: WO-669 (22.10) ships the Godot binary in the ISO, and the Openbox autostart from
    `scripts/setup/09-openbox-autostart.sh` launches it.
- The committed factory `config/screen_destinations.json` had also drifted:
  - it still carried the kiosk `guiUrl` (dropped from normalisation in WO-664);
  - it had `videoMode: custom`, where the factory build now gives `1080p5000`.
- Not kiosk-only, so kept: Firefox (`install-operator-firefox.sh`), which the `browser_display` sources still spawn
  (`src/system/browser-source-session.js`, WO-258).

## What was done (22.10)

- `src/config/factory-starter.js`: the operator destination is written with `videoOutput: 'shm'`, `shmName: 'opgui'`.
- `src/config/screen-destinations.js`: the comment marks `'screen'` as the DEPRECATED kiosk-era output. A *missing*
  value still reads as `'screen'`, on purpose: a show box whose saved config predates WO-597 and whose Caspar has no
  shm consumer (v1 build) must not flip on an update. Only the seed changes.
- `src/engine/new-project.js`: New project keeps whatever the box saved, `'shm'` or `'screen'`. How the box shows the
  operator GUI belongs to the box, not to the show. A box with nothing saved gets the factory `'shm'`.
- `config/screen_destinations.json` (committed factory file) regenerated from `buildFactoryModularConfig` into the
  scratchpad and staged through the git index. `tools/ci/write-repo-default-config.js` writes into `config/`, which is
  this box's live state, so it was not run. The live file on disk is unchanged (same md5 before and after).
- `tools/smoke/smoke-new-project.test.js`:
  - "a kiosk box stays on the factory screen output" (it pinned the old default) is now "New project seeds the Godot
    shm output, never the deprecated kiosk screen";
  - new case: an explicitly saved `'screen'` is kept.

## What was VERIFIED (22.10)

- `smoke-new-project.test.js` 7/0.
- Factory output generated with the real `buildFactoryModularConfig`. The diff against HEAD's
  `config/screen_destinations.json` is exactly:
  - `+videoOutput: shm`, `+shmName: opgui`;
  - `-guiUrl` (the kiosk URL);
  - `videoMode custom → 1080p5000`.
- `test:ci` 2812 pass, 1 fail = the box-only display probe `smoke-wo308-pointer-confine-split.test.js:34` (see WO-683); lint 0 errors.
- Not run: a real factory reset on this box (it resets the owner's live config). The next eggs ISO is the end-to-end
  check: a box installed from it must boot to the Godot GUI with `videoOutput: shm`.
