extends HBoxContainer
## WO-976 — the "Audio-reactive source" picker on the Visuals page: none, each input slot, each screen destination's PGM/PRV
## (GET /api/audio/fft-source). A pick posts live-inputs/config {audio_fft_source} + apply, so the box adds/removes the
## Caspar STREAM consumer itself.

const IS := preload("res://features/devices/input_slots_model.gd")

var _sel: OptionButton
var _busy := false


func _init() -> void:
	var l := Label.new()
	l.text = "Source"
	l.custom_minimum_size.x = 70
	add_child(l)
	_sel = OptionButton.new()
	_sel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_sel.fit_to_longest_item = false
	_sel.clip_text = true
	_sel.tooltip_text = "What drives the audio-reactive visuals: an input slot, or a screen's program/preview mix (a Caspar channel)"
	_sel.item_selected.connect(_picked)
	add_child(_sel)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			refresh())


func _api() -> Variant:
	var dt := (Engine.get_main_loop() as SceneTree).root.get_node_or_null("DevicesTarget")
	return dt.box_api if dt != null else null


## Reload options + current choice from the box.
func refresh() -> void:
	var api: Variant = _api()
	if api == null or _busy:
		return
	var r: Dictionary = await api.get_json("/api/audio/fft-source")
	if not r.get("ok") or not is_instance_valid(_sel):
		return
	var cur := str(r.data.get("source", "none")) if r.data is Dictionary else "none"
	_sel.clear()
	var opts := IS.fft_source_options(r.data)
	for i in opts.size():
		_sel.add_item(str(opts[i][1]), i)
		_sel.set_item_metadata(i, opts[i][0])
		if str(opts[i][0]) == cur:
			_sel.select(i)


func _picked(i: int) -> void:
	var api: Variant = _api()
	if api == null or _busy:
		return
	_busy = true
	_sel.disabled = true
	for req in IS.fft_source_requests(str(_sel.get_item_metadata(i))):
		await api.post_json(req[1], req[2])
	_sel.disabled = false
	_busy = false
	refresh()
