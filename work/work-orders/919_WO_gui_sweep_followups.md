# WO-919 — WO-918 follow-ups: the findings the 01.11 fix round left open

**Area:** godot-client, engine, devices-config, mapping
**Status: IN PROGRESS** (F2 F6 F11 F13 F26 N1 N3 N4 N5 done and verified; F4, F20, N2 and the web legacy autosave are open)

Owner, 01.11.26 (after the WO-918 re-test): "Continue. Add work orders for this."

Parent: [WO-918](./918_WO_gui_project_and_destination_test_sweep.md). Each item's reproduction and evidence is in WO-918
under the same number; it is not repeated here.

## Investigation (from WO-918 and its re-test)

- **F2** Devices "Server ▾" compare says "matches" while its "Module expects" column shows the RUNNING layout, not the
  loaded project's.
- **F4** Loading an old project whose PGM1 is cabled to a down output (frontex → DP-2), then Apply: nodm restarts the
  whole :0 session, xrandr fails, Caspar's 5760x1728 window buries the GUI, the old operator destination's
  `videoOutput=screen` opens a screen consumer on DP-4, and a header Load gives no hardware-mismatch warning
  (`hardware_reconcile.gd` only runs on boot/reconnect).
- **F6** Load (and Apply) re-stamp `savedAt`, so the Load list's "Saved" column stops meaning "last edited".
- **F11** New project leaves the old show on air (PRV ch3 keeps playing); Visuals "Send" re-sends to 2-1 after New
  project and after Caspar restarts.
- **F13** A stale "Live audio input 1 · HOST · ch 7" card stays in Devices after New project.
- **F20** Connected but uncabled outputs keep their old xrandr position: after Apply DP-6 overlapped DP-0 (+1920+0).
  On this box DP-6 is the second operator monitor — [WO-920](./920_WO_operator_gui_second_monitor_dot.md) gives it a
  cable; the general rule for any uncabled head is still open here.
- **F26** After a node restart in the F20 overlap, OS-Watchdog retries xrandr 12× in ~15 s, then logs "Layout still
  wrong … operator may need Apply OS" — journal only, the GUI shows nothing.
- **N1** The header notice is clipped at 200 px; the restart / switched / name-taken texts are only readable in the
  tooltip.
- **N2** A destination edit made just before another client switches shows is never stamped into the old show (its
  autosave is correctly refused as `not_active`), so loading that show later brings the removed destination back.
  Decision needed: write a stale client's last edit into ITS show's file (rev-checked) instead of dropping it.
- **N3** Live-thumbnail PRINT frames (`media/2026…T….png`) appear in the Sources media list while they exist.
- **N4** Trash entries duplicate between `~/bridge/projects/_trash` and `projects/_trash` (a rename left two
  `untitled_2-*` dirs in each), and the `-replaced` backups replicate to the bridge.
- **N5** A rename leaves the old, empty `media/projects/<old slug>/` folder.
- The web client still uses the legacy autosave path (no `editingSlug`) and does not follow `project.activated`.

## What was done

Commit 26e06ce9, unless noted.

- **F11, New project leaves the show on air.**
  - New `src/engine/new-project-air.js`:
    - `showAirChannels` lists the show channels.
    - `clearShowAir` CLEARs PGM and PRV, re-adds the screen timers on layers 980–989 and clears the live state.
    - `clearPersistedAir` clears the persisted air.
  - `new-project.js` returns that work; `routes-data-project-new.js` waits for it for at most 4 s and broadcasts
    `change show.cleared`.
  - Godot: new `features/visuals/visuals_air.gd`. `visuals_tab.gd` ends "Send", so it no longer re-sends to 2-1.
- **F13, stale host card.** `devices_follow.gd` refreshes when Settings finish loading; `core/devices_target.gd`
  gains `box_settings`.
- **F2, Server compare.**
  - `src/config/config-compare.js`: the expectation is what Apply would write for the loaded project, compared with
    the running server (`compareExpectedToServer`).
  - `project-activate.js` refreshes the comparison on load.
  - The Godot `header_badges_model.gd` and web `header-bar-config-strip.js` show the mismatch summary, and "(screen)"
    for screen consumers.
