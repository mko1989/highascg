extends Node
## WO-599 — where the HighAsCG server is. Precedence: `-- --server=http://host:4200`, env
## HIGHASCG_SERVER, then the on-box default http://127.0.0.1:4200 (the client runs next to the server).

const DEFAULT_ORIGIN := "http://127.0.0.1:4200"

var origin := DEFAULT_ORIGIN
var args := {}


func _init() -> void:
	args = parse_args(OS.get_cmdline_user_args())
	origin = resolve_origin(args, OS.get_environment("HIGHASCG_SERVER"))


func ws_url() -> String:
	return ws_url_for(origin)


static func resolve_origin(user_args: Dictionary, env_value: String) -> String:
	var o: String = str(user_args.get("server", ""))
	if o == "":
		o = env_value
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
