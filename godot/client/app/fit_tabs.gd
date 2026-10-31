extends RefCounted
## WO-899 (owner 31.10) — keeps every tab of a TabContainer visible in its width: the tab font shrinks (and the tab
## padding with it), and below the readability floor the titles are trimmed with "…" (core/ui_fit.gd has the order and
## the numbers). The full title goes to the tab's tooltip. No ‹ › scroll arrows appear while the plan fits.
##
##   var fit := FitTabs.attach(tab_container)   # refits on every resize / tab added / removed / hidden-by-refit()
##   fit.refit()                                 # after set_tab_hidden (nothing signals that)
##
## The titles are re-learned on every refit: whoever calls set_tab_title(i, "New name") renames the tab — a title that is
## not the one this fitter wrote last is the new full title.

const UiFit := preload("res://core/ui_fit.gd")
const STYLES := ["tab_selected", "tab_unselected", "tab_hovered", "tab_disabled"]

var tc: TabContainer
var bar: TabBar
var last := {}  # the plan applied last: {size, pad, titles, trimmed}  (tests, probes)
var _full := {}  # tab control → full title
var _applied := {}  # tab control → the title this fitter wrote
var _sig := ""
var _busy := false
var _queued := false


static func attach(container: TabContainer) -> RefCounted:
	var f := new()
	f.tc = container
	f.bar = container.get_tab_bar()
	container.clip_tabs = true  # never grow the column: the fit decides what shows
	f.bar.resized.connect(f.refit)
	container.child_order_changed.connect(f.refit_soon)
	f.refit_soon()
	return f


func refit_soon() -> void:
	if _queued or tc == null or not tc.is_inside_tree():
		return
	_queued = true
	(func() -> void:
		_queued = false
		refit()).call_deferred()


func refit() -> void:
	if _busy or tc == null or bar == null or bar.size.x < 8.0:
		return
	_busy = true
	var idx: Array = []  # the tabs that show
	for i in tc.get_tab_count():
		var c := tc.get_tab_control(i)
		var cur := tc.get_tab_title(i)
		if _applied.get(c, null) != cur or not _full.has(c):
			_full[c] = cur
		if not tc.is_tab_hidden(i):
			idx.append(i)
	var titles: Array = []
	for i in idx:
		titles.append(_full[tc.get_tab_control(i)])
	var sig := "%d|%s" % [roundi(bar.size.x), "\u0001".join(PackedStringArray(titles))]
	if sig != _sig:
		_sig = sig
		_apply(idx, titles)
	_busy = false


func _apply(idx: Array, titles: Array) -> void:
	_clear_overrides()  # natural font and stylebox: what the theme gives
	var font := bar.get_theme_font("font")
	var natural := bar.get_theme_font_size("font_size")
	var natural_pad := _natural_pad()
	var measure := func(text: String, size: int) -> float:
		return font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	# the theme's own paddings count for the natural step; the shrunk steps use pad_for(size) each side
	var plan := UiFit.plan(titles, bar.size.x, measure, func(size: int) -> float:
		return titles.size() * 2.0 * (natural_pad if size == natural else float(UiFit.pad_for(size))))
	if plan.size != natural:
		bar.add_theme_font_size_override("font_size", plan.size)
		_pad(UiFit.pad_for(plan.size))
	var pad := natural_pad if plan.size == natural else float(UiFit.pad_for(plan.size))
	_write(idx, plan.titles, titles)
	last = {"size": plan.size, "pad": pad, "titles": plan.titles.duplicate(), "trimmed": plan.trimmed, "fits": plan.fits}


func _write(idx: Array, shown: Array, full: Array) -> void:
	for k in idx.size():
		var i: int = idx[k]
		var c := tc.get_tab_control(i)
		_applied[c] = shown[k]
		tc.set_tab_title(i, shown[k])
		tc.set_tab_tooltip(i, full[k] if shown[k] != full[k] else "")


func _natural_pad() -> float:
	var w := 0.0
	for s in STYLES:
		var sb := bar.get_theme_stylebox(s)
		if sb != null:
			w = maxf(w, sb.content_margin_left)
	return w if w > 0.0 else float(UiFit.MAX_PAD)


func _clear_overrides() -> void:
	bar.remove_theme_font_size_override("font_size")
	for s in STYLES:
		bar.remove_theme_stylebox_override(s)


## Same styles, tighter side margins (the theme's tab_box has 16 each side).
func _pad(px: int) -> void:
	for s in STYLES:
		var sb := bar.get_theme_stylebox(s)
		if sb is StyleBoxFlat:
			var d := (sb as StyleBoxFlat).duplicate() as StyleBoxFlat
			d.content_margin_left = px
			d.content_margin_right = px
			bar.add_theme_stylebox_override(s, d)
