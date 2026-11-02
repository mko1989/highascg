# WO-934 — The session autostart showed the operator GUI a minute before the start-up prompt; a headless boot started the client too

**Area:** os-iso, godot-client
**Status: DONE (02.11.26 — fake-node shell cases 6/6, Godot check + 25760/0, on .10 a simulated boot showed only the prompt, the GUI started after "Start operator here", Run headless started no client)**

Owner, 02.11.26 (latest ISO on the second machine, now 192.168.0.10): "the godot client started again before the node
so the popup with start operator here, appeared a minute after the client. the client should wait for the node, and
for the choice. if headless it doesnt neeed to run at all."

## Investigation

- Boot timeline on .10 (`ps -o lstart`):
  - `run-client.sh --autostart`: 18:52:31; Godot 18:52:40;
  - node (`index.js`): 18:53:53, after the stick and bridge services (WO-928's bridge wait);
  - Caspar (`run.sh`): 18:55:19, after the start-up answer (WO-638 gate).
- `~/.config/openbox/autostart` (written by `scripts/setup/09-openbox-autostart.sh`) starts the client 8 s into the
  session, without waiting for anything (WO-645: "reconnects to the node API on its own").
- The client builds the whole GUI and places it, and only then asks (`main.gd` `_apply_window_args` →
  `_screen_question` → `boot_question.gd`). `boot_question.gd:23-30` polls `/api/system/operator-screen` every 2 s
  until the node answers, then minimizes the main window and opens the launcher prompts. So the GUI sat on screen for
  the ~70 s the node needed.
- On a headless boot the client still started and quit itself (`operator_screen_model.gd` `autostart_quits`).
- Godot cannot start with a hidden or minimized main window: 4.7 has no such command-line option (`--help`: only
  maximized / windowed / position / resolution). The prompts are native windows of their own
  (`operator_screen_picker.gd:59-60`, `gui_embed_subwindows = false`). So a client that runs only the prompts is
  possible.

## What was done

- **`godot/client/run-client.sh`**, `--autostart` only. A client started by hand or with `--server` is unchanged.
  1. Waits for `GET /api/system/operator-screen` to answer: up to `HIGHASCG_AUTOSTART_WAIT_S` (600 s), then it starts
     the GUI anyway, which shows its own "waiting for the server".
  2. A start-up question is pending (`boot.pending`): runs `godot … --resolution 64x64 -- --boot-launcher` and waits
     for it to exit.
  3. Reads the boot state again. If headless (`boot.headless`, from startup.mode headless or a "Run headless" answer),
     it exits without starting a client. Otherwise it starts the GUI as before (crash relaunch loop of WO-880).
  - Each step logs a `[run-client]` line in `~/.highascg/log/godot-client.log`.
  - JSON is parsed with `node` (always present on a box), and curl failures count as "no answer".
- **`godot/client/app/boot_launcher.gd`** (new), started by `main.gd` `_ready` on `--boot-launcher` before any GUI is
  built:
  - it minimizes its 64×64 main window;
  - it opens the same `operator_screen_picker.gd` `open_boot` prompts as before;
  - it quits on the answer, or when nothing is pending or the prompts cannot open.
  - No WebSocket, project or settings load, so it writes no live state.
- `boot_question.gd` is unchanged. It is still the path for a client started by hand, and the backstop when the
  launcher could not answer (the GUI then asks itself).
- The openbox autostart line is unchanged (it already calls `run-client.sh --autostart`), so installed boxes get the
  change from the repo and the next ISO.

## What was VERIFIED

- Shell, against a fake node and a stub Godot (scratchpad `wo934/fake-node.js`, `godot-stub.sh`). Each case gives the
  right Godot calls and exit code:
  - pending → gui: launcher, then GUI;
  - pending → headless: launcher only;
  - headless at once: nothing;
  - already answered: GUI;
  - node up only after 3 s: waits, then GUI;
  - node never up (wait 4 s): GUI anyway.
- `run-client.sh --check`: boot OK. `--test`: **25760 passed, 0 failed**.
- **On .10** (live ISO; the three files copied in by hand), simulating a boot: node stopped,
  `bootScreenAssignment` removed from `.highascg-state.json`, node started, then the session's autostart line run:
  - `waiting for the node` → `start-up: pending` 2 s later, and only the `--boot-launcher` process ran;
  - x11grab of the screen showed the "Start operator here / Run headless" prompt alone, with no GUI behind it;
  - answer "HDMI-0" → `[launcher] answered: HDMI-0` → `start-up answered: gui` → the GUI started on HDMI-0
    (screenshot);
  - another simulated boot answered `headless` → `this boot runs headless — the operator GUI is not started`, and no
    Godot process was left;
  - left in operator mode with the GUI running.
- The hand-copied files on .10 are lost at its next boot. The next ISO carries them.
