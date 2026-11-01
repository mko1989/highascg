# WO-919 — WO-918 follow-ups: the findings the 01.11 fix round left open

**Area:** godot-client, engine, devices-config, mapping
**Status: IN PROGRESS** (everything but N2 done and verified live 01.11.26; N2 waits for an owner decision)

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

### Second round (01.11, F4 / F20 / web autosave)

- **F4: one unplugged head failed the whole layout.**
  - `applyX11Layout` (`src/utils/os-config-xrandr-apply.js`) sends every planned head in ONE `xrandr --output …`
    command.
  - With frontex loaded, `/api/system/xrandr-layout` planned DP-2 at +1920+0 as 5760x1728. xrandr reports DP-2
    `disconnected`.
  - `xrandr --output DP-2 --pos 1920x0 --mode 5760x1728 --rate 50` on its own gives `xrandr: cannot find mode
    5760x1728` and exit 1, and nothing is applied. So none of the frontex heads moved.
  - The same head also counted toward the planned canvas in `needsNodmRestartForLayout`, so it pushed the nodm
    decision.
  - The name resolver (`xrandr-output-resolve.js`) maps a stale pinned name onto a live sibling when it cannot place
    it (WO-315). A pinned name the DRM inventory knows stays as it is, and that is the case on this box (DP-2).
- **F4: the Caspar window over the GUI.**
  - frontex stores its operator destination with `videoOutput: "screen"`, the kiosk-era output: a Caspar screen
    window under the Firefox kiosk, which is gone since WO-646.
  - A Load applied the show's `hardwareConfig` as-is (`project-hardware-config.js applyHardwareConfigFromProject`),
    so the window came back over the Godot GUI.
  - New project already treats this as the box's own setting (`new-project.js keepOperatorVideoOutput`, WO-684).
    Load did not.
  - My first pre-fix frontex Load in this round left `screen` in the live config. The rule below then kept it, so
    the box was set back to shm in Devices (`updateDestination videoOutput:"shm"`).
- **F4: no warning on Load.** The Load reply had no hardware facts. `hardware_reconcile.gd` runs only on
  boot/reconnect.
  - Also: the "Missing assets" notice that `check_assets()` raises after every Load REPLACED the Load notice. That
    included the WO-918 F1 owed-restart notice, so it vanished within a second.
- **Restart owed after a round trip.**
  - `project-activate.js` compared the module config before and after the Load, never the running Caspar.
  - Loading frontex, then mhp_harder with no Apply in between, said "restart CasparCG" although Caspar still ran
    mhp_harder.
- **F20.** An output that is lit but not in the plan is never part of the xrandr command, so it keeps its old
  position. On 01.11 that was DP-6 at +1920+0, under the planned DP-0.
- **Web legacy autosave.**
  - The web client posted `{ project }` with no `editingSlug`.
  - After another client or an API Load switched shows, the tab kept the old show. Its next autosave went through
    `previousSlugKind`'s guess (`other_show`) into `persistProject`, which made the OLD show active again.
  - Nothing in the web client reacted to `project.activated`.
- **F6 hole, found while probing the web tab.**
  - `showContentEquals` and `projectContentEquals` compared `JSON.stringify` output, which depends on key order.
  - A web tab exports keys in another order than the stored file, so a fresh tab's first autosave of unchanged
    mhp_harder bumped rev 592 → 593 and stamped savedAt `12:48:27.473Z`.
  - The only real difference was `hardwareConfig.osDisplay.multiview_os_rate: ""`, a server-stamped slice.

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

### Second round (01.11)

- **F4 / F20: new `src/utils/xrandr-unplanned-heads.js`.**
  - `parseXrandrOutputStates` reads every output line: connected, lit geometry, current mode and rate.
  - `reconcileHeadsWithOutputs` drops planned heads on `disconnected` outputs.
  - It moves a lit unplanned output that overlaps the plan to the right of everything, keeping its current mode and
    rate. One that overlaps nothing stays put, and off outputs are left alone.
  - With no xrandr answer the plan passes unchanged.
  - Why move rather than turn it off: an unplanned monitor is still somebody's screen. Moving it keeps it usable and
    out of the playout canvas.
- **Wiring.**
  - `applyX11Layout` runs the reconcile before it builds the command and returns `disconnected` / `movedUnplanned`.
  - `needsNodmRestartForLayout` sizes the canvas from the same reconcile, so the nodm decision matches what is
    really placed.
  - `GET /api/system/xrandr-layout` also returns that `canvas` check, which shows what an Apply would do without
    running one.
- **F4: Load names the unplugged outputs.**
  - `routes-data-project-handlers.js` puts `_activation.unpluggedOutputs` in the Load reply when `applyHardware` is
    set.
  - `header_model.gd load_notice` appends "Not connected: DP-2 — Apply leaves it out." The notice is sticky, also
    after the owed-restart text.
