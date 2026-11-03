# WO-941 — DeckLink driver install reports "no response from the server" although the install succeeded

**Area:** video-io, godot-client
**Status: DONE (03.11.26 — offline: new smoke 3/3, 3/3 fail on the old handler; WO-428 smoke repointed 5/5; curated suite and Godot suite green. Live on this box: install POST answers through the async runner (0.1 s skip), concurrent requests answered in 6–10 ms. A real dpkg + DKMS install on a second machine is the remaining proof)**

Owner, 03.11.26: "i just did a decklink driver install on a second machine and after the install it shows error: no
response from the server. even though the install went fine and after refreshing the decklink card shows up and
decklink video setup can be started."

## Investigation

- `src/api/system-hardware-decklink-install.js` ran `sudo -n decklink-install-from-exfat.sh` with **`spawnSync`**
  (5 min cap). A real install is dpkg plus a DKMS kernel-module build, which takes tens of seconds to minutes. For
  that whole time Node's event loop was frozen: every HTTP request, WebSocket, timeline tick and OSC handler stalled.
- Godot client: `decklink_pane.gd` → `NuclearGate.post` → `Api.post_json` with the default
  `TIMEOUT_S = 15.0` (`core/api_timeouts.gd`). After 15 s the client reports `RESULT_TIMEOUT` → "server did not
  answer in time" (`net_util.gd:22`), the owner's "no response from the server". The script kept running and
  finished. That's why a refresh shows the card and Desktop Video Setup works.
- Web client (`settings-modal-mount-hardware.js`): fetch has no timeout, so it waited. The frozen server still
  stalled everything else it shows.
- I couldn't read .35's logs: its SSH host key changed after the Calamares reinstall (WO-939), and I did not
  override strict checking. The diagnosis rests on the code path, and this box's install log has only skips, so no
  local timing.
- Found while verifying: an "already installed" skip on a box that has a GUI-uploaded package staged added the
  WO-428 hint "the installed system scripts predate it — run install-exfat-systemd-units.sh". That's wrong: the
  scripts saw the package and decided it was already installed.

## What was done

- `system-hardware-decklink-install.js`: `runInstallScript()` is an async `spawn` with the same result shape
  (`status/stdout/stderr/error`), both pipes collected (the WO-428 stderr fix kept), and a 300 s timer that sends
  SIGTERM. The stale-scripts hint is skipped when the reason is "already installed".
- `godot/client/core/api_timeouts.gd`: `INSTALL_TIMEOUT_S := 330.0`, longer than the server's 300 s cap.
  `app/nuclear_gate.gd` `post(..., timeout_s := 0.0)` passes it to both the first try and the password retry.
  `decklink_pane.gd` sends the install with it.
- Both clients say "Installing… building the driver can take a few minutes."
- Why not a background job with polling: it adds a status endpoint and client polling for a single, rare, confirmed
  operator action. A held request plus a non-blocking server gives the same result with no new state.
- `tools/smoke/smoke-wo428-decklink-detect-gated.test.js` pinned `spawnSync('sudo'`. It now pins
  `runInstallScript('sudo'`, the `['ignore', 'pipe', 'pipe']` stdio and the stderr collector, which is the same
  guarantee ("both streams are read").

## What was VERIFIED

- `tools/smoke/smoke-wo941-decklink-install-async.test.js` (curated): with a fake child that exits after 150 ms, a
  10 ms interval keeps firing during the install. A failing script returns 409 with its output. Source pins cover
  the Godot timeout wiring and the hint guard. Against the old handler: 0/3 pass.
- `godot/client/tests/test_wo941_install_timeout.gd`: Godot suite 25764 passed / 0 failed; `run-client.sh
  --check` boot OK.
- Live on this box after a restart: `POST /api/system/decklink/install` → `{"ok":true,"action":"skipped","reason":
  "already installed (>= 16.4a1)"}` in 0.1 s, without the wrong hint. Concurrent `GET /api/timelines` answered in
  6–10 ms. Web client rebuilt (`npm run build:client`).
- Not proven here: a real multi-minute install. The next driver install on a second machine (after it updates)
  should show `installed: …` instead of the timeout.
