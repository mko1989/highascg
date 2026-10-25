extends HBoxContainer
## WO-774 (detachable, WO-741) — owner 25.10: "Then give a drop down to select only by fixture type." At the top of the
## VR panel: "All types" or one GDTF type of the patch. With a type chosen, the controller only takes heads of that
## type — a box select and a trigger on a head (xr_walk.gd, through type_id()) — and **Select** takes them all.

const Walk := preload("res://features/previs/xr/xr_walk_model.gd")
const F := preload("res://features/previs/tracking/follow_model.gd")
const Sel := preload("res://features/previs/fixtures/fixture_selection.gd")

var sel: RefCounted = Sel.shared()
var pick: OptionButton
var select_all: Button
var _types: Array = []  # Walk.patch_types, the menu's rows after "All types"
var _names := {}  # typeId → "Manufacturer Name"
var _key := ""
var _loading := false
var _asked := {}  # type ids a names fetch was made for (one fetch per new type, never a loop on an unknown one)


func _ready() -> void:
	var l := Label.new()
	l.text = "Type"
	l.custom_minimum_size.x = 70
	add_child(l)
	pick = OptionButton.new()
	pick.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	pick.clip_text = true
	pick.item_selected.connect(func(_i: int) -> void: _mark())
	add_child(pick)
	select_all = Button.new()
	select_all.text = "Select"
	select_all.tooltip_text = "Select every fixture of this type"
	select_all.pressed.connect(func() -> void: sel.set_ids(Walk.of_type(_patch(), type_id())))
	add_child(select_all)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _fill())
	_fill()


## The chosen GDTF type id, "" = all types.
func type_id() -> String:
	var i := pick.selected - 1 if pick != null else -1
	return str(_types[i].id) if i >= 0 and i < _types.size() else ""


func _patch() -> Array:
	return F.normalize(Store.project.get("fixtures")).patch


func _load_names() -> void:
	if _loading:
		return
	_loading = true
	var res: Dictionary = await Api.get_json("/api/fixtures/types")
	_loading = false
	for t in (res.data.get("types", []) if res.ok and res.data is Dictionary else []):
		if t is Dictionary and str(t.get("id", "")) != "":
			_names[str(t.id)] = ("%s %s" % [t.get("manufacturer", ""), t.get("name", "")]).strip_edges()
	_key = ""
	_fill()


## Rebuilt only when the patch's types change (an autosave must not close the open menu).
func _fill() -> void:
	var types := Walk.patch_types(_patch(), _names)
	var key := JSON.stringify(types)
	if key == _key:
		return
	_key = key
	var fresh := types.filter(func(t: Dictionary) -> bool: return not _names.has(t.id) and not _asked.has(t.id))
	if not fresh.is_empty() and not _loading:
		for t in fresh:
			_asked[t.id] = true
		_load_names()  # the patch has a type not named yet (first fill, or one imported since)
	var keep := type_id()
	_types = types
	pick.clear()
	pick.add_item("All types")
	for t in _types:
		pick.add_item("%s (%d)" % [t.name, t.count])
	pick.select(1 + _types.map(func(t: Dictionary) -> String: return t.id).find(keep) if keep != "" else 0)
	_mark()


func _mark() -> void:
	select_all.disabled = type_id() == ""
