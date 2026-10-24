extends RefCounted
## WO-732 P3a — pure rule for core/devices_target.gd (unit-tested; the autoload itself needs the running client).

const Platform := preload("res://core/platform.gd")


## The home origin when this client runs on a server box (a local origin that answers as HighAsCG) and is connected
## to another server; "" = the connected server.
static func pick(origin: String, home_origin: String, home_is_highascg: bool) -> String:
	if home_origin == "" or home_origin == origin or not Platform.is_local_origin(home_origin) or not home_is_highascg:
		return ""
	return home_origin
