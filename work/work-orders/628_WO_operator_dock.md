# WO-628 — operator dock: an auto-hiding app dock at the bottom centre of the Godot client

**Status: DONE (20.10 — box: rest-to-reveal, launch/focus, ⋯ list launch; smoke 11/11; Godot tests)**

Owner 20.10: "because we are running a normal app with no funny business with windows and cut outs, we can start
treating the operator gui as a normal computer screen. I'd like to add an extremely small [dock], maybe with autohide,
in the middle bottom (macOS dock style), with the most important apps and more which shows a menu list. So no need
for the 'taskbar' hack in the top bar." After the first cut: "the dock is way too small. It can be bigger, just needs
to auto hide and not be too triggery to pop up."

## Investigation

- The web header's "Open window ▾" (WO-283, `client/components/header-bar-operator-helper.js` +
  `header-bar-operator-app-menu.js`) exists for the kiosk: it promotes helpers to the ABOVE layer, suspends the kiosk's
  top-assert, runs one helper session at a time and restores the kiosk when the helper exits. None of that applies to
  the Godot client, which is an ordinary window. So it is **not ported**.
- What carries over is the vocabulary and the gate. That means the five curated tools, whose special launch paths
  (isolated Firefox profile, media-path file manager, NVIDIA display policy) live in `spawnGuiDetached`, plus
  `app:<desktop-id>` for any installed app (WO-387 catalog, `isHelperAction`). Icons come from
  `/api/system/operator-helper-icon`.
- Openbox refuses a client raising itself (`DisplayServer.window_move_to_foreground` did nothing). To bring HighAsCG
  back over an app, the server runs `xdotool windowactivate`.
- A Godot tooltip is clamped to the screen bottom, which puts it on the dock under the pointer, where it swallowed the
  click. A `PopupMenu` child of the unfocusable dock closed the moment it opened (a popup needs focus), so "⋯" showed
  nothing.

## What was done

- Server (owner directive D: every function is an endpoint):
  - `src/system/operator-dock.js`: `dockModel` (pinned + the other installed apps, by name, pinned ones left out),
    `getDock`, and `launchOrFocus(action)`. `launchOrFocus` is gated, then focuses the running window if there is one
    (a Firefox profile-lock dialog counts as running: it is brought forward, never a second Firefox), else spawns the
    app. `highascg` activates the operator window.
  - `src/api/routes-operator-dock.js` + `router.js`: `GET /api/system/dock` and `POST /api/system/dock/launch {action}`,
    behind the same nuclear-password gate as `/api/system/gui-launch`.
- Godot:
  - `app/operator_dock.gd`: a native, borderless, always-on-top, unfocusable window.
    - Collapsed it is a 160×4 line at the bottom centre. The pointer must **rest** on it for 0.4 s (`REVEAL_S`);
      sweeping past does nothing.
    - It closes 1 s (`HIDE_S`) after the pointer leaves the dock and its list.
    - Expanded it holds 52 px cells with 40 px icons: HighAsCG, │, Web browser, File browser, DeckLink setup, DeckLink
      updater, NVIDIA settings, ⋯.
    - Names show in a click-through bubble window above the hovered icon, not as tooltips.
  - `app/operator_dock_menu.gd`: the ⋯ list, its own unfocusable window. It is right-aligned above the dock, with icon
    and name rows, sized to its measured content and capped to the screen (it scrolls). Hovering it keeps the dock
    open.
  - `app/operator_dock_model.gd`: pure geometry, gating (loopback origin only, since apps open on the box's screen;
    `--dock=1/0` overrides) and icon decoding.
  - `app/shell.gd`: adds the dock, whose errors go to the header notice.

## What was VERIFIED

- `tools/smoke/smoke-wo628-operator-dock.test.js` (curated): 11/11 pass. It covers model order and filtering, the gate
  refusing `rm -rf /`, launch vs focus, the profile-lock dialog, no-xdotool, spawn failure, self-focus 404, and the
  router wiring.
- `tests/test_operator_dock_model.gd`: wanted, geometry, menu rect and icons. Godot suite: 16161 pass. Offline suite:
  2887 pass, 0 fail. Lint 217 / 218, prettier, line limit, unwired exports, `node index.js --no-http`: all OK.
- Box (screen 0, DP-2):
  - Collapsed: 160×4 at 2800,1076. A fast vertical sweep across it leaves it collapsed; resting on it expands it to
    413×64 at 2673,1016.
  - "⋯" opens a 300×543 list right-aligned above the dock, with all 14 apps, icons and no scrollbar.
  - Picking File Roller logs `dock app:org.gnome.FileRoller → 200` and the window opens. The dock collapses after the
    pointer leaves.
  - Earlier cut: Firefox launches, a second click focuses it, the HighAsCG button reactivates the operator window, and
    5/5 alternating clicks register.
  - The test Firefox and File Roller were closed afterwards.

## Open

- ~~A configured nuclear password makes launch answer 403 `passwordRequired`. The dock only shows the error and has no
  prompt yet.~~ Fixed 20.10: launches go through `app/nuclear_gate.gd` (prompt, retry, remembered for the session) —
  box-verified with a temporary password (wrong → "Wrong password — try again", right → File browser opened; ui.json
  restored byte-identical). See WO-608 "Settings → Updates + nuclear password prompt".
- One Firefox click right after a node restart launched a second Firefox instead of focusing (window search probably
  timed out during startup). Not reproduced since.
- ~~No running-app indicators (macOS dots)~~ — done 21.10 (below). No user-editable pinned set.

## 2026-10-21 — Running dots (the WO's open item)

**What was done.**
- Node `getDock()` (now async) adds `running` to `GET /api/system/dock`: the pinned tools that have a window open.
  It uses the same `findGuiWindowIds` + `classifyHelperWindows` lookup as launch-or-focus, so a Firefox
  profile-lock dialog counts. The 5 lookups run in parallel (≈70 ms on the box); a lookup error counts as "not
  running".
- Godot dock: a 5 px dot under each running app (the HighAsCG button always has one).
  - Refreshed on every reveal and 2 s after a launch.
  - `operator_dock_model.gd running_set()` holds the logic.

**What was VERIFIED (box, 21.10).**
- Smoke: `smoke-wo628-operator-dock.test.js` 12/12, with new cases for running + profile-lock + lookup error.
  Godot tests 16462/0; offline suite 2949 pass.
- On the box:
  - The revealed dock showed the dot under HighAsCG only.
  - Dock → File browser: the server log shows `launched /usr/bin/thunar`, the API reports `running: ["file-manager"]`,
    and the dot appeared under File browser.
  - Closing Thunar (SIGTERM to the process the dock started) made the API answer `[]`, and the next reveal showed no
    dot. 0 script errors.
