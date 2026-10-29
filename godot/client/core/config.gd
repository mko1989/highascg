extends Node
## WO-599 — where the HighAsCG server is. Precedence: `-- --server=http://host:4200`, env
## HIGHASCG_SERVER, then the active A/B hot-backup profile (ui.cfg [connection], WO-608), then the on-box default
## http://127.0.0.1:4200 (the client runs next to the server). All of them are chosen by the operator and shown in the
## header (app/header_project.gd).
## WO-802 (owner 29.10: "linking only the node servers should link; the godot clients should stay connected to their
## respective node servers"): nothing the cluster says ever changes it. The WO-670 P3b follow (ui.cfg [cluster] origin
## / servers / follow) is gone; a [cluster] section left by an older client is erased on start, so a restart never goes
## back to a server this client once followed.

const Profiles := preload("res://core/connection_profiles_model.gd")
const AuthModel := preload("res://core/auth_model.gd")
const Platform := preload("res://core/platform.gd")

const DEFAULT_ORIGIN := "http://127.0.0.1:4200"
const DEMO_ORIGIN := "http://demo.invalid"  # WO-815: the simulated server — no network address at all
const DEMO_LABEL := "DEMO — no server"
const UI_CFG := "user://ui.cfg"

var origin := DEFAULT_ORIGIN
var demo := false  ## WO-815: Api and Ws answer from core/demo/demo_server.gd, nothing goes on the network
var args := {}
var _profiles := {}


func _init() -> void:
	args = parse_args(OS.get_cmdline_user_args())
	forget_cluster(UI_CFG)
	origin = home_origin()
	_load_password()
	demo = demo_wanted(args, saved_demo(UI_CFG), OS.has_feature("web"))
	if demo:
		origin = DEMO_ORIGIN
		AuthModel.password = ""  # nothing is sent anywhere


## WO-815 — the simulated server (core/demo/demo_server.gd): `-- --demo` (`--demo=0` turns it off), else the Settings
## switch "Simulated server" (ui.cfg [demo] enabled, default off); the Web export has no server and is always a demo.
## In a demo the origin is DEMO_ORIGIN (`.invalid` never resolves): the few sockets built from the origin itself
## (uploads, downloads) fail at once instead of reaching a real box.
static func demo_wanted(user_args: Dictionary, saved: bool, web: bool) -> bool:
	if web:
		return true
	if user_args.has("demo"):
		return not (str(user_args["demo"]).to_lower() in ["0", "false", "off", "no"])
	return saved


static func saved_demo(path: String) -> bool:
	var cfg := ConfigFile.new()
	return cfg.load(path) == OK and cfg.get_value("demo", "enabled", false) == true


## The Settings switch (applies at the next start of the client).
func save_demo(on: bool) -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("demo", "enabled", on)
	cfg.save(UI_CFG)


## Where this client goes (args / env / A/B profile / default) — the only place it ever goes.
func home_origin() -> String:
	return resolve_origin(args, OS.get_environment("HIGHASCG_SERVER"), Profiles.active_origin(profiles()))


## WO-802: erase the WO-670 P3b [cluster] section (a followed master's origin, the remembered servers, the follow
## switch). → true when there was one.
static func forget_cluster(path: String) -> bool:
	var cfg := ConfigFile.new()
	if cfg.load(path) != OK or not cfg.has_section("cluster"):
		return false
	print("[client] WO-802: dropped the old cluster follow state (origin %s, %d remembered servers)" % [
		str(cfg.get_value("cluster", "origin", "")) if str(cfg.get_value("cluster", "origin", "")) != "" else "none",
		PackedStringArray(cfg.get_value("cluster", "servers", PackedStringArray())).size()])
	cfg.erase_section("cluster")
	cfg.save(path)
	return true


## A/B profiles from ui.cfg (empty when none are set); read once, kept in step by save_profiles().
func profiles() -> Dictionary:
	if _profiles.is_empty():
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		_profiles = Profiles.load_cfg(cfg)
	return _profiles.duplicate()


func save_profiles(p: Dictionary) -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	Profiles.store_cfg(cfg, p)
	cfg.save(UI_CFG)
	_profiles = Profiles.load_cfg(cfg)


## WO-811 — the shared API password for `origin` (ui.cfg [auth]); on the box, the node's own file when ui.cfg has none.
var password: String:
	get:
		return AuthModel.password


func _load_password() -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	AuthModel.password = AuthModel.load_password(cfg, origin)
	if AuthModel.password == "":
		adopt_local_password()


## On the box (origin is this machine): take the node's password file when it differs from the one in use, and keep it
## in ui.cfg (owner 29.10: "Godot auto-logs in on the box"). → true when the password changed (worth a retry).
func adopt_local_password() -> bool:
	if not Platform.is_local_origin(origin):
		return false
	var pw := AuthModel.read_first(AuthModel.local_token_paths(ProjectSettings.globalize_path("res://"), Platform.home_dir()))
	if pw == "" or pw == AuthModel.password:
		return false
	set_password(pw)
	return true


## Use and remember `pw` for this server (the 401 prompt, core/auth_prompt.gd).
func set_password(pw: String) -> void:
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	AuthModel.store_password(cfg, origin, pw)
	cfg.save(UI_CFG)
	AuthModel.password = pw.strip_edges()


func ws_url() -> String:
	return ws_url_for(origin)


static func resolve_origin(user_args: Dictionary, env_value: String, profile_origin := "") -> String:
	var o: String = str(user_args.get("server", ""))
	if o == "":
		o = env_value
	if o == "":
		o = profile_origin
	if o == "":
		o = DEFAULT_ORIGIN
	while o.ends_with("/"):
		o = o.substr(0, o.length() - 1)
	return o


## Same rule as client/lib/api-origin.js getWsUrl(): http→ws, https→wss, path /api/ws.
static func ws_url_for(http_origin: String) -> String:
	var o := http_origin
	if o.begins_with("https://"):
		o = "wss://" + o.substr(8)
	elif o.begins_with("http://"):
		o = "ws://" + o.substr(7)
	return o + "/api/ws"


static func parse_args(raw: PackedStringArray) -> Dictionary:
	var out := {}
	for a in raw:
		var s: String = a
		if not s.begins_with("--"):
			continue
		var kv := s.substr(2).split("=", true, 1)
		out[kv[0]] = kv[1] if kv.size() > 1 else "1"
	return out
