extends SceneTree
## WO-1070 dev probe: the library fill over the real library and this client's thumbnail cache → the banks as text and a
## picture (one row of 5×8 pad swatches per bank). godot --headless -s tests/probe_pad_banks.gd -- <shaders.json> <out.png>
const Lib := preload("res://features/visuals/visuals_midi_library.gd")
const Catalog := preload("res://features/visuals/visuals_catalog.gd")
const Launcher := preload("res://features/visuals/game_launcher.gd")
const Palette := preload("res://features/midi/apc40_palette.gd")


func _init() -> void:
	var args := OS.get_cmdline_user_args()
	var shaders: Array = JSON.parse_string(FileAccess.get_file_as_string(args[0])).shaders
	var rows := Catalog.rows(shaders, Launcher.games())
	var dir := ProjectSettings.globalize_path("user://visual_thumbs/v1")
	var missing := 0
	var cols := {}
	for r in rows:
		var p := dir.path_join(str(r.thumb) + ".png")
		if r.thumb != "" and FileAccess.file_exists(p):
			cols[r.thumb] = Palette.main_color(Image.load_from_file(p))
		elif r.thumb != "":
			missing += 1
	var bs := Lib.banks(rows, func(r: Dictionary) -> Variant: return cols.get(r.thumb))
	print("%d rows, %d without a cached thumbnail, %d banks" % [rows.size(), missing, bs.size()])
	var img := Image.create(8 * 40 + 10, bs.size() * (5 * 24 + 10), false, Image.FORMAT_RGB8)
	for bi in bs.size():
		print("bank %d  %s  %d pads" % [bi + 1, bs[bi].name, bs[bi].clips.size()])
		for i in 40:
			var c: Variant = bs[bi].clips.get(str(Lib.note_of(i)))
			if c == null:
				continue
			var shown := Color.html(Palette.HEX[Palette.nearest(Color.html(c.color))])
			img.fill_rect(Rect2i(5 + (i % 8) * 40, 5 + bi * 130 + (i / 8) * 24, 17, 20), Color.html(c.color))
			img.fill_rect(Rect2i(5 + (i % 8) * 40 + 18, 5 + bi * 130 + (i / 8) * 24, 17, 20), shown)
	img.save_png(args[1])
	quit()
