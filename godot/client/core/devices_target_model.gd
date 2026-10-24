extends RefCounted
## WO-732 P3a — pure rule for core/devices_target.gd (unit-tested; the autoload itself needs the running client).

const Platform := preload("res://core/platform.gd")


## The home origin when this client runs on a server box (a local origin that answers as HighAsCG) and is connected
## to another server; "" = the connected server.
static func pick(origin: String, home_origin: String, home_is_highascg: bool) -> String:
	if home_origin == "" or home_origin == origin or not Platform.is_local_origin(home_origin) or not home_is_highascg:
		return ""
	return home_origin


## WO-732 P3b — the origin a linked server's card is edited at: its host and port from /api/cluster ("" = unknown).
static func peer_origin(peer: Dictionary) -> String:
	var host := str(peer.get("host", "")).strip_edges()
	if host == "" or host.contains("/"):
		return ""
	var port := int(peer.get("port", 4200))
	return "http://%s:%d" % ["[%s]" % host if host.contains(":") else host, port if port > 0 else 4200]
