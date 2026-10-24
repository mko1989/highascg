extends RefCounted
## WO-732 P3a — core/devices_target_model.gd: a client on a server box that follows another server shows THIS machine in
## Devices (owner: "always the local machine should be at the top"); every other client keeps the connected server.

const DT := preload("res://core/devices_target_model.gd")
var t


func test_pick_this_machine_only_when_following_from_a_server_box() -> void:
	var home := "http://127.0.0.1:4200"
	t.eq(DT.pick("http://192.168.0.23:4200", home, true), home, "following the master from a box that runs a server")
	t.eq(DT.pick(home, home, true), "", "connected to its own server: nothing changes")
	t.eq(DT.pick("http://192.168.0.23:4200", home, false), "", "a laptop with no server at home keeps the connected one")
	t.eq(DT.pick("http://192.168.0.23:4200", "http://192.168.0.9:4200", true), "", "a home that is not this machine")
	t.eq(DT.pick("http://192.168.0.23:4200", "", true), "", "no home at all")


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
	var shell := FileAccess.get_file_as_string("res://app/shell.gd")
	t.eq(shell.contains("DockModel.wanted(DevicesTarget.origin(), Config.args)"), true, "the dock is decided on the box")
	var dock := FileAccess.get_file_as_string("res://app/operator_dock.gd")
	t.eq(dock.contains('{"action": action}, DevicesTarget.api)'), true, "dock launches on the box")
	var upd := FileAccess.get_file_as_string("res://features/settings/updates_pane.gd")
	t.eq(upd.contains('{"confirm": true}, DevicesTarget.api)'), true, "an update installs on the box")
	var q := FileAccess.get_file_as_string("res://app/boot_question.gd")
	t.eq(q.contains("picker.api = api"), true, "the picker answers to the box")
