# WO-726 — A kiosk that followed the master to another box stayed there after the servers were unlinked

**Status: DONE (24.10.26 — Godot units + client boot check; live on .4: its kiosk, stuck on this box since WO-724, went
home by itself on restart)**

## Investigation
- After WO-724 / WO-725 (servers unlinked, both `peers: []`, epoch 0) .4's operator screen still drove **this** box:
  screenshot of .4's :0 showed project `godot_test` (this box's), `ss -tnp` on .4: godot → `192.168.0.23:4200`, .4's
  `ui.cfg [cluster] origin="http://192.168.0.23:4200"`. It followed this box while it was master during the WO-724
  failover drill (P3b, `app/cluster_follow.gd`), as designed.
- Nothing ever brings it back: `ui.cfg` origin is only rewritten by the next master change (`_on_snap` →
  `F.master_origin`, which returns "" without a master) or when the followed server is gone (`_on_probe_tick`). An
  unlink is neither: the followed server stays up and simply has no master. So after any unlink, a kiosk that ever
  followed another box keeps operating that box — the wrong show, on the wrong outputs.
- Found while restarting .4's kiosk (owner: "You can do whatever you want with .4"). First restart attempt killed the
  kiosk via `pgrep -f "godot --path …"`, which matched the ssh command's own shell as well (session died, kiosk down,
  relaunched a minute later); later restarts use `pgrep -x godot`.

## What was done
- `godot/client/core/cluster_follow_model.gd` `follow_over(snap, current, home, local_addrs)`: away from home and the
  followed server has no master (epoch 0), or none of its linked servers is home (`resolve_target(peer_origin) ==
  home`, so this machine's LAN address counts) → the follow is over.
- `godot/client/app/cluster_follow.gd`: on a `cluster:peers` snapshot from the followed server, `follow_over` → the
  same 5 s dialog as a master change ("Back to this server", "Stay here" = until the client restarts), then home only if
  home answers (`/api/cluster/master`); `_switch` saves origin "" and restarts as before. Follow off → untouched.

## What was VERIFIED
- Godot units 21487 passed / 0 failed (+6 `test_follow_over_when_unlinked_or_home_dropped`); `run-client.sh --check`
  boot OK. (The first deploy to .4 had a doubled quote in `_update_text`: the kiosk failed to load
  `cluster_follow.gd`; the units do not load app scripts — `run-client.sh --check` does, and is now run before
  deploying a client change.)
- **Live, .4:** client files copied, kiosk restarted with origin still `http://192.168.0.23:4200` → 5 s later `ui.cfg`
  origin `""`, the relaunched kiosk connected to `127.0.0.1:4200` only, screen shows .4's own `New project 1` and its
  test card (`192.168.0.4`).
