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

const M := preload("res://features/devices/devices_follow_model.gd")


## `host` = the tab (the node is added under it), `gesture` = cable_gesture.gd, `bar` = devices_toolbar.gd,
## `set_sticky` = func(sticky: bool) — the tab's "this status outlives the next 'Updated …'" flag.
static func attach(host: Node, gesture: Node, bar: Node, set_sticky: Callable) -> Node:
	var f: Node = (load("res://features/devices/devices_follow.gd") as GDScript).new()
	f.set_meta("targets", [gesture, bar, set_sticky])
	host.add_child(f)
	return f


func _ready() -> void:
	Ws.on("change", _on_change)
	var g: Node = get_meta("targets")[0]
	g.connect("applied", func(data: Dictionary) -> void:  # cable_gesture.gd: every successful Apply reply
		var warn := M.layout_warning(data)
		if warn != "":
			_on_apply_warned(warn))


func _on_apply_warned(text: String) -> void:
	var t: Array = get_meta("targets")
	t[2].call(true)
	t[1].set_status(text, false, true)


func _on_change(d: Variant) -> void:
	if not d is Dictionary or DevicesTarget.editing != "":  # an edited peer's Caspar is not this node's
		return
	var path := str(d.get("path"))
	if not M.clears_status(path, d.get("value")):
		return
	var t: Array = get_meta("targets")
	t[2].call(false)
	t[1].set_status("", true)
	if M.restart_on_activate(path, d.get("value")):
		t[0].set_dirty(true)
	elif path == "hardwareConfig":
		await get_tree().create_timer(2.0).timeout  # the comparison is recomputed after the new config lands
		if M.misaligned(DevicesTarget.value("configComparison")):
			t[0].set_dirty(true)
