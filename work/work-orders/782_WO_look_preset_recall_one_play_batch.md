# WO-782 — Look preset recall: every screen's final PLAY in one AMCP batch

**Area:** engine, amcp
**Status: DONE (26.10 — WO-782 smoke 4/4 + offline suite; live: a 2-screen PGM and a PRV preset recall each logged `[take-sync] Phase B go: ch 1+3` / `ch 2+4` with ONE batch; owner QA = screens start together)**

Owner, 26.10 (after WO-781):
> recall of the looks preset is very sequential. the final play amcp needs to be in the same batch for all screens
> included

Parents: [WO-574](./574_WO_MULTI_SCREEN_TAKE_SYNC_BARRIER.md) (take group barrier + merged Phase B),
[WO-601](./601_WO_godot_port_inspector.md) (server-side `/api/scene/look-preset/recall`),
[WO-781](./781_WO_look_presets_e2_destinations_and_deck_toggles.md) (empty destinations).

## Investigation

- **WO-574 already solved this for the web client.** `client/components/scenes-editor-support.js:224` gives every
  POST of a multi-screen take `takeGroup {id, size}`. `handleSceneTake` (`src/api/routes-scene-take.js:60`) joins the
  group (`withTakeGroup`), and each screen's Phase B (PLAY + crossfade) is handed to the barrier as a plan. On release,
  `sendMergedPlans` (`src/engine/take-sync-barrier.js`) sends:
  1. every leading `MIXER n COMMIT`;
  2. ONE `BEGIN…COMMIT` holding every screen's PLAY / fade lines;
  3. the trailing commits.
- **The Godot path never joins a group.** Godot recalls through the server (`handleLookPresetRecall`,
  `src/api/routes-scene-look-preset.js`). That calls `handleTakeLook` once per item inside a `Promise.all`, and
  `handleTakeLook` (`src/api/routes-scene-take-look.js`) builds the take body without `takeGroup`. So
  `joinTakeGroup(undefined)` returns null, there is no barrier, and each screen sends its own Phase B whenever its
  own prep finishes.
- **Journal, owner's 2-screen PGM recall at 17:19:48** (Look 4 → ch1, Look 7 → ch3):
  - No `[take-sync] Phase B go` line.
  - Both takes start at .088 / .091.
  - Screen 2's PGM take batch goes out at **48.289**, screen 1's at **48.920**: about 630 ms apart. Each was followed
    by its own trailing batch (48.635 vs 49.304).
  - Screen 1 was slower because its PRV staging ran first on the shared AMCP connection.
- **PRV recall** (a card click) has the same gap, and the preview-only take path (`routes-scene-take.js` preview-only
  branch) does not pass `playSync` at all. That is correct for the PRV staging *inside* a program take (WO-574 keeps
  that off the barrier), but a preview-only take is the recall's own take.
- **Empty destinations (WO-781) are outside any batch:**
  - PGM goes through `/api/ftb` → `runFadeToBlackAllLayers`, its own `batchSendChunked` per channel. That fades the
    screen's PRV too, and `durationFrames: 0` (Cut) is read as 25 (`parseInt(...) || 25`), so a Cut faded for half a
    second.
  - PRV goes through `handlePreviewLiveClear`, its own chained clear.

## What was done

