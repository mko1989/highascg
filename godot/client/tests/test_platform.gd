extends RefCounted
## WO-686 — the on-box / off-box split and the user's home on Windows.

const P := preload("res://core/platform.gd")
var t


func test_local_origin() -> void:
	t.ok(P.is_local_origin("http://127.0.0.1:4200"), "loopback")
	t.ok(P.is_local_origin("http://localhost:4200/"), "localhost")
	t.ok(P.is_local_origin("http://[::1]:4200"), "ipv6 loopback")
	t.ok(P.is_local_origin("https://localhost"), "no port")
	var own := P.machine_hosts(["127.0.0.1", "::1", "192.168.0.15", "fe80::10ed:ad56:32b9:edf0%eno1"], "highascg7580")
	t.ok(not P.is_local_origin("http://192.168.0.20:4200", own), "another machine")
	t.ok(not P.is_local_origin("http://box.local:4200", own), "another machine's host name")
	t.ok(not P.is_local_origin("http://[fe80::1]:4200", own), "ipv6 LAN")


## WO-1106 C44: the box's own LAN address / host name is this machine too (the on-box client never follows, RULES.md).
func test_own_addresses_are_local_wo1106_c44() -> void:
	var own := P.machine_hosts(["127.0.0.1", "::1", "192.168.0.15", "FE80::10ED:AD56:32B9:EDF0%eno1", "100.101.245.97"], "HighAsCG7580")
	t.eq(own, PackedStringArray(["127.0.0.1", "::1", "192.168.0.15", "fe80::10ed:ad56:32b9:edf0", "100.101.245.97", "highascg7580",
		"highascg7580.local"]), "addresses lower case without the zone, the host name and its .local")
	t.ok(P.is_local_origin("http://192.168.0.15:4200", own), "the box's LAN address")
	t.ok(P.is_local_origin("http://100.101.245.97:4200/", own), "its VPN address")
	t.ok(P.is_local_origin("http://[fe80::10ed:ad56:32b9:edf0]:4200", own), "its IPv6 link-local address")
	t.ok(P.is_local_origin("http://HighAsCG7580.local:4200", own), "its mDNS name (any case)")
	t.ok(P.is_local_origin("http://highascg7580:4200", own), "its host name")
	t.ok(P.is_local_origin("http://127.0.1.1:4200", []), "any 127.x loopback (Debian maps the host name there)")
	t.ok(not P.is_local_origin("http://192.168.0.150:4200", own), "a near address is another machine")
	t.ok(not P.is_local_origin("http://highascg5867.local:4200", own), "another box's name")
	t.ok(not P.is_local_origin("", own) and not P.is_local_origin("http://:4200", own), "no host")
	t.eq(P.machine_hosts([], "localhost"), PackedStringArray(), "no addresses, no real name: nothing extra")
	for h in P.own_hosts():  # the real machine: every address it reports is local
		t.ok(P.is_local_origin("http://%s:4200" % ("[%s]" % h if h.contains(":") else h)), "this machine: " + h)


func test_home_dir() -> void:
	t.eq(P.home_dir("/home/op", "C:\\Users\\op"), "/home/op", "Linux / macOS: $HOME")
	t.eq(P.home_dir("", "C:\\Users\\op"), "C:\\Users\\op", "Windows: %USERPROFILE%")
	t.ok(P.home_dir("", "") == OS.get_system_dir(OS.SYSTEM_DIR_DOCUMENTS).get_base_dir(), "neither: the Documents folder's parent")


func test_start_dir_exists() -> void:
	t.ok(DirAccess.dir_exists_absolute(P.start_dir()), "file dialogs open in a folder that exists")
