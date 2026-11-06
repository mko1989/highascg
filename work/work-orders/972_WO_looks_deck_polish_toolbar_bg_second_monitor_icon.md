# WO-972 — looks deck polish: no "Looks" toolbar toggle, lighter deck background, send-to-second-monitor icon only with a second operator monitor

**Area:** godot-client
**Status: IN PROGRESS (06.11.26 — code + Godot suite 26011/0 + smoke 4/0 done; on-glass check NOT done: the box lock was held by an unseen holder for 20+ min, so the GUI was not relaunched; it still runs the pre-WO build)**

Owner show notes 06.11.26 (batch WO-970…975):
1. *"In the top bar of looks deck there is a Looks button that hides all the looks… WHY?! Remove that button."*
2. *"The background on the looks deck is to dark, can barely distinct it from the black bg of live preview."*
3. *"when there is no second operator monitor connected in devices tab there shouldn't be the send to second monitor icon visible."*

## Investigation

1. **Looks toggle** = WO-781 toggle. `features/live/live_tab.gd` built it in `_transition_toolbar()` (`for k in ["looks"]`),
   stored it in `_show_btns`, restored it from `ui.cfg [live] show_looks` in `_ready`, and pushed it to `deck.show_looks`.
   `features/live/deck_view.gd` had the `show_looks` property and used it in `_column()` to hide the grid. Only
   references outside the client: `tools/smoke/smoke-wo781-look-preset-destinations.test.js` (pinned the lines).
   No Godot test referenced it.
2. **Deck background**: `features/live/deck_view.gd` is a bare ScrollContainer with no panel stylebox, so it showed the
   window's `BG_DARK` (#0d1117) next to the preview's `Color.BLACK` (`live_tab.gd` video panel).
3. **Send-to-second-monitor icon** = the arrow-2 corner button `_main_btn` ("send_to_2") in `app/tab_undock.gd`
   (WO-891), shown while the current main tab is movable (`tab_undock_model.gd` `movable`). Nothing checked whether a second
   operator monitor existed. The Devices-tab cable that defines operator monitor 2 is WO-920's `gui: 2` on
   `GET /api/system/operator-screen` (`src/api/routes-operator-screen.js`), matched to this machine's screens by
   `ScreenModel.match_outputs` and read by `TabUndockModel.cabled_screen`. `shell.gd` already calls `undock.recheck()` on
   Ws `hardwareConfig` / `caspar.applied` / `project.activated`, so the state can follow config changes there.
   Live box at investigation time: DP-6 = operator monitor 1 (gui 1), DP-2 = Caspar output, no gui 2, so the icon should be hidden.

## What was done

- `features/live/live_tab.gd`: removed the Looks button loop, `_show_btns`, `_set_shown()`, the `ui.cfg show_looks`
  read/write, and the `UI_CFG` const (now unused). Added `deck.add_theme_stylebox_override("panel",
  ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 0, 0))` next to the deck's creation (the existing
  panel token #161b22, the same as the other panels; BG_ELEVATED would have blended with the look cards).
- `features/live/deck_view.gd`: removed the `show_looks` property and `grid.visible = show_looks`; the column now loops
  `for s in looks:`. Net -5 lines (495/500).
- `app/tab_undock.gd`: new `_has_second` (default false). `_refresh_buttons()` shows the arrow only when `_has_second`
  and the tab is movable. `set_has_second(on)`. `_probe_second()`: off the box (no `api`) = more than one screen;
  on the box = `M.cabled_screen(ScreenModel.match_outputs(outputs, screens)) >= 0`. Called from `setup()` and from
  `recheck()` (so every Devices / hardware / project change re-asks).
- `tests/test_tab_undock.gd`: `_rig()` declares a second monitor (`set_has_second(true)`, headless has one screen); new
  asserts that the arrow is hidden without it and back with it.
- `tools/smoke/smoke-wo781-look-preset-destinations.test.js`: repointed to the new deck line; asserts `show_looks|_show_btns`
  is gone from `live_tab.gd`. Assertions were not weakened.
- Persisted `[live] show_looks` in existing `ui.cfg` files is now ignored (no migration needed).

## What was VERIFIED

- `node tools/ci/check-max-file-lines.js`: 0 files over 500 lines.
- `GODOT=~/.local/opt/godot/godot godot/client/run-client.sh --test`: `[tests] 26011 passed, 0 failed` (log:
  `/tmp/claude-1000/-home-casparcg/2c8389df-06bf-48f2-a6e2-f30036bbf7b0/scratchpad/godot_test.log`). Two "Parse JSON failed"
  lines appear in that log; they are pre-existing test-run output, not failures.
- `node --test tools/smoke/smoke-wo781-look-preset-destinations.test.js`: 4 pass, 0 fail.
- `prettier --check` on the touched JS smoke file: clean.
- NOT proven on glass: the relaunch and screenshot. `flock` on `scratchpad/box.lock` was held by an invisible holder (PID 36926,
  another PID namespace) for 20+ min with other agents queued. I cancelled my queued relaunch rather than break it.
  The running GUI (PID 37160, `run-client.sh --autostart --tab=Live`) is still the pre-WO build.
  To finish: under the lock, `setsid godot/client/run-client.sh --autostart --tab=Live` after TERM-ing the old loop
  (`kill -TERM 37140`, then 37160), then `ffmpeg -f x11grab -i :0 -frames:v 1 <png>` and check: no Looks button, lighter
  deck panel, no arrow-2 on the Devices tab (`--tab=Devices`) while `/api/system/operator-screen` shows no gui 2.
- Not checked: the cable-change path (add/remove dot 2 while the GUI runs); it relies on the existing `hardwareConfig` Ws
  event that `recheck()` already listens to.

Files changed: `godot/client/features/live/live_tab.gd`, `godot/client/features/live/deck_view.gd`,
`godot/client/app/tab_undock.gd`, `godot/client/tests/test_tab_undock.gd`,
`tools/smoke/smoke-wo781-look-preset-destinations.test.js`, new `work/work-orders/972_WO_looks_deck_polish_toolbar_bg_second_monitor_icon.md`.

OPEN_ISSUES one-liner: `| WO-972 | Looks deck polish: remove toolbar Looks toggle, lighter deck bg, send-to-2 icon only with a second operator monitor | WO-972 | IN PROGRESS — code+suite done, glass pending (box lock) |`
