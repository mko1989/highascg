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

const DEFAULT_ORIGIN := "http://127.0.0.1:4200"
const UI_CFG := "user://ui.cfg"

var origin := DEFAULT_ORIGIN
var args := {}
var _profiles := {}


func _init() -> void:
	args = parse_args(OS.get_cmdline_user_args())
	forget_cluster(UI_CFG)
	origin = home_origin()


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
