extends VBoxContainer
## WO-606 — Shader FX editor: detected parameters (web shader-fx-params.js, WO-340). The node scans the UNSAVED
## sources (POST /api/shader-live/scan) and rewrites one literal (…/rewrite); the editor writes the new source
## back into its CodeEdit and saves (the web auto-saved per change). Rescans 300 ms after typing stops.

signal source_rewritten(pass_key: String, source: String)

const W := preload("res://features/live/shader_live_controls.gd")
const SL := preload("res://features/live/shader_live_model.gd")
const FX := preload("res://features/live/shader_fx_model.gd")

var sources_cb: Callable  # → [common: String, sources: Dictionary]
var _head: Button
var _grid: GridContainer
var _scroll: ScrollContainer
var _open := false
var _params: Array = []
var _sig := ""
var _rescan: Timer


func _ready() -> void:
	_head = Button.new()
	_head.flat = true
	_head.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_head.pressed.connect(func() -> void:
		_open = not _open
		_render())
	add_child(_head)
	_scroll = ScrollContainer.new()
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(_scroll)
	_grid = GridContainer.new()
	_grid.columns = 3
	_scroll.add_child(_grid)
	_rescan = Timer.new()
	_rescan.one_shot = true
	_rescan.wait_time = 0.3
	_rescan.timeout.connect(rescan)
	add_child(_rescan)
	_render()


func schedule_rescan() -> void:
	_rescan.start()


func rescan() -> void:
	var cs: Array = sources_cb.call()
	var r: Dictionary = await Api.post_json("/api/shader-live/scan", FX.sources_body(cs[0], cs[1]))
	_params = r.data.get("params", []) if r.ok and r.data is Dictionary else []
	var sig := JSON.stringify(_params)
	if sig != _sig:  # typing that does not touch a param keeps the rows (and an open picker) alive
		_sig = sig
		_render()


func _render() -> void:
	_head.text = "%s Detected parameters (%d)" % ["▾" if _open else "▸", _params.size()]
	for c in _grid.get_children():
		c.queue_free()
	_scroll.custom_minimum_size.y = 220 if _open and not _params.is_empty() else 0
	if not _open:
		return
	for p in _params:
		var name := W.muted(str(p.name))
		name.tooltip_text = str(p.passKey)
		name.custom_minimum_size.x = 180
		_grid.add_child(name)
		_grid.add_child(_widgets(p))
		_grid.add_child(W.muted(str(p.passKey)))


func _widgets(p: Dictionary) -> Control:
	var idx := int(p.index)
	var vals: Array = p.get("values", [])
	if str(p.get("kind", "")) == "color":
		var pick := ColorPickerButton.new()
		pick.color = SL.to_color(vals)
		pick.edit_alpha = int(p.get("vec", 3)) == 4
		pick.custom_minimum_size = Vector2(64, 26)
		pick.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		pick.popup_closed.connect(func() -> void: _apply(idx, SL.from_color(pick.color, int(p.get("vec", 3)))))
		return pick
	var box := VBoxContainer.new()
	box.custom_minimum_size.x = 420
	for ci in vals.size():
		var row := HBoxContainer.new()
		var out := Label.new()
		out.custom_minimum_size.x = 64
		out.text = SL.fmt(float(vals[ci]), float(p.get("step", 0.01)))
		var c: int = ci
		row.add_child(W.slider(float(p.get("min", 0)), float(p.get("max", 1)), float(p.get("step", 0.01)), float(vals[ci]), func(v: float) -> void:
			var next: Array = vals.duplicate()
			next[c] = v
			_apply(idx, next), out))
		row.add_child(out)
		box.add_child(row)
	return box


func _apply(index: int, values: Array) -> void:
	var cs: Array = sources_cb.call()
	var body := FX.sources_body(cs[0], cs[1])
	body["index"] = index
	body["values"] = values
	var r: Dictionary = await Api.post_json("/api/shader-live/rewrite", body)
	if r.ok and r.data is Dictionary and r.data.get("ok", false):
		source_rewritten.emit(str(r.data.passKey), str(r.data.source))
