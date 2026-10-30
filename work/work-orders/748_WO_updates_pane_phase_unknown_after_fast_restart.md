# WO-748 — Updates pane says "Phase: ?" after an update that succeeded (follow-up of WO-737)

**Area:** os-iso, godot-client
**Status: DONE (25.10.26 — offline: Godot 21656 passed / 0 failed, +7 assertions on the exact responses .4 gave; boot check OK. Owner-QA: the next update from a kiosk ends with "Server is back." and the new version, not "Phase: ?".)**

Owner, 25.10: *"on .4 the standard update route fails. with Phase: ?"* … *"or maybe it succeded..."*

## Investigation

It succeeded. The pane misread it.

- .4 after the attempt: `GET /api/system/version` → `buildStamp 2026-10-24T225552Z` (the WO-746 release);
  `src/cluster/shared-show*.js` present; `GET /api/cluster` → `show.on: false`.
  `/var/log/highascg/update-20261025T075722Z.log` ends with `starting highascg.service` / `web UI update complete`.
- .4 journal, the timing:
  - `08:57:22` sudo `highascg-webui-server-update.sh --detach --source …/extract-2026-10-24T225552Z`
  - `08:57:23` `Stopped highascg.service`
  - `08:57:26` `Started highascg.service`
- The pane (`godot/client/features/settings/updates_pane.gd` `_poll_status`, every 1.5 s) only entered WO-737's
  restart wait when a poll **saw** the old server's job in phase `detached`. The old server set `detached`
  (`src/system/server-update.js:426`) and was stopped about a second later, so no poll saw it.
- The next poll that got an answer reached the **new** process, which has no job: `{"active": false}`
  (`getApplyStatus`, `server-update.js:451`). The pane showed it as a log (`updates_model.gd` `status_log` →
  `"Phase: %s" % st.get("phase", "?")`), then, since `ok` was not true, stopped polling and re-enabled Install.
  So the operator saw "Phase: ?" and an Install button, which reads as a failure.
- WO-737 left exactly this as owner-QA ("Waiting for the server to restart…" on the next real update). That QA failed;
  this WO is the fix.

## What was done

- `godot/client/features/settings/updates_model.gd`:
  - new `install_step(st)` for the polls after the install was accepted:
    - no answer → `restarting`;
    - a server with no job (no `phase`) → `back`. The job exists before the POST returns 202, so after an accepted
      POST "no job" can only be the new process;
    - `detached` → `restarting`; an active job → `running`; finished → `done` / `failed`.
  - `restart_step` also returns `running` when an old server answers with an active job, so one dropped poll
    mid-download no longer waits 180 s and reports "has not come back".
- `updates_pane.gd` `_poll_status`:
  - acts on `install_step` and never prints a job-less status as a log;
  - `back` adds "Server is back." and refreshes (version + check);
  - `running` in the wait shows the log again.
- Why the client, not the server: the server cannot report on a job across its own restart (the job is in memory).
  The client already knows the install was accepted, which is enough to read "no job" correctly. No server change
  means nothing new has to ship before the fix works, apart from the client.

## What was VERIFIED

- Godot `test_settings.gd`:
  - `test_updates_install_step`: 6 assertions, including `{"active": false}` → `back` (the response .4 gave) and
    "unreachable" → `restarting`;
  - `test_updates_restart_wait`: +1 assertion (a dropped poll mid-install → `running`).
  - Suite: 21656 passed / 0 failed; `run-client.sh --check` boot OK.
- Not reproduced live: that needs another real update on .4. The next release carries the fix; the update after
  that is the first one the fixed pane drives. **Owner-QA** then: it ends with "Server is back." and the new version.
