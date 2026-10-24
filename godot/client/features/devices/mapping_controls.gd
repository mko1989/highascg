extends "res://features/devices/host_controls_base.gd"
## WO-605 slice 7c — a pixel mapping node's page in the shared Inspector (web device-view-inspector-mapping.js, opened
## by a mapping card in the column): node label, the cabled input's resolution + "Propose outputs from input", one
## block per output (label, mode / custom size, source rect, Remove), "+ Add Output", Duplicate and Delete.
## mapping_page_model.gd builds the item list; mapping_flow.gd runs the edits through `_Io` below (the Api autoload).
## Text fields commit like the web's `change` (Enter / leaving the field, only when changed); the size and rect fields
## are math inputs that evaluate and clamp first (the web commits math after `change` — WO-605 slice 7c notes).
## Not ported: "Show Mapping Preview" (the pixel-map editor is outside WO-605).

signal dirty()

const M := preload("res://features/devices/mapping_page_model.gd")
const G := preload("res://features/devices/mapping_graph.gd")
const Flow := preload("res://features/devices/mapping_flow.gd")
const MI := preload("res://core/math_input.gd")
const R := preload("res://features/devices/cable_rules.gd")
## Math-input bounds per field: [min, max, decimals] (attachMathInput in the web page).
const NUM := {"cw": [1, INF, 0], "ch": [1, INF, 0], "cf": [1, INF, 2], "x": [-INF, INF, 0], "y": [-INF, INF, 0],
	"w": [-INF, INF, 0], "h": [-INF, INF, 0]}
const SIZE_TIPS := {"cw": "W", "ch": "H", "cf": "FPS"}

var page := VBoxContainer.new()
var node_id := ""
var flow: Flow
var _io: _Io
var _ui := {}  # output index → {mode, cw, ch, cf, x, y, w, h} as the operator left them since the page was shown


class _Io:
	extends RefCounted
	var c

	func _init(owner: Node) -> void:
		c = owner

	static func _web(r: Dictionary) -> Dictionary:
		var err := ""
		if not r.ok:
			err = "HTTP %d: %s" % [r.status, r.error] if int(r.get("status", 0)) > 0 else str(r.error)
		return {"ok": r.ok, "data": r.data, "error": err}

	func get_json(path: String) -> Dictionary:
		return _web(await DevicesTarget.api.get_json(path))

	func post_json(path: String, body: Variant) -> Dictionary:
		return _web(await DevicesTarget.api.post_json(path, body))

	func confirm(text: String) -> bool:
		return await c._confirm(text, "OK")

	func alert(text: String) -> void:
		c.status.emit(text, false)

	func dirty() -> void:
		c.dirty.emit()

	func reload() -> void:
		c.reload.emit(false)

	func status(text: String, ok: bool) -> void:
		c.status.emit(text, ok)

	func fail(text: String) -> void:
		c.status.emit("Mapping save failed: " + text if text != "" else "Mapping save failed", false)


func _init() -> void:
	page.add_theme_constant_override("separation", 4)
	_io = _Io.new(self)


## (Re)open on a device-view load — the web re-renders the page from the new graph, dropping unsaved field edits.
func show_node(payload: Dictionary, id: String) -> void:
	node_id = id
	flow = Flow.new(payload, id, _io)
	_ui = {}
	_render()


func close() -> void:
	node_id = ""


## The column's "+" and a card's "+" (no page needed).
func add_node() -> void:
	await Flow.add_node(_io)


func add_card_output(id: String) -> void:
	await Flow.add_card_output(_io, id, Time.get_unix_time_from_system() * 1000.0)


func _fields(i: int) -> Dictionary:
	if not _ui.has(i):
		var n := G.find_node(flow.payload.get("graph"), node_id)
		_ui[i] = M.field_state(n, R.d(G._outputs(n)[i]))
	return _ui[i]


