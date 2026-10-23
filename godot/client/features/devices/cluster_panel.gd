extends VBoxContainer
## WO-670 P2 — "Servers" under the cables list: the servers this one is linked with (server src/cluster/, GET
## /api/cluster, WS `cluster:peers`). "+" adds one by address or from a scan of this box's network. Each linked server
## shows its state (online, version, role, program channels, media against this project), the role it plays for each
## shared destination (cluster_model.gd: cabled on both → backup, only there → extension) and its own rear panel and
## cables, read-only: each server keeps its own wiring (owner, WO-670 answer 2). Nothing here drives a peer yet (P3/P4).
## P2b: "Send media" pushes this project's media to it (server cluster-media.js; both servers must have linked each
## other); the progress / result line comes from the peer's `media_send` in the snapshot.
## P3a: the master line (who runs the show, epoch, auto failover — server cluster-master.js, snapshot `master`), a
## MASTER tag on its card, "Make master" on this server and on every linked one. P3b: "This client follows the master"
## (app/cluster_follow.gd). P4: on each card while this server is master, which destinations its takes are forwarded
## to there (channel translation, sent count, catch-up), or why not; on a server that is not master, a note that its
## PGM follows the master.

const M := preload("res://features/devices/cluster_model.gd")
const Model := preload("res://features/devices/devices_model.gd")
const RearPanel := preload("res://features/devices/rear_panel.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const DutiesBlock := preload("res://features/devices/server_duties_block.gd")

var _snap := {}
var _views := {}  # peer id → its device-view payload
var _own := {}  # this server's device-view payload (for the roles)
var _list: VBoxContainer
var _self_l: Label
var _master_row: VBoxContainer
var _master_l: Label
var _follow_l: Label
var _auto: CheckBox
var _take: Button
var _make: ConfirmationDialog
var _make_id := ""
var _add: ConfirmationDialog
var _addr: LineEdit
var _found: VBoxContainer
var _add_status: Label
var _remove: ConfirmationDialog
var _remove_id := ""
var _send_err := {}  # peer id → why the last Send was refused (cleared by the next Send)
var _sig := ""


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	var head := HBoxContainer.new()
	head.add_child(_small("SERVERS", ThemeBuilder.TEXT_MUTED))
	var plus := Button.new()
	plus.text = "+"
	plus.flat = true
	plus.tooltip_text = "Link another HighAsCG server (backup or more screens)"
	plus.pressed.connect(_open_add)
	head.add_child(plus)
	_self_l = _small("", ThemeBuilder.TEXT_MUTED)
	_self_l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_self_l.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	head.add_child(_self_l)
	add_child(head)
	add_child(DutiesBlock.new())  # WO-712 R1: this server's own ticks, above the linked ones
	_build_master_row()
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	var scroll := ScrollContainer.new()  # the rest of the column's height: more servers scroll, the window never grows
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 12)
	scroll.add_child(_list)
	_build_add()
	_remove = ConfirmationDialog.new()
	_remove.confirmed.connect(func() -> void:
		await Api.delete_json("/api/cluster/peers/" + _remove_id.uri_encode())
		reload())
	add_child(_remove)
	Ws.on("cluster:peers", func(d: Variant) -> void:
		if d is Dictionary:
			_snap = d
			if is_visible_in_tree():
				_render())
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			reload())


func reload() -> void:
	var r: Dictionary = await Api.get_json("/api/cluster")
	if r.ok and r.data is Dictionary:
		_snap = r.data
	_views = {}
	var own: Dictionary = await Api.get_json("/api/device-view")
	_own = own.data if own.ok and own.data is Dictionary else {}
	_sig = ""
	_render()


func _render() -> void:
	var sig := JSON.stringify(_snap)
	if sig == _sig:
		return
	_sig = sig
	var me: Dictionary = _snap.get("self", {}) if _snap.get("self") is Dictionary else {}
	_self_l.text = "This server: %s · %s" % [str(me.get("hostname", "?")), str(me.get("version", ""))] if not me.is_empty() else ""
	var ms: Dictionary = _master()
	_master_row.visible = not _snap.get("peers", []).is_empty()
	_master_l.text = M.master_line(ms)
	_follow_l.text = M.follow_note(_snap)
	_follow_l.visible = _follow_l.text != ""
	_auto.set_pressed_no_signal(ms.get("auto", true) == true)
	_auto.disabled = int(ms.get("epoch", 0)) <= 0
	_take.visible = ms.get("is_master") != true
	for c in _list.get_children():
		c.queue_free()
	var peers: Array = _snap.get("peers", [])
	if peers.is_empty():
		_list.add_child(_small("No linked servers. Click + to add one (a backup, or a server for more screens).", ThemeBuilder.TEXT_MUTED))
	for p in peers:
		if p is Dictionary:
			_list.add_child(_card(p))


