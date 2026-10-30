# WO-791 — Companion: recall look presets to PRV, to PGM, or to PGM with auto take

**Area:** companion
**Status: DONE (27.10 — module tests 81/81, live recalls of the box's presets in all three modes through the module's
API client; package `highpass-highascg-1.0.10.tgz` built, not installed; owner QA = install the package, then press
the preset buttons)**

Owner, 27.10:
> check if the companion module for highascg supports recalling looks presets. should have 3 options, recall to prv,
> recall to pgm, recall to pgm with auto-take.

and, after the check:
> build it. auto take should work like clicking play button on the looks presets now, so first to prv than
> transition to pgm.
> when done, bump version of companion module and make a package

Parents:
- [WO-601](./601_WO_godot_port_inspector.md) (`POST /api/scene/look-preset/recall`);
- [WO-781](./781_WO_look_presets_e2_destinations_and_deck_toggles.md) (E2 destinations, empty ones);
- [WO-782](./782_WO_look_preset_recall_one_play_batch.md) (one PLAY batch per recall);
- [WO-783](./783_WO_look_presets_right_column_tab.md) (the Godot preset cards: click = PRV, ▶ = take, ⋯ Auto / Cut);
- [WO-372](./372_WO_companion_dev_module_not_selectable.md) (module packaging, installed vs dev copy).

## Investigation

- **The module had no look-preset recall.** Module repo `~/companion-module-dev/companion-module-highpass-highascg`,
  1.0.9:
  - "look_preset", "lookPresets" and `/look-preset/recall` appear nowhere in `src/`.
  - The test suite named "look presets" (`test/presets-and-config.test.js:95`) is about Companion's own button
    presets for `look_take`.
  - **"Look Slot: Recall"** (`src/actions/look-actions.js:209`) is a module-local slot holding ONE look id, taken
    to PGM on one screen. It is not a HighAsCG look preset.
- **The server already has everything.**
  - `src/api/routes-scene-look-preset.js` takes `{ id, target: 'preview'|'program', forceCut, useGlobalTransition }`.
  - It recalls every destination of the preset at once, in one PLAY batch (WO-782), and clears empty destinations
    (WO-781).
- **The preset list reaches the module already.**
  - The live deck (`scene.deck`, on GET `/api/state` and the WS `change` broadcast) carries `lookPresets`. Six on the
    box.
  - So does GET `/api/project` (`scenes.lookPresets`) and the `project_sync` broadcast.
- **The Godot cards** (`godot/client/features/live/look_preset_strip.gd:56-100`):
  - a click is `recall(id, "preview")`;
  - ▶ is `recall(id, "program")`, i.e. each look's own transition;
  - ⋯ Auto adds `useGlobalTransition`; ⋯ Cut adds `forceCut`.
- **A PGM take flips the buses.** Seen live below: after a program recall, PRV holds what was on PGM before.

## What was done

All in the module repo (not this repo).

- **New `src/look-presets.js`**:
  - **List:** `normalizeLookPresets` (items, empty destinations, the legacy single-look `{ sceneId, targetMain }`) and
    `ingestLookPresets`. Ingest re-builds the actions and buttons only when the list signature changed.
  - **Dropdown:** `buildLookPresetDropdown`.
  - **Recall:** `recallLookPreset(instance, id, mode)`:
    - `preview` → `{ target: 'preview' }`;
    - `program` → `{ target: 'program', forceCut: true }`;
    - `auto` → the preview request, then `{ target: 'program', forceCut: false, useGlobalTransition }`. That second
      request is the ▶ request, so the owner's "first to PRV, then transition to PGM" holds.
  - **Feedbacks:** `look_preset_on_pgm` and `look_preset_on_prv` are true while every destination holds its look on
    that bus (`scene.live` by channel). An empty destination counts while nothing is live there.
- **New `src/actions/look-preset-actions.js`**: **Look preset: Recall**. Options:
  - preset (dropdown, `allowCustom`);
  - Recall (PRV / PGM cut / PGM with auto take, default auto);
  - "Auto take: use the deck default transition", default off = each look's own.

  Per-screen errors from the reply are logged as warnings.
