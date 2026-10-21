extends AcceptDialog
## WO-606 — Shader FX editor (web shader-fx-modal.js, WO-266 / WO-380): the shader library (/api/shaders) — list,
## new, Shadertoy import (fills the form, never saves), name / audio / alpha, Common + Image + Buffer A–D in GLSL
## CodeEdits with iChannel selects, detected parameters, Save & export (template/shaders/<id>), Delete. The web's
## preview <iframe> becomes **Preview on PRV** — a real Caspar render through the Shader Live audition.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const FX := preload("res://features/live/shader_fx_model.gd")
const Kit := preload("res://features/settings/pane_kit.gd")
const Params := preload("res://features/live/shader_fx_params.gd")

var _id := ""
var _list: ItemList
var _import: LineEdit
var _name: LineEdit
var _audio: CheckBox
var _alpha: CheckBox
var _beat_row: HBoxContainer  # WO-662: visible only while "audio reactive" is on
var _beat_sliders := {}  # "flash" | "bump" | "kick" → HSlider
var _tabs: TabContainer
var _code := {}  # "common" | pass key → CodeEdit
var _chans := {}  # pass key → [OptionButton × 4]
var _params: Params
var _delete: Button
var _preview: Button
var _status: Label


static var _shown: AcceptDialog


## One editor per app: reopening raises it (and switches to `id` when given).
static func show_editor(host: Node, id := "") -> void:
	if _shown == null or not is_instance_valid(_shown):
		_shown = new()
		host.get_tree().root.add_child(_shown)
	var d: Variant = _shown
	d.refresh_list(id)
	if id != "":
		d.open_shader(id)
	_shown.popup_centered()


func _init() -> void:
	title = "Shader FX"
	ok_button_text = "Close"
	exclusive = false
	size = Vector2i(1500, 800)
	var split := HSplitContainer.new()
	split.custom_minimum_size = Vector2(1460, 700)
	add_child(split)
	var left := VBoxContainer.new()
	left.custom_minimum_size.x = 260
	split.add_child(left)
	Kit.button(left, "+ New shader", func() -> void: _fill({}))
	_list = ItemList.new()
	_list.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_list.item_selected.connect(func(i: int) -> void: open_shader(str(_list.get_item_metadata(i))))
	left.add_child(_list)
	Kit.note(left, "Saved shaders export to template/shaders/ and appear in Templates after a refresh.").custom_minimum_size.x = 250  # autowrap measures at 1 px otherwise
	var right := VBoxContainer.new()
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	split.add_child(right)
	var imp := Kit.row(right)
	imp.add_child(_lbl("Import"))
	_import = LineEdit.new()
	_import.placeholder_text = "https://www.shadertoy.com/view/lldcR8"
	_import.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_import.text_submitted.connect(func(_t: String) -> void: _do_import())
	imp.add_child(_import)
	Kit.button(imp, "Fetch", func() -> void: _do_import())
	var meta := Kit.row(right)
	meta.add_child(_lbl("Name"))
	_name = LineEdit.new()
	_name.placeholder_text = "My audio shader"
	_name.custom_minimum_size.x = 360
	meta.add_child(_name)
	_audio = CheckBox.new()
	_audio.text = "audio reactive"
	meta.add_child(_audio)
	_alpha = CheckBox.new()
	_alpha.text = "alpha"
	_alpha.tooltip_text = "Transparent background (overlay use)"
	meta.add_child(_alpha)
	# WO-662: beat knobs under the audio checkbox (shown only while audio reactive is on).
	_beat_row = Kit.row(right)
	_beat_row.tooltip_text = "On the beat: flash = brighter, bump = zoom pulse, kick = time surge. Shaders can also read iBeat (pulse, BPM, phase, count) and iAudioBands (bass, mid, high, level). Applies live on save."
	_beat_row.add_child(_lbl("Beat"))
	for k in ["flash", "bump", "kick"]:
		_beat_row.add_child(_lbl(k))
		var s := HSlider.new()
		s.min_value = 0.0
		s.max_value = 1.0
		s.step = 0.05
		s.custom_minimum_size.x = 90
		s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		_beat_row.add_child(s)
		_beat_sliders[k] = s
	_audio.toggled.connect(func(_on: bool) -> void: _beat_row.visible = _audio.button_pressed)
	_tabs = TabContainer.new()
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right.add_child(_tabs)
	_add_code_tab("common", "Common", false)
	for p in FX.PASSES:
		_add_code_tab(p[0], p[1], true)
	_params = Params.new()
	_params.sources_cb = func() -> Array: return [(_code["common"] as CodeEdit).text, _sources()]
	_params.source_rewritten.connect(func(k: String, src: String) -> void:
		var ce: CodeEdit = _code.get(k)
		if ce != null:
			ce.text = src
		_save())
	right.add_child(_params)
	var act := Kit.row(right)
	Kit.button(act, "Save & export", func() -> void: _save())
	_delete = Kit.button(act, "Delete", func() -> void:
		Kit.confirm(self, "Delete shader %s from the library (and its exported template)?" % _id, _do_delete))
	_preview = Kit.button(act, "Preview on PRV", func() -> void: _do_preview())
	_preview.tooltip_text = "Stage the saved shader alone on the preview bus (a real Caspar render)"
	_status = Label.new()
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.clip_text = true  # a long server error must not widen the dialog; the tooltip has it whole
	_status.custom_minimum_size.x = 200
	act.add_child(_status)
	_fill({})


