extends VBoxContainer
## WO-695 — "Patch" for the heads selected in the previs (fixture_selection.gd): mode (when they share a GDTF type),
## Art-Net / sACN, universe and start address; Apply re-patches them (patch_edit_model.gd) into project.fixtures and
## marks them `manual_patch`, so an MVR scene's re-patch keeps the operator's choice. Shows why a head is not sent
## (GET /api/fixtures/dmx problem, e.g. universe 0 looping into this box's own Art-Net input). Hidden with no selection.

const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
const M := preload("res://features/previs/fixtures/fixtures_model.gd")
const P := preload("res://features/previs/fixtures/patch_edit_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var types: Array = []  # /api/fixtures/types summaries (set by fixtures_section)
var sel: RefCounted = Sel.shared()
var _what: Label
var _mode: OptionButton
var _proto: OptionButton
var _universe: SpinBox
var _address: SpinBox
var _note: Label


func _ready() -> void:
	add_theme_constant_override("separation", 4)
	var head := Label.new()
	head.text = "Patch (selected heads)"
	add_child(head)
	_what = _muted()
	_mode = OptionButton.new()
	_mode.fit_to_longest_item = false
	_mode.tooltip_text = "DMX mode (channel layout) — must match the mode set on the real fixture"
	add_child(_mode)
	var row := HBoxContainer.new()
	_proto = OptionButton.new()
	_proto.add_item("Art-Net")
	_proto.add_item("sACN")
	_proto.item_selected.connect(func(i: int) -> void:
		_universe.min_value = 1 if i == 1 else 0
		_universe.max_value = F.SACN_UNIVERSE_MAX if i == 1 else F.PORT_ADDRESS_MAX)
	row.add_child(_proto)
	_universe = _spin(0, F.PORT_ADDRESS_MAX, "Universe (Art-Net port-address / sACN universe)", "U")
	row.add_child(_universe)
	_address = _spin(1, 512, "Start address — further heads follow on, each after the previous one's channels", "@")
	row.add_child(_address)
	var apply := Button.new()
	apply.text = "Apply"
	apply.pressed.connect(_apply)
	row.add_child(apply)
	add_child(row)
	_note = _muted()
	sel.changed.connect(_fill)
	_fill()


func _spin(lo: int, hi: int, tip: String, prefix: String) -> SpinBox:
	var s := SpinBox.new()
	s.min_value = lo
	s.max_value = hi
	s.tooltip_text = tip
	s.prefix = prefix
	s.select_all_on_focus = true
	return s


func _muted() -> Label:
	var l := Label.new()
	l.autowrap_mode = TextServer.AUTOWRAP_WORD
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(l)
	return l


func _patch() -> Array:
	return F.normalize(Store.project.get("fixtures")).patch


## Fields ← the first selected head (address order); the mode list is the shared type's.
func _fill() -> void:
	var s := P.selected(_patch(), sel.ids)
	visible = not s.is_empty()
	if s.is_empty():
		return
	var first: Dictionary = s[0]
	var fp := M.fixture_footprint(first, types)
	_what.text = ("%s · %s %d.%03d · %s (%d ch)" % [first.name, "sACN" if first.protocol == "sacn" else "Art-Net",
		int(first.universe), int(first.address), first.mode if str(first.mode) != "" else "generic", fp]) if s.size() == 1 \
		else "%d heads — they run on from the start address in their current order" % s.size()
	_mode.clear()
	var t := P.common_type(s)
	for m in M.find_type(types, t).get("modes", []):
		_mode.add_item("%s · %d ch" % [m.name, int(m.footprint)])
		_mode.set_item_metadata(_mode.item_count - 1, str(m.name))
		if str(m.name) == str(first.mode):
			_mode.select(_mode.item_count - 1)
	_mode.disabled = _mode.item_count == 0
	if _mode.disabled:
		_mode.add_item("(mixed types — modes stay)" if t == "" and s.size() > 1 else "(no GDTF modes)")
	_proto.select(1 if first.protocol == "sacn" else 0)
	_proto.item_selected.emit(_proto.selected)
	_universe.set_value_no_signal(int(first.universe))
	_address.set_value_no_signal(int(first.address))
	_note.text = ""
	_show_problems(s.map(func(f: Dictionary) -> String: return str(f.id)))


func _apply() -> void:
	var mode := "" if _mode.disabled or _mode.selected < 0 else str(_mode.get_item_metadata(_mode.selected))
	var slice := F.normalize(Store.project.get("fixtures"))
	var r := P.repatch(slice.patch, types, sel.ids, mode, "sacn" if _proto.selected == 1 else "artnet",
		int(_universe.value), int(_address.value))
	if r.has("error"):
		_say(r.error, false)
		return
	slice.patch = r.patch
	Store.project["fixtures"] = slice
	ProjectSync.mark_dirty(true)
	Store.project_changed.emit(Store.project)
	_say("Re-patched. Next free address after them: %d." % int(r.next) if int(r.next) <= 512 else "Re-patched.", true)
	var ids: Array = sel.ids.duplicate()
	await get_tree().create_timer(1.5).timeout  # the engine applies the write once it reaches the server
	if is_inside_tree():
		_show_problems(ids)


## The server's reason a selected head is not sent (self-loop, overlap, unknown mode), under the fields.
func _show_problems(ids: Array) -> void:
	var res: Dictionary = await Api.get_json("/api/fixtures/dmx")
	if not is_inside_tree() or not res.ok or not res.data is Dictionary:
		return
	var probs := []
	for u in res.data.get("universes", []):
		for f in (u.get("fixtures", []) if u is Dictionary else []):
			if f is Dictionary and ids.has(str(f.get("id", ""))) and f.get("problem") != null:
				probs.append("%s: %s" % [f.name, f.problem])
	if probs.is_empty():
		return
	var loop := probs.any(func(p: String) -> bool: return p.contains("loop into this box"))
	_say("Not sent — " + "; ".join(probs) + (". The previs still shows them; patch them on another universe to drive "
		+ "real heads." if loop else "."), false)


func _say(text: String, ok: bool) -> void:
	_note.text = text
	_note.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED if ok else ThemeBuilder.WARN)
