extends RefCounted
## WO-1070 — pad banks and the library fill: a picture's DOMINANT colour (not the mean of two), the names of the hues,
## the library rows → banks of 40 in hue order (greys, then no-thumbnail rows last; top row first), ▲ / ▼ paging the
## pads (the pressed pad loads the shown bank's visual, the lights follow), a new empty bank past the last one (gone when
## left empty), the fill keeping the operator's own banks and replacing an earlier fill, the old [midi] clips read as bank 1.

const Tab := preload("res://features/visuals/visuals_tab.gd")
const M := preload("res://features/visuals/visuals_model.gd")
const L := preload("res://features/visuals/visuals_layers.gd")
const Leds := preload("res://features/midi/midi_leds.gd")
const Palette := preload("res://features/midi/apc40_palette.gd")
const Lib := preload("res://features/visuals/visuals_midi_library.gd")
const T := preload("res://tests/test_midi_pickup.gd")
var t


func _tab() -> Control:
	var tab: Control = Tab.new()
	tab._ready()
	M.with_layers(tab.slice, [L.layer_of({"scene": "tunnel", "opacity": 0.6})])
	tab.page.set_state(tab.slice, {})
	return tab


static func _row(name: String, thumb := "x") -> Dictionary:
	return {"name": name, "thumb": thumb, "payload": {"type": "visual", "label": name, "scene": "shader", "shader": "sh-" + name}}


func test_dominant_colour() -> void:
	var img := Image.create(64, 36, false, Image.FORMAT_RGB8)
	img.fill_rect(Rect2i(0, 0, 40, 36), Color(1, 0, 0))
	img.fill_rect(Rect2i(40, 0, 24, 36), Color(0, 0, 1))
	var c := Palette.main_color(img)
	t.ok(c.h < 0.03 or c.h > 0.97, "red and blue: the larger red wins, not their magenta mean (h %.2f)" % c.h)
	t.eq([Palette.hue_name(Color(1, 0, 0)), Palette.hue_name(Color(1, 0.5, 0)), Palette.hue_name(Color(0, 1, 0)), Palette.hue_name(Color(0, 0.3, 1)),
		Palette.hue_name(Color(1, 0, 0.1)), Palette.hue_name(Color(0.5, 0.5, 0.5))], ["Red", "Orange", "Green", "Blue", "Red", "White"], "hue names")


func test_library_banks_by_hue() -> void:
	var cols := {"blue": Color(0, 0.2, 1), "green": Color(0, 1, 0), "red": Color(1, 0, 0), "grey": Color(0.5, 0.5, 0.5), "redish": Color(1, 0, 0.1)}
	var rows := [_row("blue"), _row("grey"), _row("game", ""), _row("green"), _row("red"), _row("redish")]
	var bs := Lib.banks(rows, func(r: Dictionary) -> Variant: return cols.get(r.name))
	t.eq(bs.size(), 1, "six rows: one bank")
	t.eq([32, 33, 34, 35, 36, 37].map(func(n: int) -> String: return str(bs[0].clips[str(n)].payload.label)),
		["redish", "red", "green", "blue", "grey", "game"], "top row left to right: hue order (a pinkish red with the reds), grey, no thumbnail")
	t.eq([bs[0].name, bs[0].auto, bs[0].clips["36"].color], ["Red – No thumbnail", true, "#ffffff"], "named by its colours; a grey pad is white")
	t.eq([Lib.note_of(0), Lib.note_of(7), Lib.note_of(8), Lib.note_of(39)], [32, 39, 24, 7], "pad order: top row first")
	var many := []
	for i in 95:
		many.append(_row("v%03d" % i))
	bs = Lib.banks(many, func(r: Dictionary) -> Variant: return Color.from_hsv(float(int(str(r.name).substr(1))) / 100.0, 1.0, 1.0))
	t.eq(bs.map(func(b: Dictionary) -> int: return b.clips.size()), [40, 40, 15], "95 rows: 40 + 40 + 15")
	t.eq(str(bs[1].clips["32"].payload.label), "v040", "the second bank goes on where the first stopped")


