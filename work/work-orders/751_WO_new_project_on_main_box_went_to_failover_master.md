# WO-751 — "Fresh project on the main machine (.23) didn't wipe the screen destinations": it went to .4, the failover master

**Status: IN PROGRESS (25.10.26 evening) — owner decided: an on-box client never follows the master (stays on its own server), unlink ends it, the header says when the client is on another server. Built + verified (Godot 21673/0, box relaunch). Open: decision 2 (preferred master after failover) is moot for on-box clients; server-side stale channels (below) not fixed.**

Owner, 25.10: *"i did a fresh project on the main machine (.23) and it didnt wipe the screen destinations..."*

## Investigation

- The server's New project does reset the destinations: `src/engine/new-project.js` `createNewProject` applies
  the factory starter (Operator GUI only, WO-264), keeping only the box's GPU map, operator output and monitor cable.
- After the owner's New project:
  - **.23** (this box): `GET /api/project` → `godot_test`, saved 24.10 21:01, destinations Operator GUI + PGM/PRV 1
    + PGM/PRV 2. Nothing new here.
  - **.4**: `GET /api/project` → `testy_2`, saved 25.10 09:11 local, destinations **Operator GUI only**: the fresh
    project, then saved as testy_2.
  - So the New project ran on .4.
- Why: .23's kiosk has **"This client follows the master"** ticked, and the master is .4 (Devices → Servers:
  "Master: highascg5867 · epoch 4 · auto failover"). A following client sends the show (New / Save / Load /
  takes) to the master. Only its Devices tab works on its own machine (WO-670 P3b, WO-732 P3a). The header only
  shows the project name ("testy_2"); nothing says it belongs to the other server.
- Why .4 is the master:
  - .23 journal: 24.10 18:27 `master this server epoch 1 (operator)`, then 19:07 .4 epoch 2,
    19:17 .23 epoch 3 (failover).
  - Then 20:12:05 `stepped down: highascg5867 is master (epoch 4)`. .4 journal 20:12:04:
    `master this server epoch 4 (failover: highascg7580 unseen 13 s)`. .23's server was down for a restart in the
    WO-737 update incident (new PID at 20:09:43).
  - Auto failover (12 s) never hands the role back, so .4 has stayed master since.
- Consequences on the "main machine" since 24.10 20:12:
  - its kiosk's show is .4's;
  - "PGM here is driven by the master: local PGM takes are skipped (PRV still works)" applies to .23.
- Related: any restart of .23's server longer than 12 s (updates, deploys) moves the master to .4 again while auto
  failover is on.

## Owner decisions

1. Put the master back on .23: Devices → Servers → **Make this server master** on .23 (or I do it on your word).
   It moves PGM takes back to .23; .4 follows.
2. After a failover, should the master go back by itself to a preferred server when it returns (a "home master"),
   or stay where it moved (today)? *Recommended: a preferred master, with the hand-back only once the returning
   server has been up and linked for a while, so a flapping box does not bounce the role.*
3. Should the header say when the show belongs to another server (e.g. "testy_2 · on highascg5867")?
   *Recommended: yes, one muted word; that is the cue that was missing here.*

## What was done

Nothing yet: diagnosis only (the master is an on-air role).

## What was VERIFIED

The evidence above: both servers' `GET /api/project`, both journals' claim lines, the Devices → Servers screenshot
(09:20, "This client follows the master" ticked, master highascg5867 epoch 4).


## Recurrence 25.10 evening (after the 26.04.1 upgrade + reboot)

Owner: *"created a fresh project, added a destination, Apply + restart Caspar doesn't restart it … the live preview is not
picking up that destination"*, then *"i unlinked this machine from .4"*, *"i cant switch to this machine, there is no
option for that, nor there should be. the client should be connected to the server on that machine. unlinking should
unlink. there is nothing indicating that the client … is in fact connected to .4"*.

### Investigation

- Apply DID restart Caspar. Journal: 17:59:58 and 18:42:47 `[Full apply] Step 4 — reload Caspar` → `AMCP back after
  config reload`. Caspar's log shows the loaded config going 7 channels (17:49) → 3 (18:00, 18:42), PGM/PRV 1 on
  ch 1–2. Empty `<consumers>` is valid (owner: a destination without consumers must work).
- Client log: 17:54:14 `[cluster] following the master: http://127.0.0.1:4200 → http://192.168.0.4:4200`. Server
  journal 17:54:09 `master highascg5867 epoch 10 (operator)`, then 17:55:47 `no linked servers left: master claim
  dropped` (the unlink). Afterwards both servers report standalone, peers [], epoch 0.
- The client stayed on .4. The WO-726 "follow is over" dialog never ran in that session; the client logged nothing
  after `ws connected`. ui.cfg `[cluster] origin="http://192.168.0.4:4200"`, and core/config.gd:20 put that origin ahead
  of the on-box default on every launch.
- Devices tab on a following client edits the home box (WO-732 P3a, core/devices_target_model.gd:9), so the destination
  and the restart went to this box. The Live tab showed .4's project (`mhp doz`, only Operator GUI), which has no PGM/PRV.
  Nothing on screen said the client was on .4.
- After the reboot this box came back as 192.168.0.10 (eno1) / .27 (wifi). ui.cfg still lists it as .23.
- Side finding, not fixed: node's `state.channels` still holds ch 4–7 from the previous 7-channel config after the
  restart (Caspar has 3; `configComparison` is right).

### What was done

- `core/cluster_follow_model.gd` `on_box(home)`: home is a loopback origin (`Platform.is_local_origin`).
- `core/config.gd`: an on-box client ignores a followed origin in ui.cfg.
- `app/cluster_follow.gd`: on-box → clears a stale `[cluster] origin` and does nothing else (no snapshot follow, no
  probing, no countdown). Following stays for clients with no server of their own (home = a remote host).
- `features/devices/cluster_panel.gd`: "This client follows the master" is hidden on an on-box client.
- `app/header_project.gd`: amber `on <host>` after the project name whenever the client's server is not loopback.
- Why not fix the WO-726 dialog path instead: the owner rule removes the on-box follow entirely, so that path cannot
  leave a box on another server any more; a remote client keeps WO-726 and now also shows the header cue.

### What was VERIFIED

- Godot `tests/run_tests.gd` 21673 passed / 0 failed (new `test_on_box_never_follows`; first run caught `[::1]`
  through `host_of`, fixed by using `Platform.is_local_origin`); `run-client.sh --check` boot OK;
  smoke-wo739 + smoke-wo723 (read these files) 22/0.
- Box: client relaunched → `[client] server http://127.0.0.1:4200`, ui.cfg `origin=""`, Live tab shows
  "PGM 1 / PGM/PRV 1" (screenshot 18:57). Probe 2nd client `--server=http://192.168.0.99:4200` → header
  "on 192.168.0.99" (screenshot 18:58), then closed.
- Owner QA: link to .4 again, make .4 master: this box's client stays home, Devices → Servers has no follow tick.
