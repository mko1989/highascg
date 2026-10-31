# WO-914 — Visuals: a Caspar restart leaves the Send output dark until Send is toggled

**Area:** godot-client, engine
**Status: IN PROGRESS (31.10.26 — fix + test in, suite 25539/0; live restart check pending)**

## Investigation

Found during the WO-580/875 on-air checks (31.10.26): after restoring `enable-gpu` and restarting
`casparcg-server.service`, ch2 (Dioda, the owner's on-air target — `visuals_on_air.json` = `{"channel":2,"layer":1}`)
had no layer 1 at all. The visuals ring itself never stopped (the Godot client keeps writing `shm://visuals`);
only Caspar's PLAY of the shm producer was gone with the old process.

- Node restores the looks/scene layers after a reconnect, but the visuals Send is client-owned
  (`features/visuals/visuals_tab.gd` Send → `POST /api/play` with `M.play_body(ch, layer, ring_name)`), so node
  has nothing to replay.
- The client only PLAYs on a Send toggle and on its own boot (`_resume_send`, WO-880). A Caspar restart under a
  running client (crash, an Apply, the WO-881 CEF fast relaunch) is neither: the output stays dark until the
  operator toggles Send.
- Restored by hand: `POST /api/play {"channel":2,"layer":1,"clip":"shm://visuals","loop":false}` → OSC shm 50/s.

## What was done

`godot/client/features/visuals/visuals_tab.gd`:
- The Store hook now also reads `caspar.connection` and calls `caspar_link(connected)`.
- `caspar_link(up)`: on a down→up edge while `sending` is set, waits `REPLAY_S` (3 s — after node's own restore of
  the looks, so the PLAY does not race it) and PLAYs the ring on the sending channel-layer again. No PLAY on the
  first connect (`_caspar_up` starts true; boot is `_resume_send`'s job), none when not sending, none on repeats
  of "up". `replay_api` lets the test stand in for `DevicesTarget.box_api`.

Why the client and not node: the ring and the Send state belong to the client (WO-880 keeps its marker there);
node replaying a shm PLAY it does not own would PLAY a dead ring after a client quit.

## Verified

- `tests/test_visuals_show.gd::test_caspar_reconnect_resends` — first connect / not sending / down→up / still up
  (one PLAY, exact body). Godot suite 25539 passed, 0 failed. `check-max-file-lines` 0.
- Live: pending (restart `casparcg-server.service` with the owner GUI sending to 2-1 → ch2 shm back at 50/s
  without touching Send).
