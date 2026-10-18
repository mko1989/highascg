extends HBoxContainer
## WO-600 I — transition picker (client/components/scenes-shared.js mountLookTransitionControls):
## type · duration (frames) · easing. `pgm_only` limits types and normalises like the web.

signal changed(t: Dictionary)

const T := preload("res://features/live/transitions.gd")

var pgm_only := false
var _type: OptionButton
var _dur: SpinBox
var _tween: OptionButton
var _types: Array = []


func setup(t: Variant, only_pgm: bool) -> void:
	pgm_only = only_pgm
	_types = T.PGM_ONLY_TYPES if pgm_only else T.TYPES
	if _type == null:
		_build()
	_type.clear()
	for ty in _types:
		_type.add_item(T.LABELS.get(ty, ty))
	var d: Dictionary = T.normalize_for_pgm_only(t) if pgm_only else (t if t is Dictionary else {})
	var ty_norm := T.migrate_type(d.get("type"))
	_type.select(maxi(0, _types.find(ty_norm if _types.has(ty_norm) else "CUT")))
	_dur.set_value_no_signal(maxi(0, T._js_round(T._num_or_zero(d.get("duration")))))
	var tw := str(d.get("tween", "linear")).to_lower().replace("-", "_")
	if tw == "ease_in_out" or tw == "easeinout":
		tw = "easeboth"
	_tween.select(maxi(0, T.TWEENS.find(tw)))


func _build() -> void:
	_type = OptionButton.new()
	_type.tooltip_text = "Transition type"
	_type.item_selected.connect(func(_i: int) -> void: _save())
	add_child(_type)
	_dur = SpinBox.new()
	_dur.min_value = 0
	_dur.max_value = 600
	_dur.step = 1
	_dur.suffix = "fr"
	_dur.tooltip_text = "Duration in frames (12 = auto: half the project fps)"
	_dur.value_changed.connect(func(_v: float) -> void: _save())
	add_child(_dur)
	_tween = OptionButton.new()
	_tween.tooltip_text = "Easing"
	for tw in T.TWEENS:
		_tween.add_item(tw)
	_tween.item_selected.connect(func(_i: int) -> void: _save())
	add_child(_tween)


func _save() -> void:
	var raw := {"type": _types[_type.selected], "duration": int(_dur.value), "tween": T.TWEENS[_tween.selected]}
	var next := T.normalize_for_pgm_only(raw) if pgm_only else {"type": T.migrate_type(raw.type), "duration": raw.duration, "tween": raw.tween}
	if pgm_only and _types[_type.selected] != next.type:
		setup(next, true)
	changed.emit(next)