func _render() -> void:
	if node_id == "":
		return
	var focus: Variant = get_viewport().gui_get_focus_owner() if is_inside_tree() else null
	var refocus: Variant = focus.get_meta("key", null) if focus is LineEdit and page.is_ancestor_of(focus) else null
	for ch in page.get_children():
		page.remove_child(ch)
		ch.queue_free()
	var size_row: HBoxContainer = null  # the custom W / H / FPS fields share a row (the web's 3-column grid)
	for it in M.items(flow.payload, node_id, _ui):
		var n := _item(it)
		var field := str(it.get("key", "")).get_slice(".", 1)
		if field == "cw":
			size_row = HBoxContainer.new()
			page.add_child(size_row)
		if field in ["cw", "ch", "cf"]:
			n.tooltip_text = SIZE_TIPS[field]
			n.placeholder_text = SIZE_TIPS[field]
			size_row.add_child(n)
		else:
			page.add_child(n)
		if refocus != null and n is LineEdit and n.get_meta("key") == refocus:
			n.grab_focus()


func _item(it: Dictionary) -> Control:
	match it.t:
		"heading":
			var h := _text(it.text.to_upper(), ThemeBuilder.TEXT_MUTED, 11)
			h.custom_minimum_size.y = 26
			h.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
			return h
		"subtitle":
			var s := _text(it.text, ThemeBuilder.TEXT, 13)
			s.custom_minimum_size.y = 24
			s.vertical_alignment = VERTICAL_ALIGNMENT_BOTTOM
			return s
		"caption":
			return _caption(it.text)
		"note":
			return _note(it.text)
		"readout":
			return _text(it.text, ThemeBuilder.TEXT, 12)
		"select":
			var i := int(it.key.get_slice(".", 0).trim_prefix("o"))
			var ob := _select(it.options, it.value)
			ob.item_selected.connect(func(n: int) -> void:
				var mode := str(ob.get_item_metadata(n))
				_act(func() -> void:
					await flow.on_mode(i, mode, _fields(i))
					if mode == "custom":
						_render()))
			return ob
		"input":
			return _entry(it)
		"button":
			var b := _button(it.text, func() -> void: pass)
			b.pressed.connect(func() -> void: _act(func() -> void: await _press(it.key), b))
			return b
	return Control.new()


## name / o{i}.label save their text; o{i}.cw|ch|cf save the mode, o{i}.x|y|w|h the slice rect (math first).
func _entry(it: Dictionary) -> LineEdit:
	var le := _line(it.value, "")
	le.editable = not it.disabled
	le.set_meta("committed", le.text)
	le.set_meta("key", it.key)
	var key: String = it.key
	var field := key.get_slice(".", 1)
	var i := int(key.get_slice(".", 0).trim_prefix("o"))
	var commit := func() -> void:
		if NUM.has(field):
			var n: Array = NUM[field]
			le.text = MI.commit(le.text, n[0], n[1], n[2], MI.parse(le.get_meta("committed"))).text
		if le.text == le.get_meta("committed") or not le.editable:
			return
		le.set_meta("committed", le.text)
		var text := le.text
		if key == "name":
			_act(func() -> void: await flow.rename(text))
		elif field == "label":
			_act(func() -> void: await flow.set_label(i, text))
		else:
			_fields(i)[field] = text
			_act(func() -> void:
				if field in ["cw", "ch", "cf"]:
					await flow.save_mode(i, _fields(i))
				else:
					await flow.save_rect(i, _fields(i)))
	le.text_submitted.connect(func(_t: String) -> void: commit.call())
	le.focus_exited.connect(commit)
	return le


func _act(run: Callable, b: Button = null) -> void:
	if _busy:
		return
	_busy = true
	if b != null:
		b.disabled = true
	await run.call()
	_busy = false
	if is_instance_valid(b):
		b.disabled = false


func _press(key: String) -> void:
	match key:
		"Propose outputs from input":
			await flow.propose()
		"+ Add Output":
			await flow.add_output()
		"Duplicate Node":
			await flow.duplicate()
		"Delete Node":
			await flow.delete_node()
		_:
			if key.ends_with(".remove"):
				await flow.remove_output(int(key.get_slice(".", 0).trim_prefix("o")))
