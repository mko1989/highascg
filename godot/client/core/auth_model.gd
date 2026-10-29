extends RefCounted
## WO-811 — the one shared API password (owner 29.10: one password for every client). Pure: no autoload references, so
## core/stream_upload.gd, video/video_feed.gd and features/live/media_download.gd (loaded alone by the tests) can use it.
## The server (src/server/auth.js) takes `Authorization: Bearer <password>` on HTTP and on the WebSocket upgrade; with
## enforcement OFF it ignores the header, so sending it changes nothing today.
## Stored per server origin in ui.cfg [auth] passwords = {origin: password}. On the box the client adopts the node's own
## password file (`.private/api-token`, same user, 0600) — the owner's "Godot auto-logs in on the box".

const SECTION := "auth"
const KEY := "passwords"
const TOKEN_REL := ".private/api-token"

## The password for Config.origin (core/config.gd keeps it in step). "" = send nothing.
static var password := ""


## `Authorization: Bearer …` for `pw`; empty when there is no password.
static func headers_for(pw: String) -> PackedStringArray:
	var p := pw.strip_edges()
	return PackedStringArray() if p == "" else PackedStringArray(["Authorization: Bearer " + p])


## The header for the current password (HTTPRequest / WebSocketPeer.handshake_headers).
static func headers() -> PackedStringArray:
	return headers_for(password)


## `base` plus the auth header (when there is a password).
static func with_auth(base: PackedStringArray, pw: String) -> PackedStringArray:
	var out := base.duplicate()
	out.append_array(headers_for(pw))
	return out


## The same header as one raw HTTP/1.1 line (core/stream_upload.gd writes its request head by hand); "" without one.
static func raw_header_line(pw: String) -> String:
	var h := headers_for(pw)
	return "" if h.is_empty() else h[0] + "\r\n"


## An Api result the server refused for want of the password (auth.js checkHttpAuth → 401).
static func needs_login(res: Dictionary) -> bool:
	return int(res.get("status", 0)) == 401


static func load_password(cfg: ConfigFile, origin: String) -> String:
	var all: Variant = cfg.get_value(SECTION, KEY, {})
	return str((all as Dictionary).get(origin, "")) if all is Dictionary else ""


## Store (or with "" forget) the password for `origin`; other origins stay.
static func store_password(cfg: ConfigFile, origin: String, pw: String) -> void:
	var raw: Variant = cfg.get_value(SECTION, KEY, {})
	var all: Dictionary = (raw as Dictionary).duplicate() if raw is Dictionary else {}
	if pw.strip_edges() == "":
		all.erase(origin)
	else:
		all[origin] = pw.strip_edges()
	cfg.set_value(SECTION, KEY, all)


## Where the node keeps its password on this machine: next to the client in the repo (godot/client → ../../), then
## ~/highascg (an exported client). `project_dir` = ProjectSettings.globalize_path("res://").
static func local_token_paths(project_dir: String, home: String) -> PackedStringArray:
	var out := PackedStringArray()
	if project_dir != "" and not project_dir.begins_with("res://"):
		out.append(project_dir.trim_suffix("/").get_base_dir().get_base_dir().path_join(TOKEN_REL))
	if home != "":
		var p := home.path_join("highascg").path_join(TOKEN_REL)
		if not out.has(p):
			out.append(p)
	return out


## The first readable, non-empty password file among `paths`; "" when none (enforcement never turned on → no file).
static func read_first(paths: PackedStringArray) -> String:
	for p in paths:
		if FileAccess.file_exists(p):
			var s := FileAccess.get_file_as_string(p).strip_edges()
			if s != "":
				return s
	return ""
