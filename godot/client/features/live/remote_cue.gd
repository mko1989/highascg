extends Label
## WO-1029 plan 07 (C15) — the quiet "on <box>" cue of a screen that is output by ANOTHER linked server: in the Live
## deck column (instead of the PGM timer), and its text for the compose tiles. The picture relay is a later step, so
## this is a labelled placeholder plus whatever the owner reports in scene.remoteLive (look on PGM / PRV, extrapolated
## playback time, test card / FTB). Older server without remoteLive: just "on <box>". unknown is shown as unknown ("?"),
## never as "nothing on air" (remote_air_model.gd).

const ThemeBuilder := preload("res://app/theme_builder.gd")
const SC := preload("res://core/screen_channels.gd")
const RA := preload("res://features/live/remote_air_model.gd")

var main := 0
var _seen_ms := 0.0


## null when `main` is on this server.
static func build(main_idx: int) -> Label:
	if SC.is_here(Store.get_value("channelMap", {}), main_idx):
		return null
	var l := (load("res://features/live/remote_cue.gd") as GDScript).new() as Label
	l.main = main_idx
	return l


## Lines for a screen on another server: ["on highascg5867", "PGM Bumper · PRV —", "0:42"] ([] when it is here).
static func lines(cm: Variant, cluster: Variant, scene: Variant, idx: int, waited_ms := 0.0) -> Array:
	var e := RA.entry(scene, idx)
	var cue := SC.cue(cm, idx, cluster, RA.server_name(e))
	if cue == "":
		return []
	var out := [cue]
	var s := RA.summary(e)
	if s != "":
		out.append(s)
	elif not (scene is Dictionary and (scene as Dictionary).has("remoteLive")):
		pass  # older server: nothing but the cue
	else:
		var who := RA.server_name(e)
		out.append("unknown on " + (who if who != "" else cue.trim_prefix("on ")))  # never the last thing seen
	for bus in ["pgm", "prv"]:
		var c := RA.clip_of(e, bus, waited_ms)
		if not c.is_empty():
			out.append("%s clip %s %d:%02d" % [bus.to_upper(), c.name, int(c.pos_s / 60.0), int(c.pos_s) % 60])
	var ms := RA.timer_ms(e, waited_ms)
	if ms >= 0.0:
		out.append("%d:%02d" % [int(ms / 60000.0), int(ms / 1000.0) % 60])
	return out


func _ready() -> void:
	add_theme_font_size_override("font_size", 12)
	add_theme_color_override("font_color", ThemeBuilder.TEXT_MUTED)
	autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	custom_minimum_size.y = 36
	_seen_ms = Time.get_ticks_msec()
	Store.changed.connect(_on_changed)
	var tm := Timer.new()  # the playback time is extrapolated, so it needs a tick
	tm.wait_time = 1.0
	tm.autostart = true
	tm.timeout.connect(_refresh)
	add_child(tm)
	_refresh()


func _on_changed(path: String, _v: Variant) -> void:
	if path == "scene.remoteLive":
		_seen_ms = Time.get_ticks_msec()
	if path in ["channelMap", "cluster", "scene.remoteLive", "*", ""]:
		_refresh()


func _refresh() -> void:
	var l := lines(Store.get_value("channelMap", {}), Store.cluster, Store.get_value("scene", {}), main, Time.get_ticks_msec() - _seen_ms)
	text = "   ·   ".join(PackedStringArray(l))
	tooltip_text = "This screen is output by another linked server — drive it from there (a picture of it is not relayed yet)."
