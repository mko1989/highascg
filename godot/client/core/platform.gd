extends RefCounted
## WO-686 — what differs between the client on the box (Linux, server on loopback) and a GUI on another machine
## (Windows / macOS / Linux). Pure helpers, so tests run without autoloads.


## The server runs on this machine. Off-box, nothing may lay out or prompt on the box's screens (WO-638 / WO-645),
## start box apps (operator dock) or read /dev/shm (the JPEG feed replaces it, WO-670).
## WO-1106 C44: "this machine" is loopback OR any of its own addresses / its host name — an on-box client started with
## the box's LAN address counted as remote and would have followed to a linked server (RULES.md linked servers 6: the
## on-box client never follows). `own` (tests) replaces the machine's list (own_hosts()).
static func is_local_origin(origin: String, own: Variant = null) -> bool:
	var host := origin.strip_edges().to_lower().trim_prefix("http://").trim_prefix("https://").get_slice("/", 0)
	host = host.get_slice("]", 0).trim_prefix("[") if host.begins_with("[") else host.get_slice(":", 0)
	host = host.get_slice("%", 0).trim_suffix(".")  # an IPv6 zone ("fe80::1%eno1"), a fully qualified "name."
	if host in ["127.0.0.1", "localhost", "::1"] or (host.begins_with("127.") and host.is_valid_ip_address()):
		return true
	return host != "" and host in (own_hosts() if own == null else PackedStringArray(own))


static var _own := PackedStringArray()
static var _own_at := -1
const OWN_TTL_MS := 10000  # addresses come and go (DHCP, a cable, Tailscale): looked up again after 10 s


## This machine's own addresses and host names (lower case, no IPv6 zone), cached for OWN_TTL_MS.
static func own_hosts() -> PackedStringArray:
	var now := Time.get_ticks_msec()
	if _own_at < 0 or now - _own_at > OWN_TTL_MS:
		_own_at = now
		_own = machine_hosts(IP.get_local_addresses(), hostname())
	return _own


## Pure: addresses + host name → the hosts that mean "this machine" ("name" and "name.local" for mDNS).
static func machine_hosts(addresses: Variant, name: String) -> PackedStringArray:
	var out := PackedStringArray()
	for a in addresses:
		var h := str(a).strip_edges().to_lower().get_slice("%", 0)
		if h != "" and not out.has(h):
			out.append(h)
	var n := name.strip_edges().to_lower().trim_suffix(".")
	if n != "" and n != "localhost":
		for h in [n, n.get_slice(".", 0), n.get_slice(".", 0) + ".local"]:
			if not out.has(h):
				out.append(h)
	return out


## The machine's host name: /etc/hostname (Linux), else $HOSTNAME / %COMPUTERNAME% (Windows); "" when unknown.
static func hostname() -> String:
	if FileAccess.file_exists("/etc/hostname"):
		var n := FileAccess.get_file_as_string("/etc/hostname").strip_edges()
		if n != "":
			return n
	var e := OS.get_environment("HOSTNAME")
	return e if e != "" else OS.get_environment("COMPUTERNAME")


## The host of an origin ("http://10.0.0.5:4200" → "10.0.0.5", IPv6 kept in brackets) — what the header names.
static func host_of(origin: String) -> String:
	var s := origin.trim_prefix("http://").trim_prefix("https://").get_slice("/", 0)
	if s.begins_with("["):
		return s.get_slice("]", 0) + "]"
	return s.get_slice(":", 0)


## The user's home: $HOME (Linux / macOS), %USERPROFILE% (Windows has no HOME), else the Documents folder's parent.
static func home_dir(home := OS.get_environment("HOME"), profile := OS.get_environment("USERPROFILE")) -> String:
	if home != "":
		return home
	if profile != "":
		return profile
	return OS.get_system_dir(OS.SYSTEM_DIR_DOCUMENTS).get_base_dir()


## Where file dialogs start: the OS downloads folder, else ~/Downloads, else home.
static func start_dir() -> String:
	var home := home_dir()
	var system := OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)
	if system != "" and system.trim_suffix("/") != home.trim_suffix("/") and DirAccess.dir_exists_absolute(system):
		return system
	var dl := home.path_join("Downloads")
	return dl if DirAccess.dir_exists_absolute(dl) else home