func _lbl(t: String) -> Label:
	var l := Label.new()
	l.text = t
	return l


func _add_code_tab(key: String, title: String, with_channels: bool) -> void:
	var box := VBoxContainer.new()
	box.name = title
	if with_channels:
		var row := HBoxContainer.new()
		var sels: Array = []
		for i in 4:
			row.add_child(_lbl("iCh%d" % i))
			var o := OptionButton.new()
			for c in FX.CHANNEL_OPTIONS:
				o.add_item(c if c != "" else "—")
			row.add_child(o)
			sels.append(o)
		_chans[key] = sels
		box.add_child(row)
	var ce := CodeEdit.new()
	ce.size_flags_vertical = Control.SIZE_EXPAND_FILL
	ce.gutters_draw_line_numbers = true
	ce.syntax_highlighter = FX.highlighter(Color("#79c0ff"), Color("#ff7b72"), Color("#d2a8ff"), Color("#a5d6ff"), ThemeBuilder.TEXT_MUTED, Color("#ffa657"))
	ce.placeholder_text = "// optional: Shadertoy Common tab" if key == "common" else "// paste the Shadertoy %s tab GLSL here" % title
	ce.text_changed.connect(func() -> void: _params.schedule_rescan())
	box.add_child(ce)
	_code[key] = ce
	_tabs.add_child(box)


func _sources() -> Dictionary:
	var out := {}
	for p in FX.PASSES:
		out[p[0]] = (_code[p[0]] as CodeEdit).text
	return out


func _channels() -> Dictionary:
	var out := {}
	for k in _chans:
		var arr: Array = []
		for o in _chans[k]:
			arr.append(FX.CHANNEL_OPTIONS[(o as OptionButton).selected])
		out[k] = arr
	return out


