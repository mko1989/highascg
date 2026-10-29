extends VBoxContainer
## WO-600 O — PGM top-layer timer for one main (client/components/playback-timer.js
## mountPgmTopLayerPlaybackTimer): "<clip> · 0:37 / 1:00  (−0:23)", progress bar, traffic-light tier;
## idle = what is on the top layer, no bar.

const P := preload("res://features/live/pgm_timer_model.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")

var main := 0
var mirror: Node
var _row: Label    # clip / idle label (clipped)
var _time: Label   # 0:37 / 1:00  (−0:23) — never clipped
var _bar: ColorRect
var _fill: ColorRect


func setup(osc_mirror: Node, main_idx: int) -> void:
	mirror = osc_mirror
	main = main_idx
	if mirror != null:
		mirror.updated.connect(refresh)


func _ready() -> void:
	add_theme_constant_override("separation", 3)
	var line := HBoxContainer.new()
	add_child(line)
	_row = Label.new()
	_row.clip_text = true
	_row.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_row.add_theme_font_size_override("font_size", 13)
	line.add_child(_row)
	_time = Label.new()
	_time.add_theme_font_size_override("font_size", 13)
	line.add_child(_time)
	_bar = ColorRect.new()
	_bar.custom_minimum_size.y = 3
	add_child(_bar)
	_fill = ColorRect.new()
	_bar.add_child(_fill)
	refresh()


func refresh() -> void:
	if _row == null or not is_visible_in_tree():
		return
	var cm: Dictionary = Store.get_value("channelMap", {}) if Store.get_value("channelMap") is Dictionary else {}
	var pgm := P.resolve_pgm(cm, Store.get_value("scene"), main)
	var ch: Variant = mirror.channels.get(str(pgm.channel)) if mirror != null else null
	var now := Time.get_unix_time_from_system() * 1000.0
	var top := P.pick_top_layer(ch, pgm.bank, now, true)
	if top.layer == null:
		var idle := P.pick_top_layer(ch, pgm.bank, now, false)
		var label := P.idle_label(idle.state) if idle.layer != null else ""
		_row.text = label
		_time.text = ""
		_row.tooltip_text = ("%s — on the top layer, not running" % label) if label != "" else "Nothing on any layer of this channel"
		_row.add_theme_color_override("font_color", P.COLORS.muted.text)
		_bar.visible = false
		return
	var f: Dictionary = top.state.get("file", {}) if (top.state as Dictionary).get("file") is Dictionary else {}
	var el := _f(f.get("elapsed"))
	var dur := _f(f.get("duration"))
	if not is_nan(_f(f.get("outPoint"))):
		dur = _f(f.get("outPoint")) # WO-813: a trimmed take ends at its out point (server osc-state-timing applyClipWindow)
	var rem := _f(f.get("remaining"))
	var pct := 0.0
	if not is_nan(_f(f.get("progress"))):
		pct = clampf(_f(f.get("progress")), 0.0, 1.0)
	elif not is_nan(dur) and dur > 0.0 and not is_nan(el):
		pct = clampf(el / dur, 0.0, 1.0)
	var label := P.file_label(f)
	var txt := "%s / %s" % [P.format_mmss(el), P.format_mmss(dur)]
	if not is_nan(rem):
		txt += "  (−%s)" % P.format_mmss(rem)
	var tier := P.tier(rem if not is_nan(rem) else null)
	var c: Dictionary = P.COLORS[tier]
	_row.text = label
	_time.text = txt
	_time.add_theme_color_override("font_color", c.text)
	_row.tooltip_text = "PGM ch %d layer %d: %s — elapsed / duration" % [pgm.channel, top.layer, label]
	_row.add_theme_color_override("font_color", c.text)
	_bar.visible = true
	_bar.color = c.bar
	_fill.color = c.fill
	_fill.size = Vector2(_bar.size.x * pct, 3)


static func _f(v: Variant) -> float:
	return float(v) if (v is float or v is int) else NAN
