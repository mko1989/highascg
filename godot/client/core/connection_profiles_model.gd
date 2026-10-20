extends RefCounted
## WO-608 — A/B hot-backup host profiles (web client/lib/connection-profiles.js, WO-54 T5.1). The web kept them
## in localStorage `highascg_connection_profiles` = {hostA, hostB, active}; here they live in ui.cfg [connection]
## host_a / host_b / active. Pure helpers — core/config.gd resolves the origin, app/connection_menu.gd edits.

const SECTION := "connection"


static func empty() -> Dictionary:
	return {"hostA": "", "hostB": "", "active": "A"}


## Same rule as normalizeHostOrigin(): bare host → http://host:4200, keep an explicit port / scheme, drop one "/".
static func normalize(host: String) -> String:
	var raw := host.strip_edges()
	if raw == "":
		return ""
	if raw.to_lower().begins_with("http://") or raw.to_lower().begins_with("https://"):
		return raw.trim_suffix("/")
	raw = raw.trim_suffix("/")
	return "http://" + raw + ("" if raw.contains(":") else ":4200")


static func clean(p: Variant) -> Dictionary:
	var d: Dictionary = p if p is Dictionary else {}
	return {
		"hostA": str(d.get("hostA", "")).strip_edges(),
		"hostB": str(d.get("hostB", "")).strip_edges(),
		"active": "B" if str(d.get("active", "A")) == "B" else "A",
	}


static func active_origin(p: Dictionary) -> String:
	var c := clean(p)
	return normalize(c.hostB if c.active == "B" else c.hostA)


static func peer_origin(p: Dictionary) -> String:
	var c := clean(p)
	return normalize(c.hostA if c.active == "B" else c.hostB)


static func peer_letter(p: Dictionary) -> String:
	return "A" if clean(p).active == "B" else "B"


static func has_dual(p: Dictionary) -> bool:
	return active_origin(p) != "" and peer_origin(p) != ""


## switchToPeerProfile(): flip the active side.
static func flipped(p: Dictionary) -> Dictionary:
	var c := clean(p)
	c.active = peer_letter(c)
	return c


## Eye tooltip line: "Host A (http://…)" when profiles are set, "" otherwise.
static func label(p: Dictionary) -> String:
	var o := active_origin(p)
	return "Host %s (%s)" % [clean(p).active, o] if o != "" else ""


## Restart arguments for a profile switch: the user args minus --server (so the new active profile wins).
static func restart_user_args(user_args: PackedStringArray) -> PackedStringArray:
	var out := PackedStringArray()
	for a in user_args:
		if not str(a).begins_with("--server="):
			out.append(a)
	return out


static func load_cfg(cfg: ConfigFile) -> Dictionary:
	return clean({
		"hostA": cfg.get_value(SECTION, "host_a", ""),
		"hostB": cfg.get_value(SECTION, "host_b", ""),
		"active": cfg.get_value(SECTION, "active", "A"),
	})


static func store_cfg(cfg: ConfigFile, p: Dictionary) -> void:
	var c := clean(p)
	cfg.set_value(SECTION, "host_a", normalize(c.hostA))
	cfg.set_value(SECTION, "host_b", normalize(c.hostB))
	cfg.set_value(SECTION, "active", c.active)