func test_paging_the_pads() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	t.eq([T.MM.find(midi.map, {"kind": "note", "ch": 0, "num": 94}).target, T.MM.find(midi.map, {"kind": "note", "ch": 0, "num": 95}).target],
		["padbank:prev", "padbank:next"], "▲ / ▼ page the pads (the APC map)")
	t.eq([midi.control_of("padbank:prev"), midi.control_of("padbank:next")], [null, null], "one empty bank: nowhere to go")
	midi.clips.drop(32, {"type": "visual", "scene": "rings", "label": "Rings", "color": "#ff0000"})
	midi.handle(T.note(0, 95, 127))
	t.eq([midi.clips.bank, midi.clips.banks.size(), midi.clips.has(32)], [1, 2, false], "▼ past the last bank: a new empty one")
	t.eq(midi.control_of("clip:32"), null, "its pads hold nothing")
	midi.handle(T.note(0, 95, 127))
	t.eq(midi.clips.bank, 1, "no further down from an empty bank")
	midi.clips.drop(32, {"type": "visual", "scene": "starfield", "label": "Starfield", "color": "#00ff00"})
	t.eq(Leds.frame(midi.map, midi.led_state, midi.clips.velocity)["144:32"], 21, "bank 2: the pad is green")
	tab.sel = 0
	midi.handle(T.note(0, 32, 127))
	t.eq(tab.slice.layers[0].scene, "starfield", "the pad loads bank 2's visual")
	midi.handle(T.note(0, 94, 127))
	t.eq([midi.clips.bank, midi.clips.banks.size()], [0, 2], "▲: bank 1 again, bank 2 kept")
	t.eq(Leds.frame(midi.map, midi.led_state, midi.clips.velocity)["144:32"], 5, "the same pad is red again")
	midi.handle(T.note(0, 32, 127))
	t.eq(tab.slice.layers[0].scene, "rings", "and loads bank 1's visual")
	t.eq(midi.apc_view.label("padbank:next"), "▼ 1/2", "the drawing shows the bank")
	midi.clips.page(1)
	midi.clips.page(1)
	midi.clips.page(-1)
	t.eq([midi.clips.bank, midi.clips.banks.size()], [1, 2], "an empty bank at the end, left empty, is gone")


func test_fill_keeps_own_banks() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	midi.clips.drop(0, {"type": "visual", "scene": "rings", "label": "Rings"})
	var auto := Lib.banks([_row("a"), _row("b")], func(_r: Dictionary) -> Variant: return Color(0, 0, 1))
	midi.clips.set_auto_banks(auto)
	t.eq([midi.clips.banks.size(), midi.clips.bank, midi.clips.label(32), midi.clips.banks[1].name], [2, 1, "a", "Blue"], "own bank first, the pads on the library bank")
	t.eq(T.MM.find(midi.map, {"kind": "note", "ch": 0, "num": 33}).target, "clip:33", "a library pad that recalled a look is the bank's now")
	midi.clips.set_auto_banks(Lib.banks([_row("c")], func(_r: Dictionary) -> Variant: return Color(1, 0, 0)))
	t.eq([midi.clips.banks.size(), midi.clips.label(32), midi.clips.banks[0].clips.has("0")], [2, "c", true], "a second fill replaces the first; the own bank stays")


func test_old_clips_are_bank_one() -> void:
	var tab := _tab()
	var midi: Node = tab.midi
	var c := ConfigFile.new()
	c.set_value("midi", "clips", {"5": {"payload": {"type": "visual", "scene": "rings", "label": "Rings"}, "color": "#ff0000"}})
	midi.clips.load_from(c)
	t.eq([midi.clips.banks.size(), midi.clips.bank, midi.clips.label(5)], [1, 0, "Rings"], "the pads from before the banks")
	c.set_value("midi", "clip_banks", [{"name": "", "auto": false, "clips": {}}, {"name": "Blue", "auto": true, "clips": c.get_value("midi", "clips")}])
	c.set_value("midi", "clip_bank", 1)
	midi.clips.load_from(c)
	t.eq([midi.clips.banks.size(), midi.clips.bank, midi.clips.label(5), midi.clips.banks[1].auto], [2, 1, "Rings", true], "stored banks and the shown one come back")
