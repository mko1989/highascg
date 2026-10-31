extends VBoxContainer
## WO-894 — the Visuals tab's Shader mode (owner 31.10: "for shaders we were doing a special panel which in godot is non existent
## now. should be available in the visuals tab"): the Shader Live controls of the SELECTED layer's shader — key controls by
## section, presets, Randomize, Advanced (every detected value), Reset, Save as child — drawn by the widgets of the old
## Shader Live panel (features/live/shader_live_controls.gd + _model.gd, unreached since WO-883). The node keeps the working GLSL and
## rewrites its literals per control (src/shaderfx/shader-live-session.js); visuals_shader_sync.gd sends the ops and recompiles
## the layer's runner (shadertoy_rd.gd) from the result, throttled while a control is dragged. Phase 1: a value is a recompile
## (phase 2 would make the scanned literals UBO uniforms). Left out of the old panel on purpose: Take, the PGM stack and the
## Caspar-mixer rides (a Caspar PRV/PGM deck — the Visuals have the layer list's fader and Send), and Caspar's `wiggle` op (it
## needs a PRV instance) — ≋ here wiggles through the same `set` ops.
## The host is the Visuals tab (sel, slice.layers, _g(), set_shader_cfg()); tests set layer_cb / sync.api_cb / compile_cb instead.
##   layer_cb  → {index, layer} of the selected layer, or {}        sync.api_cb → the box api or null
##   compile_cb(id, cfg) → "" or the compile error (the tab recompiles every layer running that shader)

const Sync := preload("res://features/visuals/visuals_shader_sync.gd")
const W := preload("res://features/live/shader_live_controls.gd")
const M := preload("res://features/live/shader_live_model.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var live_ms := 120  # shader_live_controls.gd slider(): commit while dragging, at most this often (sync throttles the compiles)
var layer_cb: Callable
var compile_cb: Callable
var sync: Sync
var shown := ""  # the shader id the controls are for ("" = a note is shown)
var _view := {}
var _values := {}
var _head: Label
var _dirty: Label
var _save: Button
var _status: Label
var _note: Label
var _main: VBoxContainer
var _adv_btn: Button
var _adv: VBoxContainer
var _adv_open := false


func _init(host: Node = null) -> void:
	sync = Sync.new()
	if host != null:
		layer_cb = func() -> Dictionary:
			var ls: Array = host.slice.get("layers", [])
			var i: int = host.sel if host.sel >= 0 and host.sel < ls.size() else ls.size() - 1  # as the tab's _target()
			return {"index": i, "layer": ls[i]} if i >= 0 else {}
		sync.api_cb = func() -> Variant:
			var dt: Node = host._g("DevicesTarget")
			return dt.box_api if dt != null else null
		compile_cb = host.set_shader_cfg
	sync.view_changed.connect(_on_view)
	sync.compiled.connect(_on_compiled)
	sync.failed.connect(func(text: String) -> void: _say(text, false))
	add_child(sync)
	add_theme_constant_override("separation", 4)
	var bar := HBoxContainer.new()
	add_child(bar)
	_head = Label.new()
	_head.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_child(_head)
	_dirty = Label.new()
	_dirty.text = "● edited, not saved"
	_dirty.add_theme_color_override("font_color", ThemeBuilder.WARN)
	_dirty.visible = false
	bar.add_child(_dirty)
	Kit.button(bar, "Reset all", func() -> void: post_op("reset", {})).tooltip_text = "Every value back to the library shader's"
	_save = Kit.button(bar, "Save as child", func() -> void: post_op("save", {}))
	_save.tooltip_text = "Saves the edited shader as a child in the library (never overwrites the library shader)"
	_save.disabled = true
	_status = W.muted("")
	add_child(_status)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	var body := VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 8)
	scroll.add_child(body)
	_note = W.muted("")
	_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.add_child(_note)
	_main = VBoxContainer.new()
	_main.add_theme_constant_override("separation", 8)
	body.add_child(_main)
	_adv_btn = Button.new()
	_adv_btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_adv_btn.flat = true
	_adv_btn.pressed.connect(func() -> void:
		_adv_open = not _adv_open
		_render_advanced())
	body.add_child(_adv_btn)
	_adv = VBoxContainer.new()
	body.add_child(_adv)


