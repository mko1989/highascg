# WO-978 — Tracking → lighting desk test environment: puppet marker, PSN to ChamSys MagicQ

**Area:** tracking-vr, lighting, godot-client
**Status: DONE (06.11.2026; on the box: puppet → hub → follow → PSN at 51–56 Hz seen by the sniffer and by MagicQ PC (unlocked by the GeNetix GN10) View Trackers, `up` / `down` round trip leaves nothing behind, Godot row + magenta 3D pin screenshotted; offline 5410/0, Godot 26079/0)**

Owner, 06.11: *"i want you to create a test enviroment where we will be able to see tracking position being sent to
lighting desk (magicq for now). so i need a puppet marker, and psn to chamsys."*

## Investigation

**What was already there.**
- The server has a marker hub (`src/tracking/marker-hub.js`). Markers are in metres: X stage left, Y upstage,
  Z up. Speed comes from successive writes, and a marker goes stale after 1 s.
- The PSN sender exists since WO-631 (`src/fixtures/psn.js`):
  - group 236.10.10.10:56565, DATA at 60 Hz, INFO at 1 Hz;
  - TTL 1 with multicast loopback on (psn.js:176-177);
  - `iface` sets the outgoing interface.
- The follow service drives it from `project.fixtures.output`, sending only when the output is enabled, the
  protocol is psn, and this server holds the lighting duty (follow-service.js:169).
- What was missing:
  - a source that moves a marker with nobody on stage;
  - a way to see what the desk receives;
  - a MagicQ configured to receive.
- The open project ("a&s") had no `fixtures` key and no tracking camera. So the existing 2D marker overlay
  (Camera mode, `tracking_view`) had nothing to draw on, and the 3D previs drew no hub markers at all.

**MagicQ PC refuses PSN in demo mode.** Checked on 1.9.8.3 in `/opt/magicq`, on Xvfb :99:
- **Setup → Network → Tracker Rx** and **PSN Function** show `[Locked]`.
- `/proc/net/igmp` shows no 236.10.10.10 join (`0A0A0AEC`).
- Screenshots: `trk2c.png` and `net2.png`.
- The ChamSys manual: PSN, OTP and MQ Track on PC need an unlock. GN5 or GN10 unlocks fully; GN2 or GN4IP unlocks
  only Core.

**The GeNetix unlocks it over the network.** Mid-WO, the owner connected a ChamSys GeNetix to eno2. eno2 is
10.0.0.13/8, and the node is at 10.0.0.121.
- MagicQ's own IP was 2.9.200.168 (status bar "Inv Net Art Cflct"). Setting it to **10.0.0.13**
  (**Setup → View Settings → Network → IP address**) unlocks MagicQ.
- The title changes to "MagicQ PC". **Net Manager** lists `TAMOOS 2, Detected, GN10, Custom, sACN 22, 10.0.0.121,
  255.0.0.0, FC:0F:E7:15:1A:C0, V3.20 (20431)` (`unlocked_netmanager_gn10.png`).
- Tracker Rx and PSN Function become editable (`unlocked_tracker_rows.png`).
- MagicQ then joins 236.10.10.10 **on eno2 only**.
- The GeNetix's own settings (IP, sACN mode) were not touched.

**Why the PSN interface must be that same NIC.** A multicast datagram reaches a local socket only through the
interface it was sent out of (the loopback copy is per interface).
- With `psn.iface` left empty (the OS default route, eno1), MagicQ on eno2 hears nothing.
- With `psn.iface = 10.0.0.13`, it receives.
- So the env reads the interface of MagicQ's own group join from `/proc/net/igmp` (tracking-desk.sh:35).

**Axes, measured with a static PSN sender.** The sender was standalone (scratchpad `hold.js`), holding (3, 1, 1.7):
- MagicQ shows the wire as (X, Y, −Z).
- "stage" axes put height into MagicQ's Z, which is wrong.
- "y_up" (psn.js:54-55, wire = X, height, −upstage) puts height in Y, but depth is mirrored.
- The fix is tracker **Z scale −1**. It shows X 3.00, Y 1.70, Z −1.00 (`magicq_hold_yup_zscale-1.png`).
- MagicQ's Z scale is a **plain multiplier**: −256 gave Z = −256 (`hold_yup_zscale.png`). The old help text
  "−256 = ×−1" was wrong for 1.9.8.3.
- MagicQ shows X/Y/Z rot as a constant 3.20, because HighAsCG sends no orientation chunk.
- In MagicVis Top view the green tracker cross moves (`magicvis_green_cross_moving.png`).

**Side effects found:**
- MagicQ binds 0.0.0.0:6454 while it runs.
- The PSN Test show's DMX I/O is "Vis only" on every universe, so it sends no network DMX
  (`env_dmxio_vis_only.png`). HighAsCG's own Art-Net to the GeNetix is unaffected.
- MagicQ rewrites `status.dat`, `laststatus.dat` and `lastshow.shw`, and on quit or show change it autosaves the
  current show's `.sbk` (and `.xhw`).

## What was done