func _card(p: Dictionary) -> Control:
	var id := str(p.id)
	var card := PanelContainer.new()
	card.add_theme_stylebox_override("panel", ThemeBuilder.box(ThemeBuilder.BG_PANEL, ThemeBuilder.BORDER, 1))
	var v := VBoxContainer.new()
	card.add_child(v)
	var top := HBoxContainer.new()
	var dot := _small("●", ThemeBuilder.SUCCESS if p.get("online") == true else ThemeBuilder.ERROR if p.get("online") == false else ThemeBuilder.TEXT_MUTED)
	top.add_child(dot)
	var name_l := Label.new()
	name_l.text = str(p.get("name", id))
	top.add_child(name_l)
	if M.is_master(_master(), id):
		top.add_child(_small("MASTER", ThemeBuilder.ACCENT))
	var facts := _small(M.facts(p), ThemeBuilder.WARN if p.get("media_parity") == "differs" else ThemeBuilder.TEXT_MUTED)
	facts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	facts.clip_text = true
	facts.tooltip_text = facts.text
	top.add_child(facts)
	var send := Button.new()
	send.text = "Send media"
	send.disabled = p.get("online") != true or M.sending(p)
	send.tooltip_text = "Copy this project's media to %s now (rsync). Both servers must have linked each other." % str(p.get("name", id))
	send.pressed.connect(func() -> void: _send(id))
	top.add_child(send)
	if not M.is_master(_master(), id) and p.get("online") == true and p.get("identity") == true:
		var mk := Button.new()
		mk.text = "Make master"
		mk.tooltip_text = "%s runs the show from now on (every linked server is told)." % str(p.get("name", id))
		mk.pressed.connect(func() -> void: _confirm_make(id, str(p.get("name", id))))
		top.add_child(mk)
	var x := Button.new()
	x.text = "✕"
	x.flat = true
	x.tooltip_text = "Unlink this server (its own setup is untouched)"
	x.pressed.connect(func() -> void:
		_remove_id = id
		_remove.dialog_text = "Unlink %s? Its own setup stays as it is." % str(p.get("name", id))
		_remove.popup_centered())
	top.add_child(x)
	v.add_child(top)
	var does := M.does_text(p.get("duties"))  # WO-712 R1: its ticks, read-only (set in its own Devices view)
	if does != "":
		v.add_child(_small(does, ThemeBuilder.TEXT_MUTED))
	var line := M.send_line(p, str(_send_err.get(id, "")))
	if line != "":
		var sl := _small(line, ThemeBuilder.ERROR if M.send_failed(p) or _send_err.has(id) else ThemeBuilder.TEXT)
		sl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		v.add_child(sl)
	var fl := M.fanout_line(_snap, id)
	if fl != "":
		var fan := _small(fl, ThemeBuilder.ERROR if M.is_fanout_error(fl) else ThemeBuilder.TEXT_MUTED)
		fan.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		v.add_child(fan)
	var body := VBoxContainer.new()
	v.add_child(body)
	body.add_child(_small("Loading its devices…" if p.get("online") != false else "Offline: its devices are not shown.", ThemeBuilder.TEXT_MUTED))
	if p.get("online") != false:
		_fill(id, body)
	return card


## The peer's own rear panel + cables, read-only, and what it does for the shared destinations.
func _fill(id: String, body: VBoxContainer) -> void:
	if not _views.has(id):
		var r: Dictionary = await Api.get_json("/api/cluster/peers/%s/device-view" % id.uri_encode())
		_views[id] = r.data if r.ok and r.data is Dictionary else {"error": str(r.get("error", "no data"))}
	if not is_instance_valid(body):
		return
	for c in body.get_children():
		c.queue_free()
	var view: Dictionary = _views[id]
	if view.has("error"):
		body.add_child(_small("Devices unavailable: " + str(view.error), ThemeBuilder.ERROR))
		return
	var m := Model.build(view)
	body.add_child(_small("Roles (from its cables): " + M.roles_text(M.roles(_own, view)), ThemeBuilder.TEXT))
	var rear := RearPanel.new()
	body.add_child(rear)
	rear.show_slots(m.slots)
	rear.set_process_input(false)
	_freeze(rear)
	for c in m.cables:
		body.add_child(_small("• " + str(c.label), ThemeBuilder.TEXT_MUTED))


func _send(id: String) -> void:
	_send_err.erase(id)
	var r: Dictionary = await Api.post_json("/api/cluster/peers/%s/send-media" % id.uri_encode(), {})
	if not r.ok:
		_send_err[id] = str(r.get("error", "")) if str(r.get("error", "")) != "" else "Send failed (HTTP %d)" % int(r.get("status", 0))
	_sig = ""
	_render()


func _master() -> Dictionary:
	return _snap.get("master", {}) if _snap.get("master") is Dictionary else {}


