# WO-919 — WO-918 follow-ups: the findings the 01.11 fix round left open

**Area:** godot-client, engine, devices-config, mapping
**Status: DONE** (01.11.26: F2–N5 verified live; N2 by the owner's decision "write it" (stale edit + switch stamp), verified offline — smoke-wo919-n2-stale-edit-saved 9/9, 36 related smokes 290/0, mutation checks; not probed on the live server by request)

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
  Owner decision 01.11.26: write a stale client's last edit into ITS show's file (rev-checked) instead of dropping
  it. Investigation and fix under "N2" below.
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

### N2 (after the owner's decision, 01.11)

- **The refusal drops the payload.** `routes-data-project-handlers.js:369` (`slugConflict`) returns 409 `not_active`
  for `stale_client` before anything is stamped or written. Client A's edit of show X never reaches X's file.
- **Where a destination edit lives.** Godot Devices edits go to `POST /api/device-view` (`destinations_panel.gd:190`),
  which changes the LIVE config only. `src/api/device-view-*.js` never writes a project. The edit reaches the show at
  its next save/autosave: `stampProjectHardware` (handlers `:377`) stamps the live rig into `hardwareConfig`
  (`injectHardwareConfigToProject`), or keeps the stored slice while the show is held (WO-821). The client's own
  `hardwareConfig` is only the copy it loaded. No Godot code writes it (`rg hardwareConfig godot/client` outside the
  file import), and a normal autosave never takes it.
- **So the stale write cannot simply stamp the live rig.** After the switch the live rig is X's only if the load of Y
  did not apply Y's hardware. Godot header Load always sends `applyHardware: true` (`header_project.gd:204`). A load
  without hardware (web "Load without hardware", API loads like the WO-918 sweep's) leaves X's rig live and holds Y.
  A chain X → Z (with hardware) → Y (without) holds Y while Z's rig is live, so "Y is held" alone is not proof.
- **`persistProject` always activates.** `project-scenes.js:300-302` sets the active slug and the `web_project`
  mirror. `:323-333` rewrite the live deck and notify the shared show (WO-746). `:271` migrates config stream
  credentials into the written project. None of that may happen for a show that is not open.
- **The autosave payload is enriched with the LIVE deck** (handlers `:361`), which is Y's after the switch. A stale
  write must use the raw payload.
- **A Devices edit fires no autosave.** `devices_tab.gd:126` (`_dests.changed`) only marks Apply dirty and reloads
  Settings; nothing calls `ProjectSync.mark_dirty`. So even with ONE client, a destination edit reaches the show only
  if some other edit autosaves it before the next hardware-applying switch replaces the live rig. That is the case
  the stale-edit write alone cannot cover (the rig is gone before A's autosave arrives).
- **Every path that replaces the live rig with another show's** (`rg applyHardwareConfig src`):
  - Load with `applyHardware: true` → `project-activate.js:196` `applyHardwareConfigFromProject`. Godot header Load
    always sends it.
  - New project → `new-project.js` `applyHardwareConfigToCtx(ctx, starter)`.
  - A taken cluster show (WO-746) → `shared-show-ctx.js commitShow` applies its screen destinations when they differ.
  - Not a switch to another show: `/api/project/apply-hardware` (re-applies a rig to the open show, e.g. the hardware
    reconcile dialog applying the show's own saved rig), Load without hardware (the rig stays), the bootstrap load
    `{}`.
  - Follower-only: `replicate-projects.js:36` `commitReplicatedProject`, `caspar-parity.js:208`,
    `follower-machine-profile.js:146`. A follower mirrors the leader's show; its files are leader copies with the
    device-local slices stripped (`stripDeviceLocalFromProject`), and its rig is its own machine profile.
- **Replication.** The autosave's `scheduleProjectPushToPeer` (handlers `:440`) sends `getActiveSlug()`
  (`replicate-projects.js:82`), and the follower persists it as its live show (`:32`). Pushing X would switch the
  follower to X under Y's slug. Volume push (`pushProjectSlugToVolumes`) is per slug and does not activate.

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

### N2: a stale client's last edit is saved into its own show (01.11, owner decision)

- **New `src/api/routes-data-project-stale.js` `saveStaleClientEdit`**, called from the autosave's `stale_client`
  refusal. The answer stays 409 `not_active` (the client adopts the open show as before), plus either
  `savedTo: "<slug>", rev, changed, hardware` (and an `error` text saying where the edit went) or
  `savedTo: null, notSaved: "<why>"`. Each outcome logs one `info` line: `stale client's last edit of "x" saved
  into its file (rev n, hardware live|stored)` or `… NOT saved (<why>)`.
- **What is written, and when:**
  - Only when the payload IS the show the client edits (payload slug == `editingSlug`). A stale rename stays refused
    and unsaved (`notSaved: "rename"`): renaming a show nobody has open is not an edit.
  - Only an existing show (`no_stored_show` otherwise). Like WO-311, a stale write never creates or resurrects a
    file.
  - **Rev rule:** the payload must carry a server-issued `rev` (`no_rev` otherwise), so it never wins on a client
    clock. It then passes the normal autosave guard `validateIncomingProject`: a newer stored rev wins (`stale_rev`),
    and there is no empty-over-looks and no unrelated look set. The write bumps the rev like any persist. An
    unchanged echo writes nothing (`changed: false`).
  - The client's RAW payload is written, not the live-deck-enriched copy. `preserveClientOwnedSlices` runs as on
    every autosave.
- **hardwareConfig: new `stampStaleShowHardware` in `project-hardware-hold.js`.**
  - The client's `hardwareConfig` is never written: it is the load-time copy, and a normal autosave never takes it
    either.
  - The live rig is stamped (the normal autosave path, `stampProjectHardware` with `autosave`, so WO-311's
    empty-rig guard applies) only when it provably still is X's: X is not held, and the open show Y was loaded
    without its hardware while X's rig was live.
  - Otherwise X keeps its stored slice (`hardware: "stored"`). Stamping would write another show's rig into X, which
    is the WO-821 damage.
  - To make "while X's rig was live" exact, a load without hardware now records `rigOf` in its WO-821 hold:
    `liveRigOwnerAfter(prevSlug)` returns the previous show, or that show's own `rigOf` if it was held too. A
    repeated load of a held slug refreshes it. The X → Z → Y chain therefore records Z, and X keeps its stored slice.
- **`persistProject(..., { activate: false })` in `project-scenes.js`.**
  - It writes the file, the `_autosave` copy and the bridge / stick copies, the same files a normal autosave
    writes. The `_autosave` copy matters because a later Load merges it (`loadProjectForSlug mergeAutosave`), and a
    stale copy left behind could out-date the file.
  - It does not set the active slug, the `web_project` mirror, the deck or the shared-show hook, and it does not run
    the config credential migration.
  - An unchanged content is a no-op for an inactive write too.
  - The early return carries `activated: false`, so the WO-746 pin on the activating return still holds.
- **Not done on purpose:** no project_sync broadcast and no Art-Net reconfigure, because X is not the live project.
  No replication peer push either: it sends the active slug and the follower adopts it as its live show.
- **`routes-data-project-handlers.js`:** wires the above and computes `rigOf` before the Load's `setActiveSlug`. It
  also drops an unused `slug` in the Load path (an eslint warning that was already there).
- **Switch stamp: new `src/engine/project-switch-stamp.js` `stampOutgoingShowRig(ctx, nextSlug)`.** This is the
  outgoing show's final autosave of its rig, run just BEFORE another show's hardware replaces the live rig. It closes
  the case where the switch applies Y's hardware before A's autosave arrives (and the one-client case: a Devices edit
  fires no autosave). The guards are exactly those of an autosave of the open show:
  - only when the open slug differs from the incoming one and has a stored file (never creates or resurrects one);
  - not when it is held (WO-821: loaded without its hardware, so the live rig is not its own and its stored slice
    stays);
  - through `stampProjectHardware` in autosave mode (the WO-311 `preserveWhenEmpty` rule), and never a rig without
    operator intent (`hardwareConfigHasOperatorIntent`, WO-882): an empty / factory rig is not an edit;
  - only when the stamped `hardwareConfig` differs from the stored one (`canonicalJson`): an unchanged rig writes
    nothing and bumps no rev;
  - written through `persistProject(..., { activate: false })`: rev bump, `_autosave` copy and volume copies, no
    activation. `savedAt` stays (F6: a hardware-only change is not a show edit);
  - one info line per stamp: `[project] "<slug>": live rig saved into it before switching to "<new>" (rev n)`. A
    failure logs a warning and never blocks the switch.
- **Paths covered:**
  - `/api/project/load` with `applyHardware: true` (handlers, before `setActiveSlug`; GUI Load, web Load with
    hardware, API loads);
  - New project (`createNewProject`, before the starter rig is applied; the new name is now chosen first, so the log
    names it);
  - a taken cluster show of another slug (`shared-show-ctx.js commitShow`, before `persistProject`; a same-slug take
    stamps nothing).
- **Paths deliberately not covered:**
  - `/api/project/apply-hardware`: the open show stays open. Applying a rig to it is the operator's explicit choice,
    and stamping the live rig first would just re-save what is being replaced on purpose.
  - Load without hardware: the rig does not change. The stale path's `rigOf` rule covers a late autosave.
  - A same-slug reload with hardware: an explicit "load this show with its hardware".
  - The follower paths (`commitReplicatedProject`, `caspar-parity`, `follower-machine-profile`): the follower does
    not own the show. Stamping its own machine rig into its leader copies would fork them from the leader.
  - Factory reset / stick insert: the reset is intended (clean ISO).
- **Interaction with the stale-edit write.** The stamp bumps X's rev, so A's last autosave (at the rev it held)
  would read as `stale_rev`. The stamp records `{ slug, fromRev, rev }` (persistence `project_switch_stamp`).
  `switchStampRebase` lets a stale autosave at exactly `fromRev` through while X's stored rev is still the stamp's: the
  stamp is the only write since that rev. The stale write keeps the stored (stamped) slice, because after a
  hardware-applying switch `rigOf` is never X, so nothing is lost. A second copy at that rev is `stale_rev` again.
- **Other changes:** `canonicalJson` is exported from `project-scenes.js`.
- **Tests:**
  - New `tools/smoke/smoke-wo919-n2-stale-edit-saved.test.js` (9, listed in `offline-test-files-2.js`). It covers:
    - the rig still X's: X saved with a rev bump, the live destination edit and the `_autosave` copy;
    - Y loaded with its hardware: X saved, its slice is X's own edited rig (the switch stamp), never Y's;
    - the X → Z → Y chain: stored slice;
    - an older rev and a missing rev: not written;
    - a stale rename: not written, no fork, nothing retired;
    - an unchanged echo: no write;
    - switch stamp, Load Y with hardware: X's edited destination is in X (file and `_autosave`, rev +1, log line)
      before Y's rig goes live. A's stale autosave at the pre-stamp rev is then rebased: X has its added look AND the
      edited destination (rev +2). A second copy at that rev is `stale_rev`;
    - switch stamp guards: X held → untouched; an empty live rig → untouched; an unchanged rig (second round trip)
      → no write and no log; reloading the open show → nothing;
    - New project: the outgoing show keeps its edited destination, with a log line naming the new show.
  - Every stale case asserts that Y's file, the live deck, the `web_project` mirror and the active slug are untouched.
  - `smoke-wo918-project-switch.test.js` F28 now also pins `notSaved: "no_rev"` for its rev-less payload. All its
    old assertions are kept.

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
- **N2 (offline only, 01.11):**
  - `node --test tools/smoke/smoke-wo919-n2-stale-edit-saved.test.js`: 9/9.
  - Mutation checks, each restored afterwards:
    - `stampStaleShowHardware` forced to always stamp the live rig: the "Y loaded with its hardware" and X → Z → Y
      tests fail (a WO-821-class write is caught);
    - the Load-handler stamp removed: the two hardware-applying switch tests fail;
    - the rebase removed: the stale-after-stamp test fails;
    - the WO-311 guard removed (no autosave mode, no intent check): the guards test fails;
    - the hold guard removed: the guards test fails.
  - The project smokes that grep or drive these paths (wo329, wo598, wo918-project-switch, pipeline-hardening,
    wo919 ×3, wo824, wo311, wo746, wo842, wo617, wo614, wo823, wo261, wo821, wo585, new-project, wo718,
    fresh-box-clean-device-view) plus the new one: 170/170.
  - All 36 smokes that reference the project modules / handlers / `new-project` / `shared-show` /
    `project-switch-stamp` / `/api/project/` (dmx-615 excluded): 290 pass, 1 skipped, 0 fail.
  - `check-max-file-lines` is at 0 over, `check-unwired-exports` has no new orphans, `format:check` is clean, and
    eslint is clean on the changed files.
  - Not probed on the live :4200 server: autosaves and loads there write the owner's shows. Owner-visible check after
    deploy: edit a destination in Devices, header-Load another show, and the journal shows
    `live rig saved into it before switching to …`. Loading the first show back keeps the edit.