**`src/tracking/puppet.js` (new): the test puppet.** A server-side source that writes hub marker 1 with source
"puppet" and name "Puppet".
- Paths (one arc-length polyline table per pattern and size):
  - `circle` (radius `size`, anticlockwise from stage left);
  - `figure8`;
  - `line` (ping-pong from stage right to stage left);
  - `walk` (a 2·size square from downstage right);
  - `hold`.
- It walks at a constant `speed` in m/s along the path, at 30–60 Hz (default 50).
- The hub derives the real speed, so the PSN speed is right.
- Safety:
  - it is off at every server start (in memory only);
  - it switches itself off after `ttl_min` (default 120) at puppet.js:135;
  - it refuses (409) a marker id another source keeps live (puppet.js:144);
  - stopping removes its marker.
- HTTP: `GET /api/tracking/puppet` returns status. `POST` takes partial config plus `enabled`. The body is the
  raw string run through `parseBodyStrict`; anything else gets 400 or 405.

**`src/tracking/register.js`:**
- creates the puppet at :81 and counts its writes in `/api/tracking/stats`;
- routes it after `handleAuto` (:332), inside the module's own `/api/tracking/*` handler, so no router-order risk;
- stops it in `onShutdown` (:485).
- To stay at or under 500 lines, the stale header ("No PSN / OSC output: dropped by the owner") was rewritten
  and three `let` declarations were merged. The file is now 499 lines.

**`tools/test-env/psn-sniff.js` (new):**
- joins the PSN group on every IPv4 interface (or `--iface`) and decodes with `psn.decode`;
- prints, once a second per tracker: id, name, pos, speed (and its magnitude), status, rate in Hz and the
  sender's address;
- `--secs N` exits 0 when a tracker arrived and 1 when none did; `--json` is also available.

**`tools/test-env/tracking-desk.sh` (new), `up | status [--sniff] | down`** with `--display :99|:0`, `--pattern`
and `--iface`.
- `up`:
  - backs up MagicQ's console files (`*.dat`, `*.sbk`, `*.xhw`, `lastshow.shw`) into
    `~/.highascg/run/tracking-desk/`;
  - installs the PSN Test console state from `~/.highascg/test-env/magicq-psn-test/` and starts an Xvfb :99 if
    needed;
  - starts MagicQ and clicks **Continue last show** in the SELECT window (on :99 only; on :0 it asks you to);
  - waits for MagicQ's PSN group join and uses that NIC as `psn.iface`;
  - switches the project's PSN output on and starts the puppet.
- `down`:
  - turns the puppet off and restores the project output;
  - TERMs only the MagicQ it started;
  - copies back the console files that changed and lists any new file in the show folder;
  - TERMs only the Xvfb it started (never nxnode).
- The PSN Test console state holds:
  - IP 10.0.0.13;
  - Tracker Rx PSN/SpotMe;
  - PSN Function Normal PSN 1;
  - tracker 1 "Puppet", Z scale −1;
  - last show "PSN Test".
- "PSN Test.shw" is a copy of "MHP Patch Final.shw". The owner's show was never saved over. A full backup of
  `~/Documents/MagicQ` taken before any change is in the scratchpad (`magicq-docs-before-wo978.tgz`).

**`tools/test-env/tracking-desk-project.js` (new): the project half.** It follows memory
project-data-fix-via-autosave:
- it reads the stored project file (not `GET /api/project/file`, which masks stream keys);
- it changes only `fixtures.output` to `{enabled: true, protocol: 'psn', psn: {…kept, iface, axes: 'y_up'}}`;
- it POSTs `/api/project/autosave` with the stored rev.
- The first `on` records the previous output, or its absence, in a state file. `off` restores exactly that and
  touches only `output`, so a patch edited meanwhile survives.
- A project that had no `fixtures` ends with `fixtures: {}`, never null, because Godot reads `project.fixtures`
  as a Dictionary (move_targets.gd:126 would break on null).
- `off` refuses when another project is open.

**Godot:**
- `features/previs/tracking/puppet_row.gd` (new) is the **Test puppet** row at the bottom of **Previs → Camera →
  Markers** (one line in markers_section.gd). It has:
  - an on/off switch;
  - Path, Speed and Size controls;
  - a "?" button that opens the new help page;
  - a status line ("ON — marker 1 "Puppet" at x, y m · it switches itself off in N min"), refreshed at 1 Hz while
    visible.
- `puppet_model.gd` (new) holds the summary line and request body.
- `marker_pins_3d.gd` (new) draws the server hub's markers on the 3D stage: a pole to the marker height, a ball and a
  name tag.
  - The puppet is magenta and tagged "· test puppet"; other markers are cyan, and stale ones are dimmed.
  - This is the "visible in the previs" part, and it needs no tracking camera.
  - It is added in previs_tab.gd, where three `stage.add_child` lines became one loop, so the file stays at 499.
  - The pinned `calib_marks_3d` line is unchanged.

**Help:**
- `godot/client/help/tracking-desk-test.md` (new) covers the puppet, the one-command env, the GeNetix unlock, the
  console state, axes and troubleshooting.
- `psn-output.md` corrections:
  - the GeNetix network unlock;
  - Z scale **−1**, not −256;
  - local MagicQ needs the same NIC as the PSN Interface.

