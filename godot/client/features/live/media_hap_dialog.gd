extends ConfirmationDialog
## WO-603 slice 4 — "Encode to HAP" options (web media-hap-encode-modal.js, WO-575): Alpha + HQ (both OFF every time,
## owner default), the file list, the resulting format and the warnings. The advisory pre-check is the server's
## (POST /api/media/hap-encode/probe → items + onAir); Encode is usable before it answers, like the web.

signal encode(alpha: bool, hq: bool)

const Hap := preload("res://features/live/hap_status.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const LIST_MAX := 6
const WARN := Color("#fbbf24")
const WIDTH := 460.0  # autowrap labels need a width before the dialog sizes itself, or it grows screen-tall

var ids: Array = []
var _alpha: CheckBox
var _hq: CheckBox
var _format: Label
var _warnings: VBoxContainer
var _probe: Variant = null
var _on_air := false


func _init(selected: Array) -> void:
	ids = selected
	title = "Encode to HAP"
	ok_button_text = "Encode"
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(WIDTH, 0)
	var hint := Label.new()
	hint.text = "%d file%s — saved next to the original as <name>_HAP.mov. Originals are not changed." % [ids.size(), "" if ids.size() == 1 else "s"]
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.custom_minimum_size = Vector2(WIDTH, 0)
	box.add_child(hint)
	for id in ids.slice(0, LIST_MAX):
		box.add_child(_muted("  " + str(id).get_file(), str(id)))
	if ids.size() > LIST_MAX:
		box.add_child(_muted("  …and %d more" % (ids.size() - LIST_MAX)))
	_alpha = CheckBox.new()
	_alpha.text = "Alpha channel"
	_alpha.toggled.connect(func(_on: bool) -> void: _refresh())
	box.add_child(_alpha)
	_hq = CheckBox.new()
	_hq.text = "High quality (HAP Q)"
	_hq.toggled.connect(func(_on: bool) -> void: _refresh())
	box.add_child(_hq)
	_format = Label.new()
	box.add_child(_format)
	_warnings = VBoxContainer.new()
	box.add_child(_warnings)
	add_child(box)
	confirmed.connect(func() -> void:
		encode.emit(_alpha.button_pressed, _hq.button_pressed)
		queue_free())
	canceled.connect(queue_free)


func _ready() -> void:
	_refresh()
	var res: Dictionary = await Api.post_json("/api/media/hap-encode/probe", {"ids": ids})
	if not is_inside_tree() or not res.ok or not (res.data is Dictionary) or not (res.data.get("items") is Array):
		return
	_probe = res.data.items
	_on_air = res.data.get("onAir", false) == true
	_refresh()


func _muted(text: String, tip := "") -> Label:
	var l := Label.new()
	l.text = text
	l.tooltip_text = tip
	l.clip_text = true
	l.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	return l


func _refresh() -> void:
	_format.text = "Format: %s" % Hap.format_for(_alpha.button_pressed, _hq.button_pressed).label
	for c in _warnings.get_children():
		_warnings.remove_child(c)  # out now, or the re-fit below still counts the old lines
		c.queue_free()
	for w in Hap.modal_warnings(_alpha.button_pressed, _hq.button_pressed, _on_air, _probe):
		var l := Label.new()
		l.text = w
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.custom_minimum_size = Vector2(WIDTH, 0)
		l.add_theme_color_override("font_color", WARN)
		_warnings.add_child(l)
	if _probe is Array and not (_probe as Array).any(func(p: Variant) -> bool: return p is Dictionary and p.get("ok", false) == true):
		get_ok_button().disabled = true
	if visible:
		_refit.call_deferred()


func _refit() -> void:  # removed warnings leave the window tall until it is re-fitted to its content
	reset_size()
	move_to_center()