- **`src/api/routes-scene-look-preset.js`**:
  - A recall with 2+ destinations creates one take group `{id: preset-<id>-<ms>, size: items}` and passes it to every
    item.
  - Each screen still preps at its own pace (PRV staging, LOADBG, Phase A, warm-up). At the WO-574 barrier, all
    screens' Phase B goes out as leading commits → **one `BEGIN…COMMIT` with every screen's PLAY / fade lines** →
    trailing commits.
  - The empty-destination handling was rewritten (it replaces WO-781's `/api/ftb` call):
    - **PGM**: `fadeProgramToBlack` builds `MIXER <ch>-<L> OPACITY 0 <frames> linear DEFER` for the channel's occupied
      layers (`collectLayersToFadeOnChannel`, same set as FTB) and hands them to the group as a plan
      (`leadingCommit: false`, `trailingCommit: true`). The fade therefore starts on the same trailing commits as the
      other screens' crossfades. The channel is cleared once the fade is done.
    - It fixes two side effects of the FTB path: only the recalled bus changes (the screen's PRV is left alone), and
      Cut is 0 frames (FTB turned 0 into 25).
    - A timeline playing on that screen is stopped first (FTB rule).
    - **PRV**: waits at the barrier as a plain gate, then runs the deck's PRV clear, so it clears when the group goes.
  - Everything runs inside `withTakeGroup`, so a failing destination releases its slot.
- **`src/api/routes-scene-take-look.js`**: `takeGroup` is passed into the take body. A take-look that bails out before
  reaching the engine (unknown look, no program channel) leaves the group at once. Otherwise the other screens would
  wait out the 1.5 s barrier timeout.
- **`src/api/routes-scene-take.js`** preview-only path: `playSync: sync`. Only a grouped request (a preset recall to
  PRV) has a sync. The web client's single PRV takes send no group, so they are unchanged. The PRV staging / exchange
  calls *inside* a program take still stay off the barrier (WO-574).
- Smokes:
  - New `smoke-wo782-preset-recall-one-play-batch.test.js`: real recall → real take-look → real barrier, with a fake
    take engine and a fake AMCP.
    - A 10 ms and a 120 ms screen produce one batch `[PLAY 1-10, PLAY 3-10]`.
    - A PRV recall produces one batch.
    - An empty PGM destination's DEFER fade lines go in the same batch, the channel is cleared afterwards, and its PRV
      is untouched.
    - A screen that fails in take-look does not hold the other at the barrier (< 1 s with a 3 s timeout).
  - WO-574 wiring pin: `playSync: sync` count 2 → 3, plus a pin on the preview-only line (reason in the test).
  - WO-601 PRV test: both calls carry the same `takeGroup` of size 2.
- Remaining limit (WO-574, unchanged): `MIXER n COMMIT` is not allowed inside `BEGIN…COMMIT`. The trailing commits
  that fire each screen's DEFER tweens therefore follow the batch as separate commands, one per channel, back-to-back.
  The PLAYs themselves are in one batch.

## Verified

- `smoke-wo782` 4/4. WO-574 / 598 / 601 / 781 smokes 96/96. Full offline suite 3380 tests, 0 fail. Lint 215
  warnings (budget 216), prettier OK, no file over 500 lines, no new unwired exports. Godot `run-client.sh --check`
  boot OK.
- **Live on the box** (server restarted; off-screen Godot client, `--probe-e2-presets`, 17:26).
  - Start state: PGM 1 empty, PGM 2 Look 7, PRV 1 Look 2, PRV 2 KV LOOP 2 (the owner's state).
  - Saved "probe PGM" (screen 1 empty + Look 7) and "probe PRV" (Look 2 + KV LOOP 2).
  - PGM recall: `[take-sync] Phase B go: ch 1+3 (2 screen(s), 4 lines)`, one `BEGIN…COMMIT (4 cmds)`, then
    `Phase B sent in 213ms`.
  - PRV recall: both preview-only takes started 3 ms apart; `Phase B go: ch 2+4 (2 screen(s), 2 lines)`, one
    `BEGIN…COMMIT (2 cmds)`. The PRVs are back to Look 2 / KV LOOP 2.
  - Before the fix, the owner's 2-screen PGM recall (17:19:48) had no `take-sync` line and two separate per-screen
    batches about 630 ms apart.
  - Both probe presets were removed; the owner's presets "loop" and "intro" are untouched. The buses ended as found.
- Owner QA: recall a 2-screen preset to PGM and check that both screens start together.
