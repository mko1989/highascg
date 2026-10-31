# WO-891 — Second operator monitor: a second Godot window that workspace tabs move to

**Area:** godot-client, mapping
**Status: IN PROGRESS (31.10.26, built and tested: Godot suite 24245/0, smoke 6/6, Xvfb three-screen probe with screenshots; still needs owner QA on two real monitors)**

## Owner request

> id also like to create a two operator monitor setup. where the operator can have the main ui on main operator monitor
> and a secondary gui fo the secondary monitor. my thinking is, open a second godot window, empty gray at first with
> only the logo title in top left, and ability to send tab/tabs from the main ui, live, timeline, visuals, previs,
> audio, devices settings to the second monitor. this should be done by clicking an arrow pointing top right with a 2
> in a box next to it. when the tab is on the second monitor its not on the first. second monitor should allow
> multiple tabs.

## Investigation

- **Tab lookups all assumed one strip.** `godot/client/app/shell.gd` reached tabs with `tabs.get_node("…")` and
  switched them with `tabs.current_tab = …`. This covered `--tab`, the Devices inspect request, `sources.tab_requested`,
  the header requests from Settings and Devices, and the logo, which opens Visuals. `app/main.gd` probes used
  `shell.tabs.get_node(` (now lines 50–146), and so did `app/hardware_reconcile.gd:141`. Once a tab lives in another
  TabContainer, none of these find it.
- **The root window embeds subwindows.** Its dialogs and popups are embedded, so the second window must be a native
  OS window (`Window.force_native`). Godot 4.7 refuses `force_native` on a visible window, so it is set while the window
  is hidden.
- **A reparent runs `_exit_tree` / `_enter_tree` across the whole subtree.** Several tabs freed state in
  `_exit_tree`, meaning on any move:
  - `features/timeline/timeline_tab.gd` (now :150) freed its never-adopted Inspector pages.
  - `features/live/look_editor.gd` (now :360) freed its never-adopted Inspector page.
  - `features/previs/previs_tab.gd` (now :373) freed `track_page`.
  - `features/previs/fixtures/fixtures_3d.gd` (now :489) freed its mesh templates.
  - `features/devices/devices_tab.gd:219` unlistened prefs on `tree_exiting` and never listened again.
  - `features/previs/tracking/person_cards.gd:254` released its role holds and never took them again.
  - `features/visuals/visuals_tab.gd:176` calls `launcher.stop()` and frees the unadopted `page`. That file belongs to
    another agent and is **not fixed here** (see "Not done / open").
- **Shown/hidden matters.** WO-617 views lease the video surface on `visibility_changed`. A tab must be hidden before it
  leaves its strip and shown once it is in the other one; otherwise a lease is held twice or never released.
  A TabContainer re-shows its only tab when that tab is hidden, so `deselect_enabled` must be on for that one hide.
- **The tab title is lost on reparent.** The `_tab_name` metadata does not travel, so the Devices invite count
  `Devices (n)` would reset. The controller therefore keeps the titles.
- **One Live preview is shared.** WO-789 shares a single `LivePreview` between Live and Timeline. Timeline borrowed it
  whenever it became visible. With Timeline on monitor 2 and Live on monitor 1, Timeline took it and the Live tab went
  black (seen in the Xvfb probe).
- **Keys typed in window 2 never reach the main window.** The lock chord (WO-838 overlay `_input` plus polling) missed
  quick taps at low FPS. F3 (perf overlay) and undo/redo (`ProjectUndo._unhandled_key_input`) are handled on main-window
  nodes.
- **Choosing the default screen.** GET `/api/system/operator-screen` already listed outputs with `current`, the
  operator monitor. It did not say which outputs Caspar draws on. The layout plan
  (`calculateLayoutPositions`: screens, prv, multiview, mappingGpuOutputs `sysId`) does say this.
  `app/operator_screen_model.gd` `match_outputs` maps Godot screens to those outputs.
