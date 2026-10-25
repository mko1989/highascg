# WO-751 — "Fresh project on the main machine (.23) didn't wipe the screen destinations": it went to .4, the failover master

**Status: OPEN (25.10.26) — diagnosed; owner decision needed: put the master back on .23, and whether a failover should hand the master back by itself.**

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
