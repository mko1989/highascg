extends RefCounted
## WO-732 — core/devices_target_model.gd and the Devices wiring (owner: "always the local machine should be at the top").
## WO-802 — a client talks only to its own server: no Api to another origin, the "Edit" of a linked server goes through
## this server's relay, and an unlink ends that edit.

const DT := preload("res://core/devices_target_model.gd")
const ConfigScript := preload("res://core/config.gd")
var t


## WO-802: the client's sockets are the WS, the Api pool, the video feed, uploads and downloads — every one built from
## Config.origin. Nothing in the client may point an Api elsewhere or open another socket.
func test_no_client_socket_to_another_server() -> void:
	var allowed := {"HTTPRequest.new()": ["core/api.gd", "features/live/media_download.gd"],
		"WebSocketPeer.new()": ["core/ws.gd", "video/video_feed.gd"], "StreamPeerTCP.new()": ["core/stream_upload.gd"]}
	var found := {}
	var bad := []
	for f in _scripts("res://"):
		var src := FileAccess.get_file_as_string("res://" + f)
		if src.contains("origin_override") or src.contains("Config.cluster(") or src.contains("save_cluster("):
			bad.append(f)
		for k in allowed:
			if src.contains(k):
				found[k] = (found.get(k, []) as Array) + [f]
	t.eq(bad, [], "an Api to another origin, or the old follow state")
	for k in allowed:
		t.eq(found.get(k, []), allowed[k], "%s only in" % k)
	t.eq(FileAccess.file_exists("res://app/cluster_follow.gd"), false, "the follow node is gone")
	var api := FileAccess.get_file_as_string("res://core/api.gd")
	t.ok(api.contains('return Config.origin + ("/api/cluster/peers/%s/relay" % relay_peer.uri_encode() if relay_peer != "" else "")'),
		"every Api goes to Config.origin; a relayed one through it")
	var cfg := FileAccess.get_file_as_string("res://core/config.gd")
	t.ok(cfg.contains("\tforget_cluster(UI_CFG)\n\torigin = home_origin()"), "the origin is the operator's choice only")


## WO-802: a [cluster] section an older client left (a followed master, remembered servers) is erased on start.
func test_old_follow_state_is_erased() -> void:
	var path := "user://test_wo802_ui.cfg"
	var cfg := ConfigFile.new()
	cfg.set_value("cluster", "origin", "http://192.168.0.4:4200")
	cfg.set_value("cluster", "servers", PackedStringArray(["http://192.168.0.4:4200", "http://192.168.0.23:4200"]))
	cfg.set_value("cluster", "follow", true)
	cfg.set_value("connection", "host_a", "127.0.0.1")
	cfg.save(path)
	t.eq(ConfigScript.forget_cluster(path), true, "there was one")
	var back := ConfigFile.new()
	back.load(path)
	t.eq(back.has_section("cluster"), false, "origin, servers and follow are gone")
	t.eq(str(back.get_value("connection", "host_a", "")), "127.0.0.1", "the A/B hosts stay")
	t.eq(ConfigScript.forget_cluster(path), false, "nothing left the second time")
	t.eq(ConfigScript.forget_cluster("user://test_wo802_missing.cfg"), false, "no file")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	t.eq(ConfigScript.resolve_origin({}, "", ""), ConfigScript.DEFAULT_ORIGIN, "nothing chosen: this machine")


## WO-802: the edit of a linked server ends when this server's snapshot no longer lists it.
func test_still_linked() -> void:
	var snap := {"peers": [{"id": "boxB", "host": "192.168.0.4"}, {"id": "stub"}]}
	t.eq(DT.still_linked(snap, "boxB"), true, "listed")
	t.eq(DT.still_linked(snap, "boxC"), false, "not listed")
	t.eq(DT.still_linked({"peers": []}, "boxB"), false, "unlinked: nothing left")
	t.eq(DT.still_linked({}, "boxB"), false, "no peers key")


## Every Devices request goes through the target, so none can reach the followed server by accident. The sender
## picker is the exception: sender choices are the same on every linked server (cluster.senders), and Previs uses it.
func test_devices_code_reaches_servers_only_through_the_target() -> void:
	var dir := DirAccess.open("res://features/devices")
	var direct := RegEx.create_from_string("(?<![A-Za-z_.])(Api|Settings)\\.")
	var found := []
	for f in dir.get_files():
		if not f.ends_with(".gd") or f == "sender_picker.gd":
			continue
		var src := FileAccess.get_file_as_string("res://features/devices/" + f)
		for line in src.split("\n"):
			if not line.strip_edges().begins_with("#") and direct.search(line.get_slice("#", 0)):
				found.append(f)
				break
	t.eq(found, [], "Api. / Settings. used directly in features/devices")


