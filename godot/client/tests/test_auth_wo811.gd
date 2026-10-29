extends RefCounted
## WO-811 — the shared API password: header builder, ui.cfg storage, the on-box password file, and every network entry
## point sending it (the five pinned by tests/test_devices_target.gd).

const A := preload("res://core/auth_model.gd")
const U := preload("res://core/stream_upload.gd")
var t


func test_header_builder() -> void:
	t.eq(A.headers_for(""), PackedStringArray(), "no password: no header (enforcement off works as before)")
	t.eq(A.headers_for("   "), PackedStringArray(), "blank is none")
	t.eq(A.headers_for(" s3cret "), PackedStringArray(["Authorization: Bearer s3cret"]), "Bearer, trimmed")
	t.eq(A.with_auth(PackedStringArray(["Accept: application/json"]), "pw"),
		PackedStringArray(["Accept: application/json", "Authorization: Bearer pw"]), "appended to the JSON headers")
	t.eq(A.with_auth(PackedStringArray(["Accept: application/json"]), ""), PackedStringArray(["Accept: application/json"]), "unchanged without one")
	t.eq(A.raw_header_line("pw"), "Authorization: Bearer pw\r\n", "raw line for the upload head")
	t.eq(A.raw_header_line(""), "", "no raw line")
	var saved: String = A.password
	A.password = "live"
	t.eq(A.headers(), PackedStringArray(["Authorization: Bearer live"]), "headers() = the current password")
	A.password = saved


func test_needs_login_is_401_only() -> void:
	t.eq(A.needs_login({"status": 401}), true, "401")
	t.eq(A.needs_login({"status": 403}), false, "403 is the nuclear gate, not login")
	t.eq(A.needs_login({"status": 200}), false, "ok")
	t.eq(A.needs_login({}), false, "transport error")


func test_password_per_origin_in_ui_cfg() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("connection", "host_a", "127.0.0.1")
	t.eq(A.load_password(cfg, "http://127.0.0.1:4200"), "", "none stored")
	A.store_password(cfg, "http://127.0.0.1:4200", " boxpw ")
	A.store_password(cfg, "http://10.0.0.5:4200", "otherpw")
	t.eq(A.load_password(cfg, "http://127.0.0.1:4200"), "boxpw", "stored trimmed")
	t.eq(A.load_password(cfg, "http://10.0.0.5:4200"), "otherpw", "per server")
	var path := "user://test_wo811_ui.cfg"
	cfg.save(path)
	var back := ConfigFile.new()
	back.load(path)
	t.eq(A.load_password(back, "http://10.0.0.5:4200"), "otherpw", "survives a save")
	A.store_password(back, "http://10.0.0.5:4200", "")
	t.eq(A.load_password(back, "http://10.0.0.5:4200"), "", "blank forgets")
	t.eq(A.load_password(back, "http://127.0.0.1:4200"), "boxpw", "the other one stays")
	t.eq(str(back.get_value("connection", "host_a", "")), "127.0.0.1", "other sections untouched")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))


func test_local_password_file() -> void:
	var paths := A.local_token_paths("/home/u/highascg/godot/client/", "/home/u")
	t.eq(paths, PackedStringArray(["/home/u/highascg/.private/api-token"]), "repo file next to the client; ~/highascg is the same")
	t.eq(A.local_token_paths("/opt/hc/client", "/home/u"),
		PackedStringArray(["/opt/.private/api-token", "/home/u/highascg/.private/api-token"]), "exported client: ~/highascg too")
	var dir := ProjectSettings.globalize_path("user://test_wo811_tok")
	DirAccess.make_dir_recursive_absolute(dir)
	var f := FileAccess.open(dir.path_join("api-token"), FileAccess.WRITE)
	f.store_string("tok123\n")
	f.close()
	t.eq(A.read_first(PackedStringArray([dir.path_join("missing"), dir.path_join("api-token")])), "tok123", "first readable, trimmed")
	t.eq(A.read_first(PackedStringArray([dir.path_join("missing")])), "", "none → empty (enforcement never on)")
	DirAccess.remove_absolute(dir.path_join("api-token"))
	DirAccess.remove_absolute(dir)


func test_upload_head_carries_password() -> void:
	var h := U.request_head("h", 4200, "/api/x", "B", 1, A.raw_header_line("pw")).get_string_from_utf8()
	t.ok(h.contains("\r\nAuthorization: Bearer pw\r\n"), "header line in the raw head")
	t.ok(h.ends_with("Connection: close\r\n\r\n"), "head still ends cleanly")
	var plain := U.request_head("h", 4200, "/api/x", "B", 1).get_string_from_utf8()
	t.ok(not plain.contains("Authorization"), "no password → no header")


## Every socket the client opens (tests/test_devices_target.gd) sends the password.
func test_every_entry_point_sends_it() -> void:
	var api := FileAccess.get_file_as_string("res://core/api.gd")
	t.ok(api.contains("AuthModel.with_auth(PackedStringArray([\"Accept: application/json\"]), AuthModel.password)"), "Api JSON")
	t.ok(api.contains("r.request(base() + path, AuthModel.headers())"), "Api bytes")
	t.ok(api.contains("while AuthModel.needs_login(res) and await _login():"), "401 → login → retry")
	t.ok(FileAccess.get_file_as_string("res://core/ws.gd").contains("_peer.handshake_headers = AuthModel.headers()"), "/api/ws upgrade")
	t.ok(FileAccess.get_file_as_string("res://video/video_feed.gd").contains("_peer.handshake_headers = AuthModel.headers()"), "video feed upgrade")
	t.ok(FileAccess.get_file_as_string("res://features/live/media_download.gd").contains("auth_model.gd\").headers())"), "download")
	t.ok(FileAccess.get_file_as_string("res://core/stream_upload.gd").contains("AuthModel.raw_header_line(AuthModel.password)"), "upload")
	var cfg := FileAccess.get_file_as_string("res://core/config.gd")
	t.ok(cfg.contains("\torigin = home_origin()\n\t_load_password()"), "password loaded for the chosen origin")
	t.ok(cfg.contains("if not Platform.is_local_origin(origin):"), "the node's file is adopted only on the box")
