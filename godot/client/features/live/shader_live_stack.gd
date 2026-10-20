extends VBoxContainer
## WO-606 — Shader Live PGM stack (web shader-live-stack.js, WO-379): look-band layers 10–20 of the main's
## PGM channel with their occupants (server-resolved in GET /api/shader-live). Click = land the selected PRV
## shader there with the deck's default transition (an occupied row exchanges); ✕ = fade that layer off air.

signal said(text: String, ok: bool)

const ThemeBuilder := preload("res://app/theme_builder.gd")

var selected_cb: Callable  # → the selected instance Dictionary ({} when none)
var transition_cb: Callable  # → {type, duration} (deck default, resolved)
var _title: Label
var _rows: VBoxContainer
var _sig := ""


func _ready() -> void:
	custom_minimum_size.x = 220
	_title = Label.new()
	_title.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_title)
	_rows = VBoxContainer.new()
	add_child(_rows)


## `stack` = {main, channel, rows: [{layerNumber, occupant}]}; rebuilt only on a real change.
func show_stack(stack: Variant) -> void:
	var st: Dictionary = stack if stack is Dictionary else {}
	var sig := JSON.stringify(st)
	if sig == _sig:
		return
	_sig = sig
	_title.text = "PGM stack" + (" ch%d" % int(st.channel) if st.get("channel") != null else "")
	for c in _rows.get_children():
		c.queue_free()
	for r in st.get("rows", []):
		var n := int(r.layerNumber)
		var occ := str(r.get("occupant", ""))
		var row := HBoxContainer.new()
		var b := Button.new()
		b.text = "%d   %s" % [n, occ if occ != "" else "—"]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.tooltip_text = ("Exchange PGM L%d (%s) with the PRV shader — deck transition" % [n, occ]) if occ != "" else ("Land the PRV shader on PGM L%d — fades in" % n)
		if occ != "":
			b.add_theme_color_override("font_color", ThemeBuilder.SUCCESS)
		b.pressed.connect(func() -> void: _land(n, int(st.get("main", 0))))
		row.add_child(b)
		if occ != "":
			var x := Button.new()
			x.text = "✕"
			x.flat = true
			x.tooltip_text = "Take PGM L%d (%s) off air — fades out" % [n, occ]
			x.pressed.connect(func() -> void: _clear(n, int(st.get("main", 0))))
			row.add_child(x)
		_rows.add_child(row)


func _transition() -> Dictionary:
	var t: Variant = transition_cb.call() if transition_cb.is_valid() else null
	var d: Dictionary = t if t is Dictionary else {}
	return {"type": str(d.get("type", "MIX")), "duration": d.get("duration", 12)}


func _land(n: int, main: int) -> void:
	var inst: Dictionary = selected_cb.call() if selected_cb.is_valid() else {}
	if inst.is_empty() or not inst.get("isPrv", false):
		said.emit("Select the PRV instance of the shader first (or audition one from Templates)", false)
		return
	var r: Dictionary = await Api.post_json("/api/shader-stack", {"mainIndex": main, "layerNumber": n, "value": inst.cgName, "transition": _transition()})
	if r.ok and r.data is Dictionary and r.data.get("ok", false):
		said.emit("%s → PGM L%d" % [inst.shaderId, n], true)
	else:
		said.emit("Stack failed: %s" % (r.data.get("error", r.error) if r.data is Dictionary else r.error), false)


func _clear(n: int, main: int) -> void:
	var r: Dictionary = await Api.post_json("/api/shader-stack", {"mainIndex": main, "layerNumber": n, "clear": true, "transition": _transition()})
	if r.ok and r.data is Dictionary and r.data.get("ok", false):
		said.emit("PGM L%d cleared" % n, true)
	else:
		said.emit("Clear failed: %s" % (r.data.get("error", r.error) if r.data is Dictionary else r.error), false)
