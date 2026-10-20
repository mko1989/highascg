extends RefCounted

const M := preload("res://core/connection_profiles_model.gd")
const C := preload("res://core/config.gd")

var t


func test_normalize() -> void:
	t.eq(M.normalize(""), "", "empty")
	t.eq(M.normalize(" 192.168.0.10 "), "http://192.168.0.10:4200", "bare host gets :4200")
	t.eq(M.normalize("box:8080/"), "http://box:8080", "explicit port kept")
	t.eq(M.normalize("https://box.example/"), "https://box.example", "scheme kept, slash dropped")
	t.eq(M.normalize("HTTP://Box:4200"), "HTTP://Box:4200", "scheme case-insensitive")


func test_active_peer_flip() -> void:
	var p := {"hostA": "10.0.0.1", "hostB": "10.0.0.2", "active": "A"}
	t.eq(M.active_origin(p), "http://10.0.0.1:4200", "active A")
	t.eq(M.peer_origin(p), "http://10.0.0.2:4200", "peer B")
	t.eq(M.peer_letter(p), "B", "peer letter")
	t.eq(M.has_dual(p), true, "dual")
	var f := M.flipped(p)
	t.eq(f.active, "B", "flipped")
	t.eq(M.active_origin(f), "http://10.0.0.2:4200", "active after flip")
	t.eq(M.label(f), "Host B (http://10.0.0.2:4200)", "label")
	t.eq(M.has_dual({"hostA": "x"}), false, "single host")
	t.eq(M.clean(null), M.empty(), "garbage → empty")
	t.eq(M.clean({"active": "C"}).active, "A", "bad active → A")
	t.eq(M.label({}), "", "no label without profiles")


func test_cfg_roundtrip() -> void:
	var cfg := ConfigFile.new()
	t.eq(M.load_cfg(cfg), M.empty(), "missing section")
	M.store_cfg(cfg, {"hostA": "a", "hostB": "b:9", "active": "B"})
	t.eq(cfg.get_value("connection", "host_a"), "http://a:4200", "stored normalized")
	t.eq(M.load_cfg(cfg), {"hostA": "http://a:4200", "hostB": "http://b:9", "active": "B"}, "roundtrip")


func test_restart_args_and_precedence() -> void:
	t.eq(M.restart_user_args(PackedStringArray(["--screen=0", "--server=http://x", "--tab=0"])),
		PackedStringArray(["--screen=0", "--tab=0"]), "strip --server")
	t.eq(C.resolve_origin({}, "", "http://p:4200/"), "http://p:4200", "profile beats default")
	t.eq(C.resolve_origin({}, "http://env:1", "http://p:4200"), "http://env:1", "env beats profile")
	t.eq(C.resolve_origin({"server": "http://arg:2"}, "http://env:1", "http://p"), "http://arg:2", "arg wins")
	t.eq(C.resolve_origin({}, ""), C.DEFAULT_ORIGIN, "default")
