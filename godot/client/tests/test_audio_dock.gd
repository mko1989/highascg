extends RefCounted
## WO-806 Program audio dock — the group model, the vertical input columns (owner 29.10), the WO-227 dense rule on
## the compact surface (an 8-channel master fits the 400 px Inspector column; 2–4 channels unchanged), the widths
## measured on the real controls, and the one write path shared with the Audio tab.

const DM := preload("res://features/audio/audio_dock_model.gd")
const Row := preload("res://features/audio/audio_dock_row.gd")
const Master := preload("res://features/audio/audio_dock_master.gd")
const Ctl := preload("res://features/audio/audio_console_ctl.gd")
const AR := preload("res://features/audio/audio_rows.gd")
const FaderCap := preload("res://features/audio/fader_cap.gd")
var t

const ROWS := [
	{"key": "input:5", "ch": 5, "layer": 1, "label": "DeckLink 1", "isLiveInput": true, "inputKind": "decklink", "slot": 1, "v": 1.0},
	{"key": "pgm:1", "ch": 1, "label": "PGM 1 Master", "isMaster": true, "v": 1.0},
	{"key": "prv:2", "ch": 2, "label": "PRV 1 Master", "isMaster": true, "isPreview": true, "v": 1.0},
	{"key": "pgm:1:layer:10", "ch": 1, "layer": 10, "label": "L10 · clip", "sceneId": "s1", "v": 0.5, "muted": true},
	{"key": "pgm:1:layer:200", "ch": 1, "layer": 200, "label": "🔊 Bed", "sceneId": null, "isAudioOnlyLook": true, "v": 1.0},
	{"key": "pgm:3", "ch": 3, "label": "PGM 2 Master", "isMaster": true, "v": 1.0},
]


func test_groups_and_masters() -> void:
	var g := DM.groups(ROWS, [1, 3])
	t.eq(g.size(), 2, "live inputs + PGM 1 (PGM 2 has no layers)")
	t.eq(g[0].title, "Live inputs", "live inputs first")
	t.eq(g[1].title, "PGM 1 (ch 1)", "then per program channel")
	t.eq((g[1].rows as Array).map(func(r: Dictionary) -> String: return r.key), ["pgm:1:layer:10", "pgm:1:layer:200"], "layers of ch 1")
	t.eq(DM.masters(ROWS).map(func(r: Dictionary) -> String: return r.key), ["pgm:1", "prv:2", "pgm:3"], "masters in order")
	t.eq(DM.master_label(ROWS[1]), "PGM 1", "short master label")
	var many: Array = []
	for i in 5:
		many.append({"key": "pgm:1:layer:%d" % (10 + i), "ch": 1, "layer": 10 + i, "label": "L", "sceneId": "s"})
	t.ok(DM.groups(many, [1])[0].dense, "> 4 rows → dense group")
	t.ok(not DM.groups(many.slice(0, 4), [1])[0].dense, "4 rows → normal")


func test_dense_rule_only_past_four_channels() -> void:
	for bars in [1, 2, 4]:
		t.ok(not DM.dense_master(bars), "%d bus channels: not dense" % bars)
		t.eq(DM.meter_width(bars), maxi(10, 9 * bars), "%d bus channels: meter_bank.gd's own width" % bars)
	t.ok(DM.dense_master(8), "8 bus channels: dense")
	t.eq(DM.meter_width(8), 48, "8 × 6 px")
	t.ok(DM.meter_width(8) < 9 * 8, "dense is narrower than the console bank")


func test_routing_kind() -> void:
	t.eq(DM.routing(ROWS[0], [1]), "routes", "a DeckLink input routes even with one screen")
	t.eq(DM.routing(ROWS[3], [1]), "", "one screen: no Screens buttons")
	t.eq(DM.routing(ROWS[3], [1, 3]), "screens", "a look layer with two screens")
	t.eq(DM.routing(ROWS[4], [1, 3]), "", "audio-only look: no cross-screen")
	t.ok(DM.routes_inline([1, 2, 3, 4]) and not DM.routes_inline([1, 2, 3, 4, 5]), "inline up to 4 toggles")


func test_eight_channel_masters_fit_the_column() -> void:
	var m8 := Master.new()
	m8.setup(ROWS[1], 8)
	var w8 := m8.get_combined_minimum_size().x
	t.ok(w8 <= 90.0, "8-channel master column ≤ 90 px (got %s)" % w8)
	t.ok(4 * w8 + 3 * 6 <= DM.COLUMN_W, "2 screens × PGM / PRV at 8 ch fit 400 px on one line (got %s)" % (4 * w8 + 18))
	var m2 := Master.new()
	m2.setup(ROWS[1], 2)
	t.eq(m2.meter.custom_minimum_size.x, 18.0, "stereo master keeps 9 px bars")
	t.eq(m8.meter.levels.size(), 8, "one bar per bus channel")
	m8.free()
	m2.free()