func _build_master_row() -> void:
	_master_row = VBoxContainer.new()  # the line, then its controls (one row squeezed the line to "Master: x · ep")
	_master_l = _small("", ThemeBuilder.TEXT)
	_master_l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_master_row.add_child(_master_l)
	_follow_l = _small("", ThemeBuilder.WARN)
	_follow_l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_follow_l.visible = false
	_master_row.add_child(_follow_l)
	var controls := HBoxContainer.new()
	_master_row.add_child(controls)
	_auto = CheckBox.new()
	_auto.text = "Auto failover"
	_auto.tooltip_text = "When the master is unseen for 12 s, the next server takes over (outputs keep playing either way)."
	_auto.toggled.connect(func(on: bool) -> void: _set_master({"auto": on}))
	controls.add_child(_auto)
	var follow := CheckBox.new()
	follow.text = "This client follows the master"
	follow.tooltip_text = "When another server becomes master, or this one is gone, this client reconnects to the master (app/cluster_follow.gd)."
	follow.set_pressed_no_signal(Config.cluster().follow)
	follow.toggled.connect(func(on: bool) -> void: Config.save_cluster({"follow": on}))
	controls.add_child(follow)
	_take = Button.new()
	_take.text = "Make this server master"
	_take.pressed.connect(func() -> void: _confirm_make("self", "This server"))
	controls.add_child(_take)
	add_child(_master_row)
	_make = ConfirmationDialog.new()
	_make.confirmed.connect(func() -> void: _set_master({"master": _make_id}))
	add_child(_make)


func _confirm_make(id: String, name: String) -> void:
	_make_id = id
	_make.dialog_text = "%s becomes the master: it runs the show, and every linked server follows it." % name
	_make.popup_centered()


func _set_master(body: Dictionary) -> void:
	var r: Dictionary = await Api.post_json("/api/cluster/master/set", body)
	if not r.ok:
		var d: Variant = r.get("data")
		_master_l.text = "Master not changed: " + (str(d.get("error", "")) if d is Dictionary else str(r.get("error", "")))
		return
	reload()


## Read-only: no buttons, no clicks (the peer's wiring is edited on the peer).
static func _freeze(n: Node) -> void:
	for c in n.get_children():
		if c is BaseButton:
			(c as BaseButton).visible = false
		elif c is Control:
			(c as Control).mouse_filter = Control.MOUSE_FILTER_IGNORE
		_freeze(c)


func _build_add() -> void:
	_add = ConfirmationDialog.new()
	_add.title = "Link a server"
	_add.ok_button_text = "Link"
	_add.min_size = Vector2i(460, 0)
	var v := VBoxContainer.new()
	_addr = LineEdit.new()
	_addr.placeholder_text = "address, e.g. 192.168.0.40 or box-b.local:4200"
	_addr.text_submitted.connect(func(_t: String) -> void: _link(_addr.text))
	v.add_child(_addr)
	var scan := Button.new()
	scan.text = "Scan the network"
	scan.pressed.connect(_scan)
	v.add_child(scan)
	_found = VBoxContainer.new()
	v.add_child(_found)
	_add_status = _small("", ThemeBuilder.TEXT_MUTED)
	_add_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	v.add_child(_add_status)
	_add.add_child(v)
	_add.get_ok_button().pressed.connect(func() -> void: _link(_addr.text))
	_add.dialog_hide_on_ok = false
	add_child(_add)


func _open_add() -> void:
	_addr.text = ""
	_add_status.text = ""
	for c in _found.get_children():
		c.queue_free()
	_add.popup_centered()
	_addr.grab_focus()


func _scan() -> void:
	_add_status.text = "Scanning…"
	for c in _found.get_children():
		c.queue_free()
	var r: Dictionary = await Api.post_json("/api/cluster/scan", {})
	var found: Array = r.data.get("found", []) if r.ok and r.data is Dictionary else []
	_add_status.text = "Found %d server(s)." % found.size() if r.ok else "Scan failed: %s" % str(r.get("error", ""))
	for f in found:
		var b := Button.new()
		b.text = "%s  (%s · %s)" % [str(f.hostname), str(f.host), str(f.version)]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.pressed.connect(func() -> void: _link("%s:%d" % [str(f.host), int(f.port)]))
		_found.add_child(b)


func _link(address: String) -> void:
	if address.strip_edges() == "":
		_add_status.text = "Enter an address or scan."
		return
	_add_status.text = "Linking %s…" % address
	var r: Dictionary = await Api.post_json("/api/cluster/peers", {"address": address.strip_edges()})
	if not r.ok:
		var err: String = str(r.data.get("error", "")) if r.data is Dictionary else str(r.get("error", ""))
		_add_status.text = err if err != "" else "Could not link %s." % address
		return
	_add.hide()
	reload()


func _small(text: String, color: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 12)
	l.add_theme_color_override("font_color", color)
	return l
