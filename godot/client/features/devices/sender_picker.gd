extends HBoxContainer
## WO-723 — "Sent by" / "Received by": which linked server does `kind` (lighting | ptz | artnet_in). Server
## src/cluster/server-senders.js through GET / POST /api/server/senders and WS `server:senders`; the choice reaches the
## other linked servers from there. Hidden while no server is linked, so a single box shows nothing new (owner 24.10:
## "when devices are connected there should be a choice … which server should send, receive").

const M := preload("res://features/devices/cluster_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var kind := ""
var _opt: OptionButton
var _items: Array = []


## `label` is the row's word: "Sent by" or "Received by".
static func make(k: String, label: String) -> HBoxContainer:
	var p: HBoxContainer = (load("res://features/devices/sender_picker.gd") as GDScript).new()
	p.kind = k
	p.set_meta("label", label)
	return p


func _ready() -> void:
	visible = false
	var l := Label.new()
	l.text = str(get_meta("label", "Sent by"))
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(l)
	_opt = OptionButton.new()
	_opt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_opt.tooltip_text = "Which linked server does this. Auto: the server doing tracking, else the master."
	if kind == "artnet_in":
		_opt.tooltip_text = "Which linked server listens to the lighting desk. Auto: every server, for the screens it shows."
	_opt.item_selected.connect(_pick)
	add_child(_opt)
	Ws.on("server:senders", func(d: Variant) -> void: _show(d))
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			reload())
	reload()


func reload() -> void:
	var r: Dictionary = await Api.get_json("/api/server/senders")
	if r.ok:
		_show(r.data)


func _show(view: Variant) -> void:
	if not is_instance_valid(_opt) or _opt.has_focus() and _opt.get_popup().visible:
		return
	_items = M.sender_items(view, kind)
	visible = not _items.is_empty()
	_opt.clear()
	for it in _items:
		_opt.add_item(str(it.text))
		_opt.set_item_tooltip(_opt.item_count - 1, str(it.get("tip", "")))
	if not _items.is_empty():
		_opt.select(M.sender_index(view, kind))


func _pick(i: int) -> void:
	if i < 0 or i >= _items.size():
		return
	var r: Dictionary = await Api.post_json("/api/server/senders", {"kind": kind, "by": str(_items[i].by)})
	if r.ok:
		_show(r.data)
	else:
		reload()  # back to what the server holds
