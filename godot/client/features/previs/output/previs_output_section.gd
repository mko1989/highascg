extends VBoxContainer
## WO-1108 — the Previs Inspector's "Output" fold: "Send as a source" (the previs picture as shm ring `previs`, a Live
## source), its size, its camera ("My view" or a camera slider move, WO-1109) and one status line (on, or why not).
## Saved in project.previs.output (previs_output_model.gd) through ProjectSync like the other previs sections.

const OM := preload("res://features/previs/output/previs_output_model.gd")
const UI := preload("res://features/previs/previs_ui.gd")

signal edited  ## the slice changed here (the Previs output applies it)

var cfg := OM.normalize(null)
var _on := CheckBox.new()
var _size := OptionButton.new()
var _cam := OptionButton.new()
var _status := UI.caption("")


func _init() -> void:  # built at once: show_state may come before the fold is in the tree
	add_theme_constant_override("separation", 6)
	_on.text = "Send as a source"
	_on.tooltip_text = "The previs picture as a Live source (Sources ▸ Live ▸ Previs): put it on a look layer to record or stream it"
	_on.toggled.connect(func(on: bool) -> void: _edit("enabled", on))
	add_child(_on)
	var grid := GridContainer.new()
	grid.columns = 2
	for s in OM.SIZES:
		_size.add_item("%d×%d" % [s[0], s[1]])
	_size.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_size.item_selected.connect(func(i: int) -> void: _edit("size", (OM.SIZES[i] as Array).duplicate()))
	_cam.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_cam.fit_to_longest_item = false
	_cam.tooltip_text = "My view: what this view shows. A camera slider move: it plays on the output by itself (your view stays free)"
	_cam.item_selected.connect(func(i: int) -> void: _edit("camera", str(_cam.get_item_metadata(i))))
	for row in [["Size", _size], ["Camera", _cam]]:
		var cap := UI.caption(row[0])
		cap.autowrap_mode = TextServer.AUTOWRAP_OFF  # a wrapping label in a grid column collapses to nothing
		grid.add_child(cap)
		grid.add_child(row[1])
	add_child(grid)
	add_child(_status)


## The slice, the camera slider moves (the Camera picker) and the status line.
func show_state(out: Dictionary, moves: Array, status: String) -> void:
	cfg = out
	_on.set_pressed_no_signal(out.enabled == true)
	_size.select(OM.SIZES.find(out.size))
	_cam.clear()
	for it in OM.camera_items(moves):
		_cam.add_item(it[0])
		_cam.set_item_metadata(_cam.item_count - 1, it[1])
		if it[1] == str(out.camera):
			_cam.select(_cam.item_count - 1)
	if OM.camera_missing(out, moves):
		_cam.add_item("(move gone) — my view")
		_cam.set_item_metadata(_cam.item_count - 1, str(out.camera))
		_cam.select(_cam.item_count - 1)
	_status.text = status
	_status.visible = status != ""


func _edit(key: String, v: Variant) -> void:
	if cfg.get(key) == v:
		return
	cfg[key] = v
	cfg = OM.normalize(cfg)
	if not Store.project.is_empty():
		var pv: Dictionary = Store.project.get("previs") if Store.project.get("previs") is Dictionary else {}
		pv["output"] = cfg.duplicate(true)
		Store.project["previs"] = pv
		ProjectSync.mark_dirty()
	edited.emit()