## Owner 29.10: inputs are vertical faders like the masters. Each input is a narrow column (VSlider with the console's
## fader cap, ~110 px tall, no horizontal fader left) and eight of them fit one line of the 400 px Inspector column.
func test_input_columns_are_vertical_and_fit() -> void:
	for progs in [[1], [1, 3], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7, 8]]:
		for r in [ROWS[0], ROWS[3], ROWS[4]]:
			for dense in [false, true]:
				var col := Row.new()
				col.setup(r, dense, progs)
				var what := "%s, %d screens, dense %s" % [r.key, progs.size(), dense]
				t.ok(col.fader is VSlider, "%s: vertical fader" % what)
				t.ok(col.find_children("*", "HSlider", true, false).is_empty(), "%s: no horizontal fader left" % what)
				t.eq(col.fader.get_theme_icon("grabber"), FaderCap.grabber(), "%s: the console's fader cap" % what)
				t.eq(col.fader.custom_minimum_size.x, float(FaderCap.WIDTH), "%s: fader as wide as the cap" % what)
				t.eq((col.fader.get_parent() as Control).custom_minimum_size.y, float(Row.FADER_H), "%s: fader body height" % what)
				t.ok(Row.FADER_H >= 100 and Row.FADER_H <= 120, "fader ~110 px tall")
				var w := col.get_combined_minimum_size().x
				t.ok(w <= 44.0, "%s: column ≤ 44 px (got %s)" % [what, w])
				t.ok(8 * w + 7 * 3 <= DM.COLUMN_W - 16 - 12, "%s: eight columns fit one line beside the scroll bar (got %s)" % [what, 8 * w + 21])
				col.free()


func test_row_state() -> void:
	var row := Row.new()
	row.setup(ROWS[3], false, [1, 3])
	t.ok(row.muted(), "muted from the row")
	t.eq(row.gain(), 0.5, "the stored gain while the fader shows it")
	row.set_gain(1.0)
	t.ok(absf(row.gain() - 1.0) < 0.05, "a moved fader reads back from its position (got %s)" % row.gain())
	row.set_screens([{"channel": 3, "ok": true}], [3])
	var b3: Button = row._toggles[3]
	var b1: Button = row._toggles[1]
	t.ok(b3.button_pressed and not b3.disabled, "target lit and usable")
	t.ok(b1.button_pressed and b1.disabled, "host lit and fixed")
	row.free()
	var live := Row.new()
	live.setup(ROWS[0], false, [1, 3])
	t.ok(live._solo == null, "no SOLO on a live input (as the console)")
	live.set_routing({"targets": [3]})
	t.ok((live._toggles[3] as Button).button_pressed and not (live._toggles[1] as Button).button_pressed, "Ch routes from the server entry")
	live.free()


func test_one_write_path_with_the_audio_tab() -> void:
	var ctl := Ctl.new()
	var row := Row.new()
	row.setup(ROWS[3], false, [1, 3])
	ctl.bind(row, ROWS[3])
	t.ok(ctl.strips.get("pgm:1:layer:10") == row, "the controller holds the row")
	for sig in ["gain_changed", "mute_pressed", "solo_pressed", "screen_toggled", "route_toggled", "stop_pressed"]:
		t.eq(row.get_signal_connection_list(sig).size(), 1, "%s → the controller" % sig)
	t.eq(ctl.metas["pgm:1:layer:10"], AR.meter_meta(ROWS[3]), "meter meta registered")
	var m := Master.new()
	m.setup(ROWS[1], 2)
	ctl.bind(m, ROWS[1])
	t.eq(m.get_signal_connection_list("gain_changed").size(), 1, "master fader → the controller")
	ctl.clear()
	t.ok(ctl.strips.is_empty() and ctl.metas.is_empty(), "clear")
	row.free()
	m.free()
	var tab := FileAccess.get_file_as_string("res://features/audio/audio_tab.gd")
	var dock := FileAccess.get_file_as_string("res://features/audio/audio_dock.gd")
	for src in [tab, dock]:
		t.ok(src.contains("Ctl.new()") and src.contains("ctl.bind("), "both surfaces bind through audio_console_ctl.gd")
		t.ok(not src.contains("Api.post_json"), "no surface posts on its own")


func test_footer_order() -> void:
	var src := FileAccess.get_file_as_string("res://app/shell.gd")
	var p := src.find("inspector.add_footer(PlaylistsPanel.new())")
	var tm := src.find("inspector.add_footer(TimersDock.new())")
	var a := src.find("inspector.add_footer(audio_dock)")
	t.ok(p > 0 and p < tm and tm < a, "footer: Playlists → Timers → Program audio (web order)")
