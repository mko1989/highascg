# WO-1118 — Dock: an app installed while the client runs was missing from ⋯ until the client restarted

**Area:** godot-client
**Status: DONE (17.11.26 — code + boot check; the ⋯ menu not opened on the glass)**

Owner 17.11: "i just installed localsend and it did not appear in the dock apps. each new one should appear there."

## Investigation

- `/var/log/dpkg.log`: localsend installed 18:47:21; the running client started 18:40:38.
- Server side is right: `GET /api/system/dock` lists `app:localsend_app` (desktop-app-catalog.js rescans every 15 s).
- `godot/client/app/operator_dock.gd` `_load()` fills the ⋯ menu once (`_loaded`, WO-705); `_refresh_running()` (each
  time the dock is revealed, and 2 s after a launch) fetched the same route but used only `running`.

## What was done

- `_refresh_running()` also takes `apps`: when the list differs from the one shown, the ⋯ menu is refilled.

## What was verified

- Unit suite 30098 passed, 0 failed; `--check` boot OK. Client relaunched (LocalSend is in the route's list).

## Not verified

- The ⋯ menu was not opened on the glass; a later install while the client runs was not tried.
