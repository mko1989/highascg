extends VBoxContainer
## WO-606 — Shader Live (web shader-live-editor.js, WO-345): every shader live on any channel, the selected
## one's key controls + every detected value, edits riding straight onto the running producer. Replaces the
## looks deck while open (the compose picture above stays). The node owns the working copy, the scan and the
## CG UPDATE push (/api/shader-live…); this panel renders the view and posts one op per gesture.

signal close_requested

const M := preload("res://features/live/shader_live_model.gd")
const W := preload("res://features/live/shader_live_controls.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Kit := preload("res://features/settings/pane_kit.gd")

var take_cb: Callable  # the deck's PRV → PGM take for screen 1 (web #shl-take clicked the global take)

var _instances: Array = []
var _list_sig := ""
var _selected := ""
var _shader := ""
var _view: Dictionary = {}
var _values := {}  # param key → current values (sliders read their siblings from here)
var _pick: OptionButton
var _dirty: Label
var _save: Button
var _status: Label
var _main: VBoxContainer
var _adv_btn: Button
var _adv: VBoxContainer
var _adv_open := false
var _poll: Timer


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var bar := HBoxContainer.new()
	add_child(bar)
	var title := Label.new()
	title.text = "Shader Live"
	title.add_theme_font_size_override("font_size", 18)
	bar.add_child(title)
	_pick = OptionButton.new()
	_pick.custom_minimum_size.x = 340
	_pick.item_selected.connect(func(i: int) -> void: _select(str(_pick.get_item_metadata(i))))
	bar.add_child(_pick)
	Kit.button(bar, "▶ Take", func() -> void: _take()).tooltip_text = "Take preview to program (same transition as the deck TAKE)"
	_dirty = Label.new()
	_dirty.text = "● live edits not saved"
	_dirty.add_theme_color_override("font_color", ThemeBuilder.WARN)
	_dirty.visible = false
	bar.add_child(_dirty)
	var sp := Control.new()
	sp.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bar.add_child(sp)
	Kit.button(bar, "Reset all", func() -> void: post_op("reset", {})).tooltip_text = "Restore every parameter to the library values (recovery for a broken shader)"
	_save = Kit.button(bar, "Save to library", func() -> void: post_op("save", {}))
	_save.tooltip_text = "Saves the edited shader as a child (never overwrites the library shader)"
	_save.disabled = true
	Kit.button(bar, "✕", func() -> void: close_requested.emit()).tooltip_text = "Back to looks"
	_status = W.muted("")
	add_child(_status)
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	var content := VBoxContainer.new()
	content.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	content.add_theme_constant_override("separation", 8)
	scroll.add_child(content)
	_main = VBoxContainer.new()
	_main.add_theme_constant_override("separation", 8)
	content.add_child(_main)
	content.add_child(W.group("Layer (Caspar mixer)", W.mixer_rows(self)))
	_adv_btn = Button.new()
	_adv_btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_adv_btn.flat = true
	_adv_btn.pressed.connect(func() -> void:
		_adv_open = not _adv_open
		_render_advanced())
	content.add_child(_adv_btn)
	_adv = VBoxContainer.new()
	content.add_child(_adv)
	_poll = Timer.new()
	_poll.wait_time = 1.0
	_poll.timeout.connect(_refresh_instances)
	add_child(_poll)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			_poll.start()
			_refresh_instances()
		else:
			_poll.stop())


## Server-resolved instance list (playlists on air, banks) — polled while open, like the web tracker.
func _refresh_instances() -> void:
	var r: Dictionary = await Api.get_json("/api/shader-live")
	if not r.ok or not (r.data is Dictionary):
		return
	_instances = r.data.get("instances", [])
	var sig := JSON.stringify(_instances)
	if sig == _list_sig:
		return
	_list_sig = sig
	_pick.clear()
	var dev := str(Config.args.get("shader-live-id", ""))  # dev: a library shader's view with no live instance (pushes nothing)
	if _instances.is_empty() and dev != "":
		_instances = [{"key": dev + "@0-0", "shaderId": dev, "channel": 0, "pLayer": 0, "isPrv": true, "sceneName": "not on air"}]
	if _instances.is_empty():
		_pick.add_item("— no live shader —")
		_pick.set_item_metadata(0, "")
		_selected = ""
		_shader = ""
		_view = {}
		_render()
		return
	var want := M.follow_key(_instances, _selected)
	for i in _instances:
		_pick.add_item(M.instance_label(i))
		_pick.set_item_metadata(_pick.item_count - 1, str(i.key))
		if str(i.key) == want:
			_pick.select(_pick.item_count - 1)
	_select(want)


