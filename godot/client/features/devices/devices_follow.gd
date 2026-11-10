extends Node
## WO-918 — what the Devices tab does when the PROJECT changes under it (a header Load / New project, WS `change`
## project.activated / hardwareConfig) and when an Apply answers with a layout problem. Kept out of devices_tab.gd
## (500-line limit); the tab only calls attach().
##   F1  a load whose reply says restartRequired marks the Apply button dirty (devices_toolbar.gd reads
##       cable_gesture.restart_dirty). The server tells us only for a Load (project-activate.js broadcasts
##       restartRequired); New project replies with nothing, so after its hardwareConfig broadcast the header's config
##       comparison decides (aligned == false -> dirty).
##   F5  the previous Apply's green line ("…Caspar restarted.") goes when the project changes.
##   F3  POST /api/caspar-config/apply answers {layoutOk, layoutProblem}: false -> warn colour + the problem.
##   F26 (WO-919) the OS layout watchdog gave up after a node restart: state `osLayout` {ok:false, mismatches} (also a WS
##       change) -> the same warn status line; a successful Apply clears it (the server sends osLayout {ok:true}).
##   F13 (WO-919) the tab's own refresh on project.activated / hardwareConfig runs before the header's _adopt reloads
##       Settings, so the host cards compared the OLD show's planned channelMap with the new live one (pending apply)
##       and kept its "Live audio input 1" card: refresh again once Settings has loaded.

const M := preload("res://features/devices/devices_follow_model.gd")


## `host` = the tab (the node is added under it), `gesture` = cable_gesture.gd, `bar` = devices_toolbar.gd,
## `set_sticky` = func(sticky: bool) — the tab's "this status outlives the next 'Updated …'" flag.
static func attach(host: Node, gesture: Node, bar: Node, set_sticky: Callable) -> Node:
	var f: Node = (load("res://features/devices/devices_follow.gd") as GDScript).new()
	f.set_meta("targets", [gesture, bar, set_sticky])
	host.add_child(f)
	var flow := Node.new()  # WO-1029: the Apply button's cluster-wide path (plan, confirm, progress, results)
	flow.set_script(load("res://features/devices/apply_flow.gd"))
	host.add_child(flow)
	flow.setup(gesture, bar, set_sticky)
	return f


var _os_text := ""  # the OS layout line currently on the toolbar ("" = not ours)


func _ready() -> void:
	Ws.on("change", _on_change)
	DevicesTarget.box_settings.loaded.connect(func() -> void:  # F13: the planned channelMap the host cards compare with is now current
		var host := get_parent() as Control
		if host != null and M.refresh_on_settings_loaded(DevicesTarget.editing, host.is_visible_in_tree()):
			host.call("refresh"))
	Store.changed.connect(func(p: String, _v: Variant) -> void:
		if p == "osLayout" or p == "*":
			_show_os_layout())
	_show_os_layout.call_deferred()  # the tab's first "Updated …" status lands first; the sticky flag keeps ours
	var g: Node = get_meta("targets")[0]
	g.connect("applied", func(data: Dictionary) -> void:  # cable_gesture.gd: every successful Apply reply
		var warn := M.layout_warning(data)
		if warn != "":
			_on_apply_warned(warn))


func _on_apply_warned(text: String) -> void:
	var t: Array = get_meta("targets")
	t[2].call(true)
	t[1].set_status(text, false, true)


## WO-919 F26: show (or take back) the OS layout give-up in the toolbar status.
func _show_os_layout() -> void:
	if DevicesTarget.editing != "":  # the watchdog is this box's; an edited peer has its own
		return
	var text := M.os_layout_warning(Store.get_value("osLayout"))
	var t: Array = get_meta("targets")
	if text != "":
		_os_text = text
		t[2].call(true)
		t[1].set_status(text, false, true)
	elif _os_text != "":
		if str(t[1].get("_status").text) == _os_text:  # an Apply reply may already have replaced it: leave that line
			t[2].call(false)
			t[1].set_status("", true)
		_os_text = ""


func _on_change(d: Variant) -> void:
	if not d is Dictionary or DevicesTarget.editing != "":  # an edited peer's Caspar is not this node's
		return
	var path := str(d.get("path"))
	if not M.clears_status(path, d.get("value")):
		return
	var t: Array = get_meta("targets")
	t[2].call(false)
	t[1].set_status("", true)
	_os_text = ""
	_show_os_layout()  # a new project does not fix the screens: the OS layout line comes back
	if M.restart_on_activate(path, d.get("value")):
		t[0].set_dirty(true)
	elif path == "hardwareConfig":
		await get_tree().create_timer(2.0).timeout  # the comparison is recomputed after the new config lands
		if M.misaligned(DevicesTarget.value("configComparison")):
			t[0].set_dirty(true)
