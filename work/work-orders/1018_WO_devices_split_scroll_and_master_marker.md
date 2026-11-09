# WO-1018 — Devices tab: the destinations and the rear panels scroll apart, and the master server is unmistakable
**Area:** godot-client, network
**Status: IN PROGRESS (09.11 — Godot suites green; waiting for the lead's live look after the GUI relaunch)**

Owner, 09.11 (verbatim):
> i linked two servers now, made this one the master (i think, because the placement of the button doesnt strike confidence which server is actually the master) … also when i have the server on i cant scroll the part with servers rear views which makes the connected server quite small. the left part with screeen dests and host channels should be scrollable seperatly from the devices rear panels.

## Investigation

- **Layout** (`devices_tab.gd` `_ready`): the body is an HBox of three columns.
  - Left (destinations + host channels) and mid (mapping nodes) were already `ScrollContainer`s.
  - The right column was a plain `VBoxContainer` (rear panel, cables list, lighting consoles, `ClusterPanel`), not scrollable.
- **Why the linked server is small:** `cluster_panel.gd` made its card list `SIZE_EXPAND_FILL` inside its own
  `ScrollContainer`. The right column has a fixed height (the tab), so after this server's rear panel, cables list and
  lighting consoles took their natural height, the Servers section kept only the remainder. A linked server's rear
  panel then lived in a ~220 px inner scroll (screenshot of :0: DP 0/1 ... DeckLink 4/2/3/1 cut at "REF"). The wheel over
  it was also eaten: a `PanelContainer` (mouse filter STOP) under the pointer does not hand the wheel to a parent scroll.
- **Cables.** `cable_layer.gd` reads every anchor's global position each frame (`_process`: `inv * a.anchor()`), so
  cables already follow any scroll. Two things did not hold once areas scroll:
  - a port scrolled out of its area kept drawing its cable (over the toolbar / neighbour column);
  - `anchor_at` (the click and unplug-drop hit test) and the tab's `label_at` / `begin_drag` / "click on the rear panel
    opens the server page" tests used the control's global rect, so a socket scrolled out of view would still take a
    click placed on whatever is drawn there.
  - Cable endpoints are global rects throughout (no per-column coordinates), so a scroll area anywhere is safe once
    clipped ports are excluded.
- **Master marker.** The master row of the Servers section held a shared button "Make this server master" (shown only
  when this server is not master) in a row of tick boxes; a peer's card had a "MASTER" text tag and "Make master". Nothing
  on this server's own rear panel said master or follower, and the button's position did not tie it to a server.
  Data: `GET /api/cluster/master` and the `master` key of `GET /api/cluster` (`master_id` "self" or a peer id, `epoch`).

## What was done

- `devices_tab.gd`: the right column is now a vertical `ScrollContainer` around the VBox, so this server's rear panel,
  cables list, lighting consoles and every linked server's rear view scroll together and keep full size. The three
  scroll areas are tracked in `_scrolls`; the wheel is routed in `_input` to the area under the pointer only
  (`devices_scroll.gd`), so a Panel cannot swallow it. Rear-panel clicks (`begin_drag`, `label_at`, background click)
  need the pointer inside the right area. The `ClusterPanel` `self_role` signal feeds `RearPanel.set_identity`. File kept at
  499 lines by condensing its header comment and a few multi-line lambdas.
- `devices_scroll.gd` (new): pure helpers `clipped`, `scroll_rects`, `control_clipped`, `wheel_delta`, `scrolled`,
  `area_at`, `wheel`.
- `cable_layer.gd` (not in the original file list, minimal): `_find` and `anchor_at` ignore ports scrolled out of any
  ancestor `ScrollContainer` (the cable is hidden while one end is out of view, and returns when scrolled back).
- `cluster_panel.gd`: removed the inner scroll and `EXPAND_FILL` (the list sits directly in the column, each
  card at natural size). A "this server" row now carries the name, the badge and `Make <name> master`; the shared
  "Make this server master" button is gone. Peer cards use the badge and `Make <name> master` through
  `M.can_make`. Each peer's rear panel header names the server and carries its badge.
- `cluster_model.gd`: `role_badge`, `make_text`, `can_make`.
- `server_badge.gd` (new): the badge control (filled accent pill "MASTER", outlined muted "FOLLOWER").
- `rear_panel.gd`: header "REAR PANEL · <server>" plus the badge (`set_identity`), for this server and the peers.
- `server_controls.gd`, `server_page_model.gd`, `node_panel.gd`: unchanged (nothing to move there).
- Tests: `godot/client/tests/test_wo1018_devices_scroll_master.gd`.

## What was VERIFIED

- `./run-client.sh --test`: 26556 passed, 0 failed (includes the new WO-1018 file: badge for master / follower / no master,
  make-master naming and visibility, clip test, wheel delta and clamping). `--check`: boot OK.
- Screenshot of :0 before the change showed the squeezed second server (see Investigation).
- NOT verified: the live look. The GUI was not launched or driven (owner is using it). To check after the relaunch: the
  wheel over the left column, mid column and right column each scroll only that column; the linked server's rear panel
  at full height; a cable whose rear-panel port scrolls out of view hides and returns; arming a cable from a left-column
  dot and dropping on a rear port still works with the right column scrolled; MASTER pill on this server's row and rear
  panel header (and FOLLOWER on the peer), the button reading "Make highascg5867 master" on the peer's card only.