func _select(key: String) -> void:
	_selected = key
	var inst := M.find_instance(_instances, key)
	var id := str(inst.get("shaderId", ""))
	if id == "" or id == _shader:
		return
	_shader = id
	var r: Dictionary = await Api.get_json("/api/shader-live/shaders/" + id.uri_encode())
	if not r.ok:
		_say("Load failed: %s" % r.error, false)
		return
	_set_view(r.data, true)


func _set_view(v: Variant, rebuild: bool) -> void:
	_view = v if v is Dictionary else {}
	_values = {}
	for p in _view.get("params", []):
		_values[str(p.key)] = (p.values as Array).duplicate()
	_dirty.visible = bool(_view.get("dirty", false))
	_save.disabled = not _dirty.visible
	if rebuild:
		_render()


func current_values(key: String) -> Array:
	return _values.get(key, [])


## One op per gesture; value ops (set / macro) keep the widgets in place, everything else re-renders.
func post_op(op: String, body: Dictionary, rebuild := true) -> void:
	if _shader == "":
		_say("No shader live — take a shader look to PGM or PRV.", false)
		return
	var r: Dictionary = await Api.post_json("/api/shader-live/shaders/%s/%s" % [_shader.uri_encode(), op], body)
	if not r.ok or not (r.data is Dictionary) or not r.data.get("ok", false):
		_say("%s failed: %s" % [op, r.data.get("error", r.error) if r.data is Dictionary else r.error], false)
		return
	_set_view(r.data.get("view"), rebuild)
	var note := M.push_note(r.data)
	if op == "save":
		var root: Variant = _view.get("parentId")
		_say("Saved as %s (child of %s)" % [r.data.get("savedAs", "?"), str(root) if root != null else _shader], true)
	elif note != "":
		_say(note, note.begins_with("Not on air"))
	else:
		_say("", true)


func wiggle(key: String, btn: Button) -> void:
	btn.disabled = true
	await post_op("wiggle", {"key": key}, false)
	if is_instance_valid(btn):
		btn.disabled = false


func rename(p: Dictionary) -> void:
	Kit.prompt(self, "Label for %s — %s (empty clears)" % [str(p.passKey), str(p.name)], str(p.get("label", "")), func(text: String) -> void:
		post_op("label", {"key": str(p.key), "label": text}))


func mixer(cmd: String, v: float) -> void:
	var inst := M.find_instance(_instances, _selected)
	if inst.is_empty():
		return
	var r: Dictionary = await Api.post_json("/api/shader-live/mixer", {"channel": inst.channel, "layer": inst.pLayer, "cmd": cmd, "value": v})
	if not r.ok:
		_say("MIXER %s failed: %s" % [cmd, r.error], false)


func _take() -> void:
	if not take_cb.is_valid():
		return
	var r: Variant = await take_cb.call()
	if r is Dictionary and not r.get("ok", false):
		_say("Take failed: %s" % r.get("error", "nothing on PRV"), false)


func _say(text: String, ok: bool) -> void:
	_status.text = text
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED if ok else ThemeBuilder.ERROR)


## Main panel: presets bar, the synthesized key controls by section, the summary (web panel.html()).
func _render() -> void:
	for c in _main.get_children():
		c.queue_free()
	if _view.is_empty():
		_main.add_child(W.muted("No shader live — take a shader look to PGM or PRV."))
		_adv_btn.visible = false
		_render_advanced()
		return
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
	_adv_btn.visible = true
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
				post_op("preset-save", {"name": text.strip_edges()}))).tooltip_text = "Save the current values as a preset"
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
