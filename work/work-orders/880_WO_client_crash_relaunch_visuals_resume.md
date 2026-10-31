# WO-880 — Show safety: a crashed operator client relaunches, and the Visuals go back on air by themselves

**Area:** godot-client
**Status: DONE (31.10: loop with a fake Godot + a real crash's exit code, marker test in the Godot suite; the crash drill
on the box — SEGV mid-Send → relaunch → back on air on Caspar ch 6 in ~8 s)**

Loop task (owner 31.10): visuals "in a very good shape and ready for a show". Follows [WO-877](./877_WO_visuals_show_looks_crossfade_master.md).

## 1. Investigation

- The client has crashed on this box: `~/.highascg/log/godot-client.log:501` — `handle_crash: Program crashed with
  signal 11` (Godot 4.7.2, during a `propagate_notification`). A real Godot crash exits **134** (the crash handler
  ends in abort(); probed with `OS.crash()` headless).
- Nothing relaunches it. The session autostart (`scripts/setup/09-openbox-autostart.sh:149`) and the desktop menu
  (`:162`) run `godot/client/run-client.sh`, which `exec`s Godot once. No systemd user unit, no supervisor.
- What the audience sees: the Visuals reach Caspar through the shm ring (WO-743 writer → WO-742 producer). The producer
  holds the last frame when the writer stops and re-opens the ring when a writer comes back (new inode) — but a new
  client does not know it was on air (`visuals_tab.gd` `sending` is in memory only), so the wall stays frozen until the
  operator finds the Visuals tab and presses Send again.

## 2. What was done

- `godot/client/run-client.sh`: instead of a single `exec`, a loop that relaunches Godot after a crash signal only —
  132/134/135/136/139 (ILL/ABRT/BUS/FPE/SEGV). A quit (0), an error exit, or a kill (TERM 143 / INT / KILL — a
  restart by hand, or by a session) ends it, so a deliberate kill + relaunch never gives two clients. More than 5
  crashes in 5 min → it stops (a crash loop would only burn the GPU). Each relaunch is logged to stderr (the session's
  `~/.highascg/log/godot-client.log`). `HIGHASCG_CLIENT_NO_RELAUNCH=1` = the old single run; `--test` / `--check` are
  unchanged.
- `features/visuals/visuals_tab.gd`: a successful Send writes `user://visuals_on_air.json` (`{channel, layer}`), Send
  off removes it. A client that starts with the marker (not under the test runner) retries every 2 s for ~2 min until
  the box answers and the project is loaded, then runs the normal `send(true)` (PLAY + publisher) — Caspar held the
  last frame meanwhile. Only Send off ends "on air"; a deliberate quit while on air also resumes on the next start,
  which matches what the wall still shows.

Not covered: a client that hangs without crashing (the loop cannot see it), and a crash of Caspar itself.

## 3. What was verified

- Relaunch loop with a fake `GODOT` (`kill -SEGV` / `-ABRT` / `-TERM` on itself): two crashes then a quit → 3 runs,
  exit 0; TERM → 1 run, exit 143, no relaunch; endless ABRT → 6 runs then "6 times in 5 min — not relaunching", exit
  134. A real `OS.crash()` exits 134 (in the set).
- `run-client.sh --check` → boot OK. Godot suite 24073 passed / 0 failed, incl. `test_on_air_marker` (written, removed,
  no marker → no resume).
- The real client on Xvfb :377 with a marker in a scratch `XDG_DATA_HOME`: boots with no script errors, keeps waiting
  (no server), marker kept.
- The drill on the box, 31.10, Caspar ch 6 checked by two PRINTs a second apart (live = the frames differ):
  a client on Xvfb sending → live; marker `{"channel":6,"layer":1}`; TERM → marker kept, ch 6 frozen (the producer
  holds the last frame); a client started by run-client.sh → `[visuals] on air before this client started — sending
  again` → live; `kill -SEGV` it → frozen → `[run-client] crashed (exit 134) — relaunching in 2 s` → live again ~8 s
  after the crash; TERM → the loop ends (no relaunch). Ch 6 layer 1 stopped after.
- The owner's client running now (PID 326620) was not started by run-client.sh, so the loop applies from its next start.
