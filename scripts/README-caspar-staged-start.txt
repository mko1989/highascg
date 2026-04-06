Staged CasparCG startup (scanner + HighAsCG first, Caspar after "arm")
======================================================================

Goal
----
- Media scanner and HighAsCG start immediately so you can change settings or replace
  casparcg.config on disk before Caspar binds AMCP.
- CasparCG starts only after a "ready" file exists (or after you POST from the UI).

Files
-----
- scripts/casparcg-staged-start.sh   — wait for ready file, then Caspar restart loop
- scripts/start-highascg.sh          — exec node index.js under /opt/highascg (adjust HIGHASCG_HOME)

Ready file (default)
--------------------
  /opt/casparcg/data/caspar-armed

Match HighAsCG env CASPAR_ARM_FILE / CASPAR_READY_FILE if you use a custom path.

Config path (Caspar main XML — separate from media-scanner config)
------------------------------------------------------------------
  Default: /opt/casparcg/config/casparcg.config
  The staged script uses CONFIG_PATH (default $CASPAR_BASE/config/casparcg.config).
  Openbox autostart should pass the same path as install.sh (see script header).

Arm from SSH
------------
  sudo -u casparcg touch /opt/casparcg/data/caspar-armed

Arm from HighAsCG (same host)
-----------------------------
  curl -X POST http://127.0.0.1:8080/api/system/caspar-arm

Check status
------------
  curl -s http://127.0.0.1:8080/api/system/caspar-arm

Disarm (optional — next staged boot will wait again if you remove the file before reboot)
-----------------------------------------------------------------------------------------
  rm /opt/casparcg/data/caspar-armed
  curl -X DELETE http://127.0.0.1:8080/api/system/caspar-arm

Openbox autostart pattern
-------------------------
1. Keep your existing X11 / scanner block.
2. Start HighAsCG in the background with logging.
3. Replace the inline "while true; do caspar..." block with a background call to
   casparcg-staged-start.sh (chmod +x first).

Example (adjust paths):

  /opt/highascg/scripts/start-highascg.sh >> /tmp/highascg.log 2>&1 &
  /opt/highascg/scripts/casparcg-staged-start.sh >> /tmp/caspar-staged.log 2>&1 &

Copy scripts to /opt/highascg/scripts/ on the server, or symlink from the git checkout.

First boot
----------
Until you arm Caspar, the staged script waits. Upload config, then touch the ready file
or POST /api/system/caspar-arm.

After a successful run, the ready file can stay — the next graphical login will not wait
again unless you delete the file before boot.
