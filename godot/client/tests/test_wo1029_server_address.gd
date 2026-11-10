extends RefCounted
## WO-1029 — the A/B host profiles are gone: ONE saved server address (core/server_address_model.gd), the migration of an
## old [connection] section, the restart arguments of a handover and the on-box client that never follows.

const M := preload("res://core/server_address_model.gd")
const C := preload("res://core/config.gd")
var t


func test_normalize_and_roundtrip() -> void:
	t.eq(M.normalize(""), "", "empty")
	t.eq(M.normalize(" 192.168.0.10 "), "http://192.168.0.10:4200", "bare host gets :4200")
	t.eq(M.normalize("box:8080/"), "http://box:8080", "explicit port kept")
	t.eq(M.normalize("https://box.example/"), "https://box.example", "scheme kept")
	var cfg := ConfigFile.new()
	M.store_cfg(cfg, "10.0.0.7")
	t.eq(M.load_cfg(cfg), "http://10.0.0.7:4200", "roundtrip")


func test_precedence() -> void:
	t.eq(C.resolve_origin({}, "", "http://p:4200/"), "http://p:4200", "saved address beats default")
	t.eq(C.resolve_origin({}, "http://env:1", "http://p:4200"), "http://env:1", "env beats saved")
	t.eq(C.resolve_origin({"server": "http://arg:2"}, "http://env:1", "http://p"), "http://arg:2", "arg wins")
	t.eq(C.resolve_origin({}, ""), C.DEFAULT_ORIGIN, "default")


func test_migrates_the_active_slot() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("connection", "host_a", "http://10.0.0.1:4200")
	cfg.set_value("connection", "host_b", "http://10.0.0.2:4200")
	cfg.set_value("connection", "active", "B")
	cfg.set_value("auth", "x", 1)
	t.eq(M.migrate_profiles(cfg), true, "there was one")
	t.eq(M.load_cfg(cfg), "http://10.0.0.2:4200", "the ACTIVE slot is the saved address")
	t.eq(cfg.has_section("connection"), false, "the old section is erased (the other slot dropped)")
	t.eq(cfg.get_value("auth", "x"), 1, "other sections stay")
	t.eq(M.migrate_profiles(cfg), false, "nothing the second time")
	var keep := ConfigFile.new()
	keep.set_value("server", "address", "http://mine:4200")
	keep.set_value("connection", "host_a", "http://old:4200")
	M.migrate_profiles(keep)
	t.eq(M.load_cfg(keep), "http://mine:4200", "an address already saved is not overwritten")


func test_migration_on_disk() -> void:
	var path := "user://test_wo1029_ui.cfg"
	var cfg := ConfigFile.new()
	cfg.set_value("connection", "host_a", "http://10.0.0.1:4200")
	cfg.set_value("connection", "active", "A")
	cfg.save(path)
	t.eq(C.migrate_profiles(path), true, "migrated")
	var back := ConfigFile.new()
	back.load(path)
	t.eq(M.load_cfg(back), "http://10.0.0.1:4200", "saved address")
	t.eq(back.has_section("connection"), false, "section erased")
	t.eq(C.migrate_profiles(path), false, "once")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))


func test_restart_args() -> void:
	t.eq(M.restart_user_args(PackedStringArray(["--screen=0", "--server=http://x", "--tab=0"])),
		PackedStringArray(["--screen=0", "--tab=0"]), "strip --server")
	t.eq(M.restart_user_args(PackedStringArray(["--server=http://b", "--handover-from=http://a"])),
		PackedStringArray(["--server=http://b", "--handover-from=http://a"]), "a handed-over client keeps its server")
	t.eq(M.handover_user_args(PackedStringArray(["--tab=1", "--server=http://a"]), "http://b", "http://a", 100.0),
		PackedStringArray(["--tab=1", "--server=http://b", "--handover-from=http://a", "--handover-at=100"]), "move args")
	t.eq(M.return_user_args(PackedStringArray(["--server=http://b", "--handover-from=http://a", "--handover-at=5", "--tab=1"]), "http://a"),
		PackedStringArray(["--tab=1", "--server=http://a"]), "return args drop the trail")


func test_no_ab_left() -> void:
	t.eq(FileAccess.file_exists("res://core/connection_profiles_model.gd"), false, "the A/B model is gone")
	for f in ["res://core/config.gd", "res://app/connection_menu.gd", "res://app/shell.gd"]:
		var src := FileAccess.get_file_as_string(f)
		t.ok(not src.contains("Profiles.") and not src.contains("A/B hosts…"), f + " has no A/B profiles")
	t.ok(FileAccess.get_file_as_string("res://core/config.gd").contains("handover-from"), "the handover argument is read")
	t.ok(FileAccess.get_file_as_string("res://app/handover_watch.gd").contains("MOVE = RESTART"), "move path documented")