- **F4: a second sticky notice joins instead of replacing.**
  - New `header_model.gd joined_notice` and `header_project.gd say_also`. `hardware_reconcile.gd check_assets` uses
    it.
  - The worse tone and the owed restart (`restart`) are kept, and the tooltip carries both.
- **F4: operator output.**
  - `applyHardwareConfigFromProject` applies a copy of the show's `hardwareConfig` through `keepOperatorVideoOutput`
    (now exported). The box's `videoOutput` and `shmName` win, and the stored show is not rewritten.
- **Restart owed follows the running Caspar.**
  - `project-activate.js` awaits `refreshConfigComparison`. When Caspar's INFO CONFIG is known, `restartRequired =
    !aligned`.
  - The module before/after signature is only the fallback.
- **Web client: new `client/lib/project-follow-server.js`.**
  - Autosaves carry `editingSlug` (`autosaveBody`).
  - A 409 `not_active`, or a `project.activated` for another slug (`activatedElsewhere`), pulls the active show
    silently (`followServerProject`) and toasts "The server switched to …".
  - `load-project-modal.js` sets the tab's slug before its own Load, so its own broadcast is not taken for a switch.
- **F6.** New `canonicalJson` in `project-scenes.js` (sorted object keys, arrays in order). Both equality checks use
  it, so a reordered but equal show is a no-op write.
- **Gates.**
  - `tools/ci/offline-test-files.js` was at 502 lines, so the two new smokes are listed in
    `offline-test-files-2.js`.
  - The unused exports `clearPersistedAir` and `countFiles` from round one are no longer exported (WO-367 gate).
  - The N1 source pin in `smoke-wo919-sweep-followups.test.js` now expects `notice_width(text_w, window_w, room)`.
- **Tests:**
  - New `smoke-wo919-xrandr-unplanned-heads.test.js` (6), including a test that a loaded show keeps the box's
    operator output.
  - New `smoke-wo919-web-follows-server-show.test.js` (3).
  - A running-Caspar restart test in `smoke-project-load-activation.test.js`. It fails on the old before/after rule
    (checked by forcing the fallback).
  - Key-order cases in `smoke-wo919-gui-sweep-followups.test.js`.
  - Godot: `test_header_model.gd` covers the unplugged load notice and `joined_notice`.

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
- **Second round, live on the box (01.11):**
  - **F4/F20, plan:** with frontex loaded (no Apply), `/api/system/xrandr-layout` reports
    `canvas.disconnected: ["DP-2"]`, `movedUnplanned: ["DP-4"]` (DP-4 lit at 0,0 under frontex's DP-6) and `needed:
    true`.
    - The nodm restart is still owed for a real reason: frontex asks DP-0 for 1920x2304.
    - mhp_harder: `canvas_fits`, nothing dropped or moved.
  - **F4/F20, command:** a dry run of `applyX11Layout` (`live:false, persist:false`) against the loaded config builds
    `xrandr --output DP-0 --pos 7680x0 --mode 1920x2304 --rate 50 --output DP-6 --pos 0x0 … --output DP-4 --pos
    9600x0 --mode 1920x1080 --rate 50`. DP-2 is gone, so `cannot find mode` can no longer fail the command.
  - **Not run:** a real frontex Apply. It would restart nodm, and it asks the NovaStar on DP-0 for a mode its EDID
    does not drive.
  - **F4, Load notice:** in the Godot GUI (test client on Xvfb :120), header Load frontex shows "Caspar channel layout
    changed … Not connected: DP-2 — Apply leaves it out. · Missing assets — 7 media clips …". The tooltip lists the
    clips.
  - **F4, operator output:** with the box set to shm, `POST /api/project/load {frontex, applyHardware}` leaves
    `config/screen_destinations.json` at `videoOutput: shm, shmName: opgui`. Before the fix it became `screen`.
  - **Restart owed:** Load frontex gives `restartRequired: true, unpluggedOutputs: ["DP-2"]`. Load mhp_harder right
    after, with Caspar still running mhp_harder, gives `restartRequired: false`.
  - **Web client:** a headless Firefox (WebDriver BiDi, own profile, not on :0) opened the web UI on mhp_harder.
    `POST /api/project/load frontex` turned the tab's project from "mhp harder" to "frontex" within 5 s.
  - **F6:** with the fix, a fresh web tab on mhp_harder left `savedAt 2026-11-01T12:48:27.473Z` and rev 594
    untouched. Before, the same boot stamped it and bumped the rev.
  - mhp_harder was loaded back afterwards (`restartRequired: false`). The probe Firefox and the test client were
    stopped.
- **Not verified live:**
  - F26, which needs the F20 overlap reproduced. F20 now prevents the overlap, so it can only be reproduced by hand.
  - The web 409 `not_active` path (the offline smoke covers it).
- **Still open:** N2 needs an owner decision.
