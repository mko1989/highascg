extends RefCounted
## WO-876 the Visuals' Game scene: the launcher (ROM listing, core by extension, the window's command line, why it cannot
## play) and the scene (the game's own line count from the ring size; no ring = nothing drawn). The window itself is
## WO-745's (tools/e2e/retro-source.sh); the ring → Visuals path is probed on Xvfb (WO-876 §3).

const L := preload("res://features/visuals/game_launcher.gd")
const Game := preload("res://features/visuals/scenes/game.gd")
var t


func _tmp() -> String:
	var d := OS.get_cache_dir().path_join("wo876-%d" % Time.get_ticks_usec())
	DirAccess.make_dir_recursive_absolute(d.path_join("cores"))
	DirAccess.make_dir_recursive_absolute(d.path_join("games"))
	return d


func _touch(path: String) -> void:
	FileAccess.open(path, FileAccess.WRITE).store_string("x")


func test_games_and_cores() -> void:
	var d := _tmp()
	for f in ["Zelda.nes", "contra.NES", "notes.txt", "mario.zip", "Tetris.gb"]:
		_touch(d.path_join("games").path_join(f))
	var g := L.games([d.path_join("games"), d.path_join("missing")])
	t.eq(g.map(func(r: Dictionary) -> String: return r.name), ["contra", "Tetris", "Zelda"], "ROMs only (zips are not), by name")
	var cores := d.path_join("cores")
	t.eq(L.core_for("x.nes", cores), "", "no core installed")
	_touch(cores.path_join("fceumm_libretro.so"))
	t.eq(L.core_for("x.nes", cores), cores.path_join("fceumm_libretro.so"), "a fallback core")
	_touch(cores.path_join("nestopia_libretro.so"))
	t.eq(L.core_for("x.NES", cores), cores.path_join("nestopia_libretro.so"), "the preferred core wins; case-blind")
	t.eq(L.core_for("x.sfc", cores), "", "SNES needs its own core")
	t.eq(L.core_for("x.txt", cores), "", "unknown extension")
	OS.move_to_trash(d)


func test_window_command_line() -> void:
	var a := L.args_for("/g/contra.nes", 1)
	t.eq(Array(a.slice(0, 5)), ["--path", L.retro_dir(), "--screen", "1", "--"], "the retro project, on this screen")
	t.ok("--ring" in a and a[a.find("--ring") + 1] == L.RING, "publishes the Game scene's ring")
	t.ok(a[a.find("--game") + 1] == "/g/contra.nes", "the ROM")
	t.ok(L.retro_dir().ends_with("godot/retro"), "next to the client project")
	t.eq(L.expand("~/x"), OS.get_environment("HOME") + "/x", "~ is home")


func test_why_not() -> void:
	t.ok(L.ready_error("") != "", "no game picked → says where ROMs go")
	t.ok(L.ready_error("/nope/x.nes") != "", "missing file")
	var launcher := L.new()
	t.ok(launcher.play("", 0) != "", "play refuses with the reason")
	t.eq(launcher.running(), false, "nothing started")


func test_game_scene() -> void:
	t.eq(Game.source_lines(768, 720), 240, "NES ×3")
	t.eq(Game.source_lines(800, 720), 144, "Game Boy ×5")
	t.eq(Game.source_lines(1024, 896), 224, "SNES ×4")
	t.eq(Game.source_lines(1920, 1080), 1080, "already big → as is")
	var g: Node3D = Game.new()
	g.step({"spin": 0.5}, 1.0 / 60.0, true)
	t.eq(g.live(), false, "no ring → not live")
	t.eq(g._quad.visible, false, "nothing drawn without a game")
	g.set_overlay(true)
	t.ok(g._mat.shader.code.contains("ALPHA = opacity * smoothstep"), "layer 2 keys black out")
	g.set_audio(PackedByteArray([0, 255, 255, 255, 255, 255, 255]))
	t.eq(g._bass, 1.0, "the bass bins drive the split")
	g.free()
