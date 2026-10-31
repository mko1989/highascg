extends HBoxContainer
## WO-603 — the project media bar above the Media tree (web sources-panel-project-gather.js): the open project's media
## folder, a "project only" filter and "Gather (N)" — move every clip the project references into that folder. The
## server plans and moves (GET /api/media/project, POST /api/media/gather; references follow through WO-592 links,
## project_sync re-imports the project); this bar only shows the plan and asks before moving.

signal filter_toggled
signal gathered(text: String)

const ThemeBuilder := preload("res://app/theme_builder.gd")
const Ops := preload("res://features/live/media_ops.gd")
const UiFit := preload("res://core/ui_fit.gd")  # WO-899: shrink the font, then trim, instead of pinning the column wide

var folder := ""
var pending: Array = []
var _path: Label
var _only: CheckBox
var _gather: Button
var _again: Timer
var _full := {}  # control → [full text, its own tooltip] (the fit may show a trimmed text)
var fit_plan := {}  # the plan applied last (tests, probes)


func _ready() -> void:
	visible = false
	_path = Label.new()
	_path.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_path.clip_text = true
	_path.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS  # WO-899: "mhp_hard" lost its tail without a sign
	_path.add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	add_child(_path)
	_only = CheckBox.new()
	_only.text = "project only"
	_only.tooltip_text = "Show only clips in this project folder"
	_only.toggled.connect(func(_on: bool) -> void: filter_toggled.emit())
	add_child(_only)
	_only.clip_text = true  # WO-899: the minimum is the chrome; _fit() sets the width of the text it chose
	_only.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_gather = Button.new()
	_gather.visible = false
	_gather.pressed.connect(confirm_gather)
	add_child(_gather)
	_gather.clip_text = true
	_gather.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_again = Timer.new()  # project edits come in bursts — one re-plan after they settle (web: 400 ms)
	_again.one_shot = true
	_again.wait_time = 0.4
	_again.timeout.connect(refresh)
	add_child(_again)
	Store.project_changed.connect(func(_p: Dictionary) -> void: _again.start())
	resized.connect(fit)
	fit()


## True while the filter is on and there is a project folder to filter by.
func project_only() -> bool:
	return visible and _only.button_pressed and folder != ""


func refresh() -> void:
	var res: Dictionary = await Api.get_json("/api/media/project")
	var d: Dictionary = res.data if res.ok and res.data is Dictionary else {}
	var was_only := project_only()
	folder = str(d.get("folder", ""))
	pending = d.get("pending", []) if d.get("pending") is Array else []
	visible = d.get("enabled", false) == true and str(d.get("slug", "")) != "" and folder != ""
	_path.text = folder.get_file() + "/"  # the column is narrow — the project's own folder name, full path on hover
	_path.tooltip_text = "Project media folder: %s/ — Gather moves clips here" % folder
	_gather.visible = visible and not pending.is_empty()
	_gather.text = "Gather (%d)" % pending.size()
	_gather.tooltip_text = "%d referenced clip(s) live outside the project folder — move them in" % pending.size()
	_full.erase(_gather)  # a new text: the fit re-learns it
	fit()
	if was_only != project_only():
		filter_toggled.emit()


func confirm_gather() -> void:
	if pending.is_empty():
		return
	var dlg := ConfirmationDialog.new()
	dlg.title = "Gather project media?"
	dlg.ok_button_text = "Move"
	var names := PackedStringArray()
	for id in pending.slice(0, 8):
		names.append("  " + str(id))
	if pending.size() > 8:
		names.append("  … and %d more" % (pending.size() - 8))
	dlg.dialog_text = "Move %s into %s/?\n\n%s\n\nLooks, playlists and timelines follow the move." % [Ops.plural(pending.size()), folder, "\n".join(names)]
	dlg.confirmed.connect(func() -> void:
		dlg.queue_free()
		_gather.disabled = true
		gathered.emit("Gathering %s…" % Ops.plural(pending.size()))
		var res: Dictionary = await Api.post_json("/api/media/gather", {})
		_gather.disabled = false
		gathered.emit(Ops.gather_text(res))
		refresh())
	dlg.canceled.connect(dlg.queue_free)
	add_child(dlg)
	dlg.popup_centered()


## WO-899: the "project only" check box and the Gather button always fit the column — the font shrinks (ui_fit.gd), then
## the labels are trimmed (widest first, full text kept in the tooltip). The project folder name takes what is left.
func fit() -> void:
	if _only == null or size.x < 8.0:
		return
	var ctl: Array = [_only]
	if _gather.visible:
		ctl.append(_gather)
	var texts: Array = []
	var overhead := 0.0
	var ov: Array = []
	for c in ctl:
		if not _full.has(c) or str(c.text) != str(_full[c][2]):
			_full[c] = [c.text, c.tooltip_text, c.text]  # [full text, own tooltip, text shown]
		texts.append(_full[c][0])
		c.remove_theme_font_size_override("font_size")
	var font: Font = _only.get_theme_font("font")
	for c in ctl:  # the chrome beside the text (icon, margins): the unclipped minimum less the text itself
		c.clip_text = false  # a clipped / trimmed button reports no text width at all
		c.text_overrun_behavior = TextServer.OVERRUN_NO_TRIMMING
		ov.append(c.get_minimum_size().x - font.get_string_size(c.text, HORIZONTAL_ALIGNMENT_LEFT, -1, c.get_theme_font_size("font_size")).x)
		overhead += ov[-1]
		c.clip_text = true
		c.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	var seps := float(get_theme_constant("separation")) * ctl.size()  # path label + the controls
	var measure := func(t: String, sz: int) -> float:
		return font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, sz).x
	var plan := UiFit.plan(texts, size.x - 24.0, measure, overhead + seps)  # 24 px: the path label keeps a few letters
	fit_plan = plan
	for i in ctl.size():
		var c: Control = ctl[i]
		c.text = plan.titles[i]
		_full[c][2] = c.text
		c.tooltip_text = _full[c][1] if c.text == _full[c][0] else "%s — %s" % [_full[c][0], _full[c][1]]
		if plan.size != UiFit.NATURAL_SIZE:
			c.add_theme_font_size_override("font_size", plan.size)
		c.custom_minimum_size.x = ceilf(measure.call(c.text, plan.size) + ov[i])