## Every frame (cheap): the selected layer decides what is shown.
func _process(_delta: float) -> void:
	if is_visible_in_tree():
		refresh()


## Which shader is the selected layer's? A different one → its controls load; none (no layer, a layer without a shader) → a note.
func refresh() -> void:
	var sel: Dictionary = layer_cb.call() if layer_cb.is_valid() else {}
	var l: Dictionary = sel.get("layer", {})
	var sid := str(l.get("shader", "")) if str(l.get("scene", "")) == "shader" else ""
	var text := ""
	if sel.is_empty():
		text = "No layers: drop a visual from Sources ▸ Visuals on the canvas, then pick a Shader."
	elif str(l.get("scene", "")) != "shader":
		text = "Layer %d is not a shader layer. Select a Shader layer to edit its controls here." % (int(sel.index) + 1)
	elif sid == "":
		text = "Layer %d has no shader picked yet: drop one from Sources ▸ Visuals on it." % (int(sel.index) + 1)
	_head.text = "Layer %d · %s" % [int(sel.index) + 1, str(_view.get("name", sid))] if not sel.is_empty() and sid != "" else ""
	if sid == shown and (sid != "" or _note.text == text):
		return
	shown = sid
	_view = {}
	_values = {}
	_note.text = text if sid == "" else "Loading…"
	_note.visible = _note.text != ""
	_status.text = ""
	_render()
	sync.load_shader(sid)


## The recompile: library shader `id` with its working GLSL `cfg` → every layer on the live deck that runs it (in place; a
## layer already running exactly this config does nothing). Returns the first compile error, "" when it runs.
static func recompile(deck: Node, layers: Array, id: String, cfg: Dictionary) -> String:
	var err := ""
	for i in layers.size():
		var st: Node = deck.stage_at(i)
		if st != null and layers[i].scene == "shader" and str(layers[i].get("shader", "")) == id:
			var e: String = st.set_shader(cfg)
			err = err if err != "" else e
	return err


func current_values(key: String) -> Array:
	return _values.get(key, [])


## One op per gesture (shader_live_controls.gd calls this): value ops keep the widgets in place, the rest draw them again.
func post_op(op: String, body: Dictionary, rebuild := true) -> void:
	if op == "set" and body.get("values") is Array:
		_values[str(body.key)] = (body.values as Array).duplicate()  # the next component's slider reads its siblings from here
	sync.post_op(op, body, rebuild)


## ≋ SHOW me: Caspar's wiggle op needs a PRV instance, so here the value swings through `set` ops (the same recompile path)
## for ~1.2 s and is restored.
func wiggle(key: String, btn: Button) -> void:
	var p: Dictionary = M.params_by_key(_view).get(key, {})
	if p.is_empty() or not is_inside_tree():
		return
	btn.disabled = true
	var orig: Array = (p.values as Array).duplicate()
	var lo: Variant = p.get("min")
	var hi: Variant = p.get("max")
	var bounded: bool = (lo is float or lo is int) and (hi is float or hi is int)
	var span: float = float(hi) - float(lo) if bounded else 0.0
	for i in 8:
		var ph := sin(float(i) / 7.0 * TAU)
		var vals := orig.map(func(v: Variant) -> float:
			var n := float(v) + (span * 0.12 if span > 0.0 else maxf(0.2, absf(float(v)) * 0.5)) * ph
			return clampf(n, float(lo), float(hi)) if bounded else n)
		post_op("set", {"key": key, "values": vals}, false)
		await get_tree().create_timer(0.15).timeout
		if not is_inside_tree():
			return
	post_op("set", {"key": key, "values": orig}, false)
	if is_instance_valid(btn):
		btn.disabled = false


func rename(p: Dictionary) -> void:
	Kit.prompt(self, "Label for %s — %s (empty clears)" % [str(p.passKey), str(p.name)], str(p.get("label", "")), func(text: String) -> void:
		post_op("label", {"key": str(p.key), "label": text}))