- **New `src/presets/look-preset-presets.js`**: section "HighAsCG · Look presets", a PRV / PGM / AUTO row per preset.
  PRV tally is green and PGM tally red. PGM is listed last, so a preset on both buses shows red.
- **Wiring:**
  - `actions/highascg-actions.js`, `feedbacks.js` and `presets.js` register the new action, feedbacks and section.
  - `look-feedback-ids.js`: the two feedbacks are re-checked with the look tally on every `scene.live` change.
  - `bridge/api-client.js`: `recallLookPreset`.
  - `instance.js`: ingests the list from the deck (`applySceneDeck`, the refresh `getState`), GET `/api/project` and
    `project_sync`.
- **Why two requests for auto, and not a client-side PRV → PGM take:** the second request goes through the
  server's grouped take (one PLAY batch for every screen, WO-782). The module's own "Take from preview" path takes
  screens one by one.
- **New `test/look-presets.test.js`** (8 tests):
  - the request per mode, and the deck-default option;
  - error logging;
  - normalizing, and a re-ingest of the same list not rebuilding;
  - tally, including empty destinations;
  - the button rows and the catalog section.
- **Release:**
  - `package.json` 1.0.9 → **1.0.10**;
  - a `CHANGELOG.md` entry and a "Look presets" section in `companion/HELP.md`;
  - `npm run package` → `highpass-highascg-1.0.10.tgz` (md5 `92014908…`).

## Verified

- **Module tests:** 81 pass, 0 fail (`node --test test/*.test.js`; 8 new).
- **ESLint and Prettier:** clean on every new and touched file. The repo has 78 older lint errors in 17 files
  this WO did not touch.
- **Live on the box**, run through the module's real `HighAsCGApi` and `look-presets.js` (scratchpad
  `preset-probe.mjs`), reading `/api/state` 1.5 s after each recall. Screens 1 / 2: PGM = channels 1 / 3, PRV =
  channels 2 / 4.

  | Mode | Preset | Request time | Errors | On PRV after | On PGM after |
  |---|---|---|---|---|---|
  | PRV | Intro | 373 ms | none | Intro (17a84681 / 149fd497) | unchanged (586e21a2 / 752c5d0c) |
  | PGM cut | Intro | 1025 ms | none | the old PGM (flip) | Intro |
  | Auto | zabierz mnie | 1914 ms | none | the old PGM, Intro (flip after the take) | zabierz mnie (c68b6cdf / ba8ccf1d) |

  `look_preset_on_pgm` / `on_prv` read true / false correctly after each recall.
- **Package:** the tgz holds `companion/manifest.json` version `1.0.10`, the action, the recall route, the feedbacks and
  HELP.md.
- **Not done:**
  - **Not installed.** `~/.config/companion/modules/highpass-highascg` is still 1.0.9 and Companion was not restarted.
  - **Committed and pushed 27.10** (owner: "commit and push the module there") to
    https://github.com/mko1989/companion-module-highpass-highascg, main `42070f5..8b55f63`:
    - `839660d`: the 1.0.9 work (playlists, global border, FTB, screen timers), built on 23.10 but never committed.
      It was staged without this WO's edits and its own snapshot was tested: 73/73.
    - `47086c7`: this WO (1.0.10), 81/81.
    - `8b55f63`: a merge of GitHub's two web-upload commits of 12.09 (`-s ours`, local tree kept, no force-push).
      Their source edits were already in local main. The rest was build output (`pkg/`, `*.pyc`,
      `package-lock.json`, all in `.gitignore`) and `src/tcp.js`, which WO-394 removed on purpose.
    - The repo has no CI.
- **Box state left:** PGM shows "zabierz mnie" and PRV shows Intro, from the live test.
- **Owner QA:**
  - Install 1.0.10 and restart Companion.
  - Add the "HighAsCG · Look presets" buttons.
  - PRV should light green; AUTO should load PRV, then transition, and light red; PGM should cut.