## WO-735: the start-up question, the dock and Settings → Updates belong to the box this client runs on — on a server box that follows
## another server they still ask its own server (a follower's Caspar waited forever for a launcher that never opened).
func test_box_local_features_reach_the_box_through_the_target() -> void:
	var direct := RegEx.create_from_string("(?<![A-Za-z_.])Api\\.")
	for f in ["app/boot_question.gd", "app/operator_dock.gd", "app/operator_dock_menu.gd", "features/settings/updates_pane.gd"]:
		var src := FileAccess.get_file_as_string("res://" + f)
		t.eq(direct.search(src) == null, true, "Api. used directly in " + f)
		t.eq(src.contains("Config.origin"), false, "Config.origin decides in " + f)
		t.eq(src.contains("DevicesTarget.api") or src.contains("DevicesTarget.origin()"), false, "WO-732 P3b: %s follows an edited linked server" % f)
	var shell := FileAccess.get_file_as_string("res://app/shell.gd")
	t.eq(shell.contains("DockModel.wanted(DevicesTarget.box_origin(), Config.args)"), true, "the dock is decided on the box")
	t.eq(shell.contains("await DevicesTarget.box_api.get_json(\"/api/cluster\")"), true, "invites in the tab title are this machine's")
	var dock := FileAccess.get_file_as_string("res://app/operator_dock.gd")
	t.eq(dock.contains('{"action": action}, DevicesTarget.box_api)'), true, "dock launches on the box")
	var upd := FileAccess.get_file_as_string("res://features/settings/updates_pane.gd")
	t.eq(upd.contains('{"confirm": true}, DevicesTarget.box_api)'), true, "an update installs on the box")
	var q := FileAccess.get_file_as_string("res://app/boot_question.gd")
	t.eq(q.contains("picker.api = api"), true, "the picker answers to the box")


## WO-732 P3b — "Edit" on a linked server's card: the origin it is reached at, and the wiring that keeps undo, the
## restart flag and the box-local features on the server they belong to.
func test_edit_linked_server() -> void:
	t.eq(DT.peer_origin({"host": "192.168.0.4", "port": 4200}), "http://192.168.0.4:4200", "host + port")
	t.eq(DT.peer_origin({"host": "box.local"}), "http://box.local:4200", "default port")
	t.eq(DT.peer_origin({"host": "fe80::1", "port": 4300}), "http://[fe80::1]:4300", "IPv6 bracketed")
	t.eq(DT.peer_origin({"host": ""}), "", "no host: no Edit")
	t.eq(DT.peer_origin({"host": "a/b"}), "", "not a host")
	var panel := FileAccess.get_file_as_string("res://features/devices/cluster_panel.gd")
	t.ok(panel.contains("await DevicesTarget.edit_peer(id, str(p.get(\"name\", id)), DTM.peer_origin(p))"), "Edit → edit_peer by id (WO-802)")
	t.eq(panel.contains("This client follows the master"), false, "WO-802: no follow switch")
	t.ok(panel.contains("_back.pressed.connect(func() -> void: DevicesTarget.stop_editing())"), "Back → this machine")
	var tab := FileAccess.get_file_as_string("res://features/devices/devices_tab.gd")
	t.ok(tab.contains("DevicesTarget.target_changed.connect(func() -> void: _gesture.forget(); refresh())"), "a switch reloads and forgets the gesture")
	var g := FileAccess.get_file_as_string("res://features/devices/cable_gesture.gd")
	var f := g.substr(g.find("func forget() -> void:"), 120)
	t.ok(f.contains("_undo.clear()") and f.contains("restart_dirty = false"), "undo / restart flag never cross servers")
	var dt := FileAccess.get_file_as_string("res://core/devices_target.gd")
	t.ok(dt.contains("return _peer_api if editing != \"\" else box_api"), "Devices requests follow the edited server")
	t.ok(dt.contains("return Platform.is_local_origin(box_origin())"), "on_box() never follows it")
	t.ok(dt.contains("relayed.relay_peer = peer_id"), "WO-802: the edit goes through this server's relay")
	t.ok(dt.contains("Ws.on(\"cluster:peers\", _on_snap)") and dt.contains("DTM.still_linked(d, editing_id)"), "WO-802: an unlink ends the edit")


func _scripts(dir: String, rel := "") -> PackedStringArray:
	var out := PackedStringArray()
	var d := DirAccess.open(dir + rel)
	if d == null:
		return out
	for f in d.get_files():
		if f.ends_with(".gd"):
			out.append(rel + f)
	for sub in d.get_directories():
		if not sub.begins_with(".") and sub != "tests" and sub != "addons":
			out.append_array(_scripts(dir, rel + sub + "/"))
	return out