## Library row → form (web fillForm); {} = a new shader.
func _fill(cfg: Dictionary) -> void:
	_id = str(cfg.get("id", ""))
	_name.text = str(cfg.get("name", ""))
	var audio: Variant = cfg.get("audio")
	_audio.button_pressed = (not (audio is Dictionary) or audio.get("enabled", true) != false) if not cfg.is_empty() else true
	_beat_row.visible = _audio.button_pressed  # WO-662: set_pressed doesn't emit toggled
	var beat: Dictionary = FX.beat_of(cfg)
	for k in _beat_sliders:
		(_beat_sliders[k] as HSlider).value = beat[k]
	var opts: Variant = cfg.get("opts")
	_alpha.button_pressed = opts is Dictionary and opts.get("alpha", false) == true
	(_code["common"] as CodeEdit).text = str(cfg.get("common", ""))
	var passes: Dictionary = cfg.get("passes", {}) if cfg.get("passes") is Dictionary else {}
	for p in FX.PASSES:
		var pd: Dictionary = passes.get(p[0], {}) if passes.get(p[0]) is Dictionary else {}
		(_code[p[0]] as CodeEdit).text = str(pd.get("source", ""))
		var chs: Array = pd.get("channels", []) if pd.get("channels") is Array else []
		for i in 4:
			(_chans[p[0]][i] as OptionButton).select(FX.channel_index(chs[i] if i < chs.size() else null))
	_tabs.current_tab = 1  # Image
	_delete.disabled = _id == ""
	_preview.disabled = _id == ""
	_say("Editing %s" % _id if _id != "" else "New shader", true)
	_params.rescan()


func refresh_list(select_id := "") -> void:
	var r: Dictionary = await Api.get_json("/api/shaders")
	if not r.ok or not (r.data is Dictionary):
		_say("List failed: %s" % r.error, false)
		return
	_list.clear()
	for s in r.data.get("shaders", []):
		_list.add_item(FX.list_label(s))
		_list.set_item_metadata(_list.item_count - 1, str(s.id))
		if str(s.id) == select_id:
			_list.select(_list.item_count - 1)


func open_shader(id: String) -> void:
	var r: Dictionary = await Api.get_json("/api/shaders/" + id.uri_encode())
	if not r.ok or not (r.data is Dictionary):
		_say("Load failed: %s" % r.error, false)
		return
	_fill(r.data)


## WO-380: fetch → fill the form as a NEW shader, never save (a paste must not overwrite the open one).
func _do_import() -> void:
	var url := _import.text.strip_edges()
	if url == "":
		return
	_say("Fetching from Shadertoy…", true)
	var r: Dictionary = await Api.post_json("/api/shaders/import", {"url": url})
	if not r.ok or not (r.data is Dictionary) or not (r.data.get("config") is Dictionary):
		_say("Import failed: %s" % (r.data.get("error", r.error) if r.data is Dictionary else r.error), false)
		return
	var cfg: Dictionary = r.data.config.duplicate()
	cfg.erase("id")
	_fill(cfg)
	_say(FX.import_note(r.data.config), true)


func _save() -> void:
	_say("Saving…", true)
	var beat := {}
	for k in _beat_sliders:
		beat[k] = (_beat_sliders[k] as HSlider).value
	var body := FX.collect(_id, _name.text, (_code["common"] as CodeEdit).text, _sources(), _channels(), _audio.button_pressed, _alpha.button_pressed, beat)
	var r: Dictionary = await Api.post_json("/api/shaders", body)
	if not r.ok or not (r.data is Dictionary) or not r.data.get("ok", false):
		_say(str(r.data.get("error", r.error)) if r.data is Dictionary else r.error, false)
		return
	_id = str(r.data.id)
	_delete.disabled = false
	_preview.disabled = false
	_say("Saved — Caspar template \"%s\" (refresh Templates to play)" % r.data.get("casparPath", ""), true)
	refresh_list(_id)


func _do_delete() -> void:
	var r: Dictionary = await Api.delete_json("/api/shaders/" + _id.uri_encode())
	if not r.ok:
		_say("Delete failed: %s" % r.error, false)
		return
	_fill({})
	refresh_list()
	_say("Deleted", true)


func _do_preview() -> void:
	var r: Dictionary = await Api.post_json("/api/shader-live/audition", {"value": "shaders/" + _id, "label": _name.text, "mainIndex": 0})
	if r.ok and r.data is Dictionary and r.data.get("ok", false):
		_say("%s → preview" % _name.text, true)
	else:
		_say("Preview failed: %s" % (r.data.get("error", r.error) if r.data is Dictionary else r.error), false)


func _say(text: String, ok: bool) -> void:
	_status.text = text
	_status.tooltip_text = text
	_status.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED if ok else ThemeBuilder.ERROR)
