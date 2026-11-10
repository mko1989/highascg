# 06 — One Devices view for all linked servers; operator GUI and live inputs per server (plan, 10.11.2026)

Condensed from the planner's read-only review (code + GETs on both boxes). Owner's words are in WO-1029.

## Today
- A linked server's card shows its rear panel frozen (no clicks) and its cables as text; "Edit" switches the whole
  Devices tab (api, settings, state, Apply) to that server through the node's relay (`core/devices_target.gd edit_peer`).
- A cable is an edge `dst_in_<dest> → <connector>` in the owning server's `config/device_graph.json`; Apply is per
  server and restarts its Caspar. Connector ids are the same on every box (`gpu_p0`, `dlsdi_1`…): shown together they
  must be tagged with their server.
- Destinations are one shared list only while show sharing is on, and a Devices edit travels with the next autosave.
- `dst_operator_gui` is ONE shared entry cabled separately per box; `commitShow` copies the master's `physicalPort`,
  `headless`, `videoOutput`, `shmName` onto the follower (harmless today only because both hold the same values).
- Several operator GUI entries in a shared list would give every box that many GUI channels and shift its channel
  numbers (`routing-map.js:210`).
- Removing a destination prunes cables only on the box where it was removed → orphan cables elsewhere (seen on 5867:
  `dst_mw2fn9wr_1 → Pixel Mapping 1`, which blocked that input; fixed 10.11, see WO).
- Live inputs are box config (`extraLiveSources`, DeckLink directions, `inputChannels`), not in the project. A look
  layer copies only the route (`route://9-3`), not the input's identity — WO-1027 / WO-1028.
- `config-classify.js` lists `recordOutputs / streamOutputs / audioOutputs / rtmp` as show data while
  `stripDeviceLocalFromProject` strips them.

## Target
- **One view:** shared destination column; per server (tagged) its rear panel, mapping nodes, operator GUI card and
  live-input cards. A cable belongs to the server whose connector it ends on; connector → connector stays inside one
  server. Apply per server, plus "Apply all" (followers first, master last).
- **Operator GUI per server (option b):** it leaves the shared show at the merge boundary (`show-merge.showOf` drops
  `mode: operator_gui`, `intoProject` puts the local one back). No consumer of the list changes, no data migration.
  A new master keeps sending its entry to an older-build peer for one release.
- **Live inputs per server:** named `{ server, input }` with `input` = `decklink:<slot>` / `ndi_host:<sourceId>` …,
  never a channel number; resolved at take time on the box that plays the look. A box that does not own the input
  skips the layer and shows a labelled placeholder — there is NO video transport between boxes today (an NDI return or
  a declared SDI loop would be new). Sources → Live grouped by server. One migration pass rewrites the existing looks
  ("2box Mixer" → highascg5867 decklink:3, "2box PPT" → decklink:4), ambiguous ones listed, never guessed.
- **Stays per server by nature:** connector inventory, modes / EDID, DeckLink directions, stream keys, audio outputs,
  channel numbers, Art-Net output.

## Steps (files do not overlap inside a group)
- S1 operator GUI local in the shared show — `show-merge.js`, `shared-show-ctx.js`, `shared-show.js` (version gate).
- S2 `config-classify.js` consistency.
- S3 combined `GET /api/cluster/device-view` — new `cluster-device-view.js`, `cluster-peers.js` (stale view kept).
- S4 relay writes invalidate the cached view + `cluster:devices` WS + `DEST_UNKNOWN_HERE` — `cluster-relay.js`,
  `routes-cluster.js`, `device-view-crud.js`. (S3 and S4: one implementer.)
- S5 destinations shared on link, without the show toggle (D1).
- S6 removing a destination clears its cables on every online server; orphans flagged.
- S7 client target registry — `core/devices_target.gd`.
- S8 unified model and layout — new `server_keys.gd`, `devices_unified.gd`; `devices_tab.gd`, `cluster_panel.gd`,
  `rear_panel.gd`, `cable_layer.gd`, `cables_list.gd`.
- S9 gesture and inspector pages per server (split `cable_gesture.gd` first: it is at the 500-line limit).
- S10 Apply per server. S11 remove Edit. S12 two-box verification.
- S13 input key helper (`live-input-key.js`, heal refactor). S14 resolve at take time, skip foreign inputs
  (+ fake inputs in the virtual box bed). S15 merged live-source list + Sources UI. S16 look migration.
  S17 live-input cards per server in Devices. S18 input transport (only if wanted).

## Owner decisions
- D1 destinations shared whenever servers are linked, without the "share the show" toggle?
- D2 operator GUI as option (b), one per box, never shared?
- D3 "Apply all" one server at a time, followers first?
- D4 remove the Edit button once every page works per server?
- D5 share mapping templates?
- D6 mixed builds: version gate, or always update both boxes together?
- D7 cables of a deleted destination: flagged, removed on an explicit delete, never auto-pruned on a show take?
- D8 inputs named `{server, input}`, resolved on the playing box?
- D9 another server's input on this box: placeholder only, an NDI return, or a declared SDI loop?
- D10 Sources → Live always lists every linked server's inputs?
- D11 look migration automatic by label + route match (ambiguous listed), or confirmed per look?
