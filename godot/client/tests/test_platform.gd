extends RefCounted
## WO-686 — the on-box / off-box split and the user's home on Windows.

const P := preload("res://core/platform.gd")
var t


func test_local_origin() -> void:
	t.ok(P.is_local_origin("http://127.0.0.1:4200"), "loopback")
	t.ok(P.is_local_origin("http://localhost:4200/"), "localhost")
	t.ok(P.is_local_origin("http://[::1]:4200"), "ipv6 loopback")
	t.ok(P.is_local_origin("https://localhost"), "no port")
	t.ok(not P.is_local_origin("http://192.168.0.20:4200"), "another machine")
	t.ok(not P.is_local_origin("http://box.local:4200"), "a host name is another machine")
	t.ok(not P.is_local_origin("http://[fe80::1]:4200"), "ipv6 LAN")


func test_home_dir() -> void:
	t.eq(P.home_dir("/home/op", "C:\\Users\\op"), "/home/op", "Linux / macOS: $HOME")
	t.eq(P.home_dir("", "C:\\Users\\op"), "C:\\Users\\op", "Windows: %USERPROFILE%")
	t.ok(P.home_dir("", "") == OS.get_system_dir(OS.SYSTEM_DIR_DOCUMENTS).get_base_dir(), "neither: the Documents folder's parent")


func test_start_dir_exists() -> void:
	t.ok(DirAccess.dir_exists_absolute(P.start_dir()), "file dialogs open in a folder that exists")