- **F6, savedAt re-stamp.** `project-scenes.js showContentEquals` ignores `rev`, `savedAt`, `slug`, `hardwareConfig`
  and `channelScheme`. The stored `savedAt` is kept unless `opts.userSave` is set; `/api/project/save` sets it.
- **F26, silent watchdog give-up.**
  - New `src/bootstrap/os-layout-issue.js`, used by `os-layout-watchdog.js`.
  - `get-state.js` exposes `osLayout`; a successful Apply clears it (`routes-caspar-config.js`).
  - Devices shows an amber status (`devices_follow.gd` / `devices_follow_model.gd`).
- **N1, header notice.**
  - `header_model.gd notice_width` and `header_project.gd _set_notice`: the notice grows to fit its text.
  - **Follow-up:** the first cap was 45% of the window, which ignored the rest of the header row. Loading mhp_harder
    (Dio/Pro timer toggles plus the on-air strip) put the row past 1920 px and pushed the whole client, inspector
    included, off the right edge. `_fit_notice` now caps the width at what the row leaves free
    (`notice_width(text_w, window_w, room)`). It refits when the row's minimum size changes (deferred) and when the
    window resizes. With no room it falls back to the 200 px minimum, elided, with the full text in the tooltip.
- **N3, PRINT stills in the media list.** `src/api/media-catalog.js isPrintScratchStill` hides
  `^\d{8}T\d{6}(\.png)?$` at the media root.
- **N4, duplicated trash.** `src/system/exfat-sync-map.js validateMap` adds a `_trash` exclude to the projects pairs.
- **N5, empty old media folder.** New `src/media/project-media-rename.js moveProjectMediaOnRename`, called from
  `retireRenamedSlug`.
- `src/engine/project-volume-sync.js:316`: a literal NUL byte became `\u0000`, so tools no longer read the file as
  binary.
- **Tests:**
  - `smoke-wo919-sweep-followups.test.js` (11) and `smoke-wo919-gui-sweep-followups.test.js` (13).
  - `test_wo919_followups.gd` and the N1 room cases in `test_header_model.gd`.

## What was verified

- **Suites:** offline 5206/0 and Godot 25747/0. Line limit and eslint are clean.
- **Live**, in the Godot GUI test client on Xvfb :120 against the box server, 01.11:
  - **F11:** New project logs `[project] new: cleared 4 show channel(s) (2, 4, 3, 5), 2 live look(s)`.
  - **F13:** Devices after New project shows only the Operator GUI destination, with no stale "Live audio input 1"
    card.
  - **N1:**
    - The "Caspar channel layout changed with this project — regenerate and Apply…" notice was readable, then
      overflowed the row (see the follow-up).
    - After the follow-up I switched to another show and loaded mhp_harder back. The notice elides at 200 px, and
      the window keeps Dio/Pro, the on-air strip, the clock and the inspector inside 1920 px.
  - **F2 (matching case):** Server ▾ shows "Server config matches … (7 channels)", the Module expects column (ch2
    "(screen)") and "The running Caspar config matches what Apply would write for the loaded project."
  - **N3:** `media/20261031T121932.png` is on disk but not among the 473 `/api/media` rows.
  - **N5:**
    - I renamed the show "Untitled 2" → "wo919 rename probe" in the header field, with
      `media/projects/untitled_2/n5_probe.mp4` present.
    - Journal: `rename untitled_2 → wo919_rename_probe: media folder moved …/media/projects/untitled_2 →
      …/media/projects/wo919_rename_probe`.
    - The old folder is gone and the file is in the new one.
  - **N4:** the same rename added exactly one trash entry per place: `projects/_trash` went 929 → 930 and
    `~/bridge/projects/_trash` 929 → 930.
  - **F6:**
    - mhp_harder `savedAt` stayed `2026-11-01T10:45:16Z` across three Loads and a full Apply ("Config written; layout
      applied; Caspar restarted."); only `rev` moved, 589 → 590.
    - The Load dialog's Saved column showed 11:45 local throughout.
- **Not verified live:** F26, which needs the F20 overlap reproduced.
- **Still open:**
  - **F4:** exclude disconnected outputs from the layout canvas and warn on Load.
  - **F20:** a rule for any uncabled connected head.
  - **N2:** needs an owner decision.
  - The web client's legacy autosave path.