- **The Inspector is static.** `InspectorPanel.current` is static, so a tab in window 2 still drives the main window's
  Inspector unchanged. The Inspector stays in the main window, as asked.

## What was done

- **Server — `src/api/routes-operator-screen.js`.** Added `casparOutputNames(config)` (:66), which collects the sysIds
  of every planned Caspar screen, PRV, multiview and mapping output. GET now returns `caspar: true|false` on every
  output, and the dependency is injectable. Smoke: `tools/smoke/smoke-wo599-operator-screen.test.js` gains the WO-891
  case; the file is already curated.
- **`godot/client/app/tab_undock_model.gd` (new, pure)** holds:
  - `MOVABLE`: the owner's seven tabs. Multiview stays in the main window.
  - Strip order (`insert_index`), so both strips keep the shell order.
  - `restore_list`.
  - `pick_screen`: the saved pick if it exists and is not a Caspar output (the main screen is allowed, as a window on
    it); otherwise the first screen that is neither the main window's nor busy; otherwise -1, a plain window on the
    main screen.
  - `windowed_rect`, `screen_label`.
  - The ui.cfg `[second_window]` record: `tabs`, `screen`, `rect`. It is saved with one load-modify-save, as in WO-843.
- **`godot/client/app/second_window.gd` (new).** A native `Window` with the theme background and a header holding the
  logo and "HighAsCG" (the main header's left end) and a monitor `MenuButton` on the right. The menu lists each screen
  (Caspar outputs disabled), Automatic, and Close. Below the header is its own TabContainer. A `_Cover` child, added
  last, forwards every key to the lock overlay and swallows input while the app is locked; on lock it hides the
  dialogs of tabs living there. A `_Keys` node hands unused keys back.
- **`godot/client/app/tab_undock.gd` (new controller)** does the following:
  - Puts arrow-2 buttons on the main strip (`set_tab_button_icon` and `tab_button_pressed`) and arrow-1 buttons in
    window 2. The icons are new: `assets/ui/icons/send_to_2.svg`, `send_to_1.svg`, `screen.svg`, drawn at 20 px
    because 16 px was illegible.
  - `_move()` moves the same node: it releases focus inside the tab, hides it, removes it, inserts it at its order
    position, restores the kept title, then selects it (or keeps the current tab on a restore) and shows it.
  - Closing the window, either the WM close button or Close in the menu, sends every tab back.
  - `place()` asks the server, maps outputs to screens, then picks the screen. On a screen of its own the window is
    maximized, and borderless on the box as the main window is (WO-714). Otherwise it is a transient plain window over
    the main screen at its saved rect. `Placement.fit` applies the UI scale. It polls the X screen layout every 2 s and
    places the window again on a change.
  - Unhandled keys go to the shell's `_shortcut_input` (F3) and to `ProjectUndo._unhandled_key_input`.
- **`app/shell.gd`.** Creates the controller after the Settings tab. New `tab_node(name)` and `show_tab(page)`
  functions replace every `tabs.get_node` and `tabs.current_tab =` path, including `--tab`, the logo, the header
  requests and `tab_requested`. The Devices invite title goes through `undock.set_title`. `sized_logo` moved to
  `app/theme_builder.gd` so window 2 does not load the shell.
- **`app/main.gd`** probes now use `shell.tab_node(`. `shell.undock.restore()` (:459) runs after the main window is
  placed, so the second window is chosen relative to the main window's final screen. **`app/hardware_reconcile.gd:141`**
  uses `tab_node` / `show_tab`.
- **Reparent safety.** The `_exit_tree` teardowns listed above moved to `NOTIFICATION_PREDELETE`, each with an early
  return. Devices now listens again on `tree_entered`. Person cards take their holds again in `_enter_tree`.
  Why this approach: a move must not tear down a tab, and only a real free should.
- **Live wins the shared preview.** `features/live/live_preview.gd` has `home` (the Live video panel, set in
  `live_tab.gd:41`) and `home_shown()`. `features/timeline/timeline_tab.gd:122` borrows the preview only while the Live
  panel is not shown, and borrows it again when the preview's visibility changes. Why: the Live tab is the operator's
  primary view. A second preview instance would need a second WebRTC/surface lease, which is out of scope.
- **Tests.**
  - `godot/client/tests/test_tab_undock.gd` (new): model tests, plus headless moves with a visibility probe. They check
    that the node is the same, it leaves the main strip, it is hidden then shown, the title survives, the order is
    kept, close returns every tab, restore works from ui.cfg, Multiview never moves, and the menu rows are correct.
  - `tests/test_source_lists.gd` is repointed to `show_tab(tab_node("Visuals"))`.

## What was verified

- `./run-client.sh --check` passed after every edit. `./run-client.sh --test` reports **24245 passed, 0 failed**.
  `node tools/ci/check-max-file-lines.js` reports 0 files over 500. `node --test
  tools/smoke/smoke-wo599-operator-screen.test.js` reports 6/6. Live server: GET operator-screen returns DP-4
  `current:true caspar:false` and DP-0 `caspar:true`.
- **Xvfb probe.** Private display `:89`, a 7680×1792 root with xrandr monitors OP (1920×1080 at 0,0), LED (3840×1792 at
  1920,0, the Caspar DP-0) and SEC (1920×1080 at 5760,0). Openbox ran on it, the client had an isolated
  `XDG_DATA_HOME`, and the owner's ui.cfg was untouched (same sha256 before and after). Results:
  - Restore from ui.cfg opened window 2 maximized on SEC, **not** on the LED/Caspar screen.
  - The arrow-2 click moved Timeline there. The arrow-1 click returned Audio to its old place in the order, selected.
  - The main Inspector showed Previs's page while Previs was driven from window 2.
  - F3 pressed in window 2 toggled the perf overlay in the main window.
  - Ctrl+Shift+L in window 2 locked both windows, a click was swallowed while locked, and unlock worked.
  - The screen menu showed DP-0 disabled as "Caspar output". Picking Screen 1 gave a framed 1280×720 window over the
    main window, and its rect was saved.
  - Shared preview: with Live on main and Timeline in window 2, Live keeps it. Switching main to Audio let Timeline
    take it, and switching back to Live returned it.
- Screenshots are in the session scratchpad
  (`/tmp/claude-1000/-home-casparcg/03d195b7-40ef-44d0-b117-27e2e6a3e0d1/scratchpad/`):
  - `wo891_1_restore.png`, `wo891_1_second.png`
  - `wo891_2_strip.png` (icons)
  - `wo891_3_second.png`, `wo891_4_main.png`
  - `wo891_5_f3_main.png`, `wo891_6_locked_small.png`
  - `wo891_8_menu_crop.png`, `wo891_9_on_main_crop.png`
  - `wo891_10_small.png`, `wo891_11_small.png`, `wo891_12_small.png` (preview handoff)

## Not done / open

- **`features/visuals/visuals_tab.gd:176` still tears down in `_exit_tree`.** Moving Visuals stops a running Game scene
  (`launcher.stop()`) and can free its unadopted Inspector page. The fix is to move it to PREDELETE:
  `func _notification(what): if what == NOTIFICATION_PREDELETE: launcher.stop(); if is_instance_valid(page) and not
  page.is_inside_tree(): page.free()`. It was left alone because that file belongs to the concurrent visuals work.
- **Live and Timeline on different monitors.** With Live shown, Timeline's preview slot stays black, because there is
  one preview by design (WO-789).
- **Dialogs parented to `get_tree().root`** (`shader_fx_dialog`, `usb_import_dialog`) open over the main window even
  when their tab is in window 2.
- **Not tested:**
  - Cross-window drag and drop, for example Sources onto a tab in window 2.
  - Real two-monitor behaviour on the box, including Openbox maximize on a real second head.
  - The WO-638 boot screen gate when a second lit monitor has no destination.
