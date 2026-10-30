# WO-705 — Operator dock stays empty when the GUI starts before the server

**Area:** godot-client
**Status: DONE (23.10.26: smoke-wo705 2/2, boot check OK, box relaunch shows one full dock; the late-server path is
owner QA on the next ISO boot)**

Owner, `next.md` 23.10 (22.10 ISO booted on .64): *"no programs in the dock..."*

## Investigation

- **The dock** (`godot/client/app/operator_dock.gd`) is the Godot client's own dock window. Openbox has none.
  - It shows the HighAsCG button straight away.
  - Its apps come from `GET /api/system/dock`, served from the `.desktop` catalog (`src/utils/desktop-app-catalog.js`).
- **The catalog works on .64.** I queried .64 read-only, after the fact, with `curl http://192.168.0.64:4200/api/system/dock`.
  It returns the 5 pinned apps and the full `apps` list (Thunar, File Roller, Install System, Midnight Commander,
  Syncthing, …), the same as on this box.
- **`_load()` ran once, from `_ready()`.** On failure it posted a notice ("Dock: could not load the app list") and
  returned, and nothing asked again.
- **On .64 the GUI was up long before the server.**
  - WO-696 / WO-702 show `highascg.service` reached only at about 2m37s.
  - It was held behind `highascg-decklink-install`, which took +1m53s to compile DKMS (now cached, WO-704), and
    behind the Caspar gate.
  - So the dock's single request failed, and it kept only the HighAsCG button for the whole session: "no programs".

## What was done

- **`operator_dock.gd`:**
  - `_load()` also runs on every `Ws.connected`. The WS client reconnects with backoff until the server answers, so
    the dock fills as soon as the server is up.
  - `_loaded` / `_loading` guards make sure the list is filled only once:
    - On a normal start both calls happen (`_ready` and the first connect), and the second is dropped.
    - A request that comes back after another one already filled the dock is dropped too.
  - A failed request leaves `_loaded` false, so the next connect tries again.

## Verified

- `smoke-wo705` **2/2** (wiring and guard order; added to the CI list). `run-client.sh --check` boot OK.
- **Box, 14:2x:** the GUI was relaunched on the fix, and the dock was expanded with xdotool and captured with `xwd`.
  It shows exactly one set: HighAsCG | Firefox, File browser, DeckLink setup, DeckLink updater, NVIDIA settings | ⋯.
  The double `_load` (ready plus connect) added no duplicate buttons.
- **Not proven here:** that a GUI started while the server is down fills its dock once the server is up.
  - Freezing the server (SIGSTOP) to simulate that was refused by the session's permission classifier.
  - This box has no sudo `systemctl stop highascg` rule.
  - Owner QA: next live-ISO boot, or start the GUI before `highascg.service`. The dock should fill on its own when
    the server comes up.
