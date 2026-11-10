extends RefCounted
## WO-1029 (owner 10.11: "i dont want this godot client a/b — the whole linking system is done in a different place")
## — ONE server address for a client that was started without `--server=` / HIGHASCG_SERVER: ui.cfg [server] address.
## Replaces the WO-608 A/B host profiles ([connection] host_a / host_b / active): which other boxes exist is not a client
## setting, the handover targets come from the connected box's linked servers (core/handover_model.gd).
## Pure helpers — core/config.gd resolves the origin, app/connection_menu.gd edits.

const SECTION := "server"
const KEY := "address"
const OLD_SECTION := "connection"  ## the A/B profiles this replaces


## A bare host gets http:// and :4200, an explicit scheme / port is kept, one trailing "/" is dropped.
static func normalize(host: String) -> String:
	var raw := host.strip_edges()
	if raw == "":
		return ""
	if raw.to_lower().begins_with("http://") or raw.to_lower().begins_with("https://"):
		return raw.trim_suffix("/")
	raw = raw.trim_suffix("/")
	return "http://" + raw + ("" if raw.contains(":") else ":4200")


static func load_cfg(cfg: ConfigFile) -> String:
	return normalize(str(cfg.get_value(SECTION, KEY, "")))


static func store_cfg(cfg: ConfigFile, address: String) -> void:
	cfg.set_value(SECTION, KEY, normalize(address))


## Migrate an A/B [connection] section: the ACTIVE slot's origin becomes the saved address (unless one is already
## saved), the other slot is dropped, the section is erased. → true when there was one to migrate.
static func migrate_profiles(cfg: ConfigFile) -> bool:
	if not cfg.has_section(OLD_SECTION):
		return false
	var b := str(cfg.get_value(OLD_SECTION, "active", "A")) == "B"
	var active := normalize(str(cfg.get_value(OLD_SECTION, "host_b" if b else "host_a", "")))
	if active != "" and load_cfg(cfg) == "":
		store_cfg(cfg, active)
	cfg.erase_section(OLD_SECTION)
	return true


## Restart arguments: the window args minus --server (so the saved address wins). A client that was handed over keeps
## its --server, or a Settings restart would send it back to the box that failed (WO-1029).
static func restart_user_args(user_args: PackedStringArray) -> PackedStringArray:
	var keep := false
	for a in user_args:
		keep = keep or str(a).begins_with("--handover-from=")
	var out := PackedStringArray()
	for a in user_args:
		if str(a).begins_with("--server=") and not keep:
			continue
		out.append(a)
	return out


## Restart arguments of a handover move: onto `target`, remembering where from and when (the cue, the hold, the return).
static func handover_user_args(user_args: PackedStringArray, target: String, from: String, at_unix: float) -> PackedStringArray:
	var out := PackedStringArray()
	for a in user_args:
		var s := str(a)
		if not (s.begins_with("--server=") or s.begins_with("--handover-from=") or s.begins_with("--handover-at=")):
			out.append(a)
	out.append("--server=" + target)
	out.append("--handover-from=" + from)
	out.append("--handover-at=%d" % int(at_unix))
	return out


## Restart arguments of a return to the first box: onto `target`, with no handover trail (nothing to cue, nothing to hold).
static func return_user_args(user_args: PackedStringArray, target: String) -> PackedStringArray:
	var out := PackedStringArray()
	for a in user_args:
		var s := str(a)
		if not (s.begins_with("--server=") or s.begins_with("--handover-from=") or s.begins_with("--handover-at=")):
			out.append(a)
	out.append("--server=" + target)
	return out