## What was VERIFIED

**Gates:**
- `node tools/ci/check-max-file-lines.js`: 0 files over 500.
- `node tools/ci/run-offline-tests.js`: 5415 tests, **5410 pass, 0 fail**, 5 skipped. This includes the new
  `tools/smoke/smoke-wo978-puppet-psn.test.js`, 8/8, added to `offline-test-files-3.js`. It covers:
  - the paths' geometry and speed;
  - the hub-derived speed of 1.5 m/s;
  - TTL auto-off;
  - the refusal of a live id;
  - the HTTP route with a `JSON.stringify` body, plus 400 and 405;
  - the register.js wiring, with nothing switching the puppet on at boot;
  - sniffer decode and rate on real encoded packets;
  - the project helper's output edit.
- `GODOT=… run-client.sh --test`: **26079 passed, 0 failed**. New `tests/test_puppet_wo978.gd` covers the summary
  and body, pin look, and pins following the hub list. `test_help_pages` TOPICS gained `tracking-desk-test`, so
  the page loads and its links resolve.
- eslint is clean on the touched JS, `format:check` passes, and `shellcheck -S warning` is clean.

**On the box (node restarted under box2.lock):**
- `GET /api/tracking/puppet` answered `enabled:false`.
- POST `{enabled:true}` led to `/api/tracking/markers` showing marker 1 "Puppet", source puppet, |v| = 1.00 m/s.
  `{enabled:false}` gave an empty hub, and a bad body gave 400.
- `tracking-desk.sh up` printed:
  - "MagicQ joined 236.10.10.10 on 10.0.0.13";
  - project a_s PSN output ON (iface 10.0.0.13, axes y_up);
  - puppet ON.
- `status --sniff` showed the tracker arriving and moving at 51–56 Hz:

  ```
  #1 Puppet pos -0.98 1.70 -3.74 speed -0.88 0.00 0.49 |1.00| m/s status 1 51 Hz from 10.0.0.13
  #1 Puppet pos -1.70 1.70 -3.06 ... 56 Hz
  #1 Puppet pos -2.00 1.70 -2.12 ... 53 Hz
  ```
- MagicQ (unlocked, show "PSN Test.sbk"), **Window → Macro → View Autom → View Trackers**: tracker 1 "Puppet" moved
  from X −0.24 / Y 1.70 / Z −3.99 to X −1.94 / Y 1.70 / Z −2.51 in 2 s. Last rx 0.03 s, Z scale −1.0
  (`env_trackers_1.png`, `env_trackers_2.png`).
- The main window title reads "MagicQ PC" (`env_up_root.png`), and DMX I/O is Vis only (`env_dmxio_vis_only.png`).
- `tracking-desk.sh down` output:
  - puppet off;
  - "fixtures.output restored (none)";
  - MagicQ quit;
  - 4 console files restored;
  - Xvfb :99 stopped.
- Checked after `down`:
  - no `mqqt`, no Xvfb, no `/tmp/.X99-lock`, and the extra nxnode went away by itself;
  - follow reports PSN off;
  - the project differs from the pre-`up` copy only in `rev` and `fixtures: {}` (it had none);
  - `status.dat`, `laststatus.dat`, `lastshow.shw`, `mhp.sbk` and `mhp.xhw` are byte-identical to the pre-WO
    backup.

**Godot GUI** (relaunched under the lock, `--tab=Live`; no SCRIPT ERROR since the relaunch):
- Previs 3D shows the magenta "Puppet · test puppet" pin moving (`previs_3d_puppet_pin_1.png` /
  `_2.png`; the pin's centroid moved x 902 → 697).
- The Markers row is ON with Circle, 1.0 m/s, 3.0 m and the status line (`gui_markers_puppet_row.png`).
- Clicking the switch turned the server puppet off and emptied the hub; clicking it again turned it back on
  (`gui_puppet_row_off.png`).
- "?" opens the help page (`gui_help_page_tracking_desk_test.png`).
- Afterwards the GUI was left on the Live tab and the puppet off.

Screenshots are in `/tmp/claude-1000/-home-casparcg/2c8389df-06bf-48f2-a6e2-f30036bbf7b0/scratchpad/wo978/`.

**Not proven:**
- MagicVis following the puppet through the **node** path. The green cross moving was proven with the standalone
  sender, using the same encoder and the same NIC.
- A Tracker palette making a head follow the puppet: none was recorded.
- The X direction in MagicVis (stage left vs right).
- `up --display :0`: not run on :0, per the brief.
- With the puppet on and the Follow output also on, a real patched rig would follow it. That is intended, and it
  is why the env is opt-in, the puppet is labelled, and it switches itself off after two hours.

**Owner, to watch it on :0** (from `~/highascg`):
1. `tools/test-env/tracking-desk.sh up --display :0`, then click **Continue last show** in MagicQ.
2. In MagicQ: **Window → Macro → View Autom → View Trackers**, or Visualiser for MagicVis.
3. Optionally, `node tools/test-env/psn-sniff.js` in a terminal.
4. When done: `tools/test-env/tracking-desk.sh down`.