func _on_view(v: Dictionary, rebuild: bool) -> void:
	_view = v
	_values = {}
	for p in v.get("params", []):
		_values[str(p.key)] = (p.values as Array).duplicate()
	_dirty.visible = bool(v.get("dirty", false))
	_save.disabled = not _dirty.visible
	_note.visible = false
	if str(v.get("saved_as", "")) != "":
		_say("Saved as %s (a child of %s) in the library" % [str(v.saved_as), str(v.get("parentId", v.get("id", "")))], true)
	elif not _status.text.begins_with("Shader error"):
		_say("", true)
	if rebuild or _main.get_child_count() == 0:
		_render()
	var sel: Dictionary = layer_cb.call() if layer_cb.is_valid() else {}
	if not sel.is_empty():
		_head.text = "Layer %d · %s" % [int(sel.index) + 1, str(v.get("name", shown))]


func _on_compiled(sid: String, cfg: Dictionary) -> void:
	var e: String = str(compile_cb.call(sid, cfg)) if compile_cb.is_valid() else ""
	if e != "":
		_say("Shader error: %s (the last good picture keeps running)" % e, false)
	elif _status.text.begins_with("Shader error"):
		_say("", true)


func _say(text: String, ok: bool) -> void:
	_status.text = text
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED if ok else ThemeBuilder.ERROR)


## Presets bar, the key controls by section, the summary (shader_live_panel.gd's layout).
func _render() -> void:
	for c in _main.get_children():
		c.queue_free()
	_adv_btn.visible = not _view.is_empty()
	_dirty.visible = bool(_view.get("dirty", false))
	_save.disabled = not _dirty.visible
	if not _view.is_empty():
		_main.add_child(_presets_bar())
		var by := M.params_by_key(_view)
		for sec in M.sections(_view):
			var flow := HFlowContainer.new()
			flow.add_theme_constant_override("h_separation", 18)
			for c in sec.controls:
				flow.add_child(W.key_control(self, c, by))
			_main.add_child(W.group(str(sec.title), flow))
		var sum := HBoxContainer.new()
		sum.add_child(W.muted(M.summary(_view)))
		var hidden := int(_view.get("hiddenManual", 0))
		if hidden > 0:
			Kit.button(sum, "restore %d hidden" % hidden, func() -> void: post_op("unhide", {}))
		_main.add_child(sum)
	_render_advanced()


func _presets_bar() -> Control:
	var row := HFlowContainer.new()
	Kit.button(row, "Original", func() -> void: post_op("preset", {"original": true})).tooltip_text = "Restore every value to the library shader"
	for n in _view.get("presets", []):
		var name := str(n)
		Kit.button(row, name, func() -> void: post_op("preset", {"name": name})).tooltip_text = "Apply preset"
		row.add_child(W.tool_btn("×", "Delete preset %s" % name, func() -> void: post_op("preset-delete", {"name": name})))
	Kit.button(row, "+ Preset", func() -> void:
		Kit.prompt(self, "Preset name", "", func(text: String) -> void:
			if text.strip_edges() != "":
				post_op("preset-save", {"name": text.strip_edges()}))).tooltip_text = "Save the current values as a preset (kept with the shader in the library)"
	Kit.button(row, "Randomize", func() -> void: post_op("randomize", {})).tooltip_text = "Randomize the key controls"
	return row


## The Advanced fold-away: every detected value, built only while open (up to ~50 rows).
func _render_advanced() -> void:
	for c in _adv.get_children():
		c.queue_free()
	var n: int = (_view.get("params", []) as Array).size()
	_adv_btn.text = "%s Advanced — all %d detected values" % ["▾" if _adv_open else "▸", n]
	if not _adv_open or _view.is_empty():
		return
	var by := M.params_by_key(_view)
	for g in _view.get("advanced", []):
		var rows := VBoxContainer.new()
		for k in g.get("keys", []):
			if by.has(str(k)):
				rows.add_child(W.param_row(self, by[str(k)]))
		_adv.add_child(W.group(str(g.get("title", "")), rows))
