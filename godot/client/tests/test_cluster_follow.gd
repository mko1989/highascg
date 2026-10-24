extends RefCounted
## WO-670 P3b — core/cluster_follow_model.gd: the servers this client remembers, where the master is, which one to
## reconnect to when its server is gone.

const F := preload("res://core/cluster_follow_model.gd")
var t

const SNAP := {
	"peers": [
		{"id": "boxB", "name": "Box B", "host": "192.168.0.40", "port": 4200, "online": true},
		{"id": "stub", "name": "stub", "host": "127.0.0.1", "port": 4301, "online": false},
	],
	"master": {"epoch": 3, "master_id": "boxB"},
}


func test_host_and_peer_origin() -> void:
	t.eq(F.host_of("http://10.0.0.5:4200"), "10.0.0.5", "host")
	t.eq(F.host_of("https://box.local/x"), "box.local", "no port")
	t.eq(F.peer_origin("http://10.0.0.5:4200", {"host": "127.0.0.1", "port": 4301}), "http://10.0.0.5:4301", "loopback = that server's host")
	t.eq(F.peer_origin("http://10.0.0.5:4200", {"host": "10.0.0.6", "port": 4200}), "http://10.0.0.6:4200", "as listed")
	t.eq(F.peer_origin("http://a", {}), "", "no host")


func test_servers_remembered() -> void:
	t.eq(F.servers("http://127.0.0.1:4200", SNAP), PackedStringArray(["http://127.0.0.1:4200", "http://192.168.0.40:4200", "http://127.0.0.1:4301"]), "this + linked")
	t.eq(F.servers("http://127.0.0.1:4200", {}), PackedStringArray(["http://127.0.0.1:4200"]), "alone")


func test_master_origin() -> void:
	t.eq(F.master_origin("http://127.0.0.1:4200", SNAP), "http://192.168.0.40:4200", "another server is master")
	t.eq(F.master_name(SNAP), "Box B", "its name")
	t.eq(F.master_origin("http://x:4200", {"peers": SNAP.peers, "master": {"epoch": 3, "master_id": "self"}}), "", "this one is master")
	t.eq(F.master_origin("http://x:4200", {"peers": SNAP.peers, "master": {"epoch": 0, "master_id": ""}}), "", "no master")
	t.eq(F.master_origin("http://x:4200", {"peers": SNAP.peers, "master": {"epoch": 4, "master_id": "stub"}}), "", "master offline → stay")


func test_pick() -> void:
	var probes := [
		{"origin": "http://a:4200", "ok": true, "data": {"is_master": false, "epoch": 5}},
		{"origin": "http://b:4200", "ok": true, "data": {"is_master": true, "epoch": 4}},
		{"origin": "http://c:4200", "ok": true, "data": {"is_master": true, "epoch": 6}},
		{"origin": "http://d:4200", "ok": false, "data": null},
	]
	t.eq(F.pick(probes), "http://c:4200", "the master with the highest epoch")
	t.eq(F.pick(probes.slice(0, 1) + probes.slice(3), "http://a:4200"), "http://a:4200", "no master → home if it answers")
	t.eq(F.pick(probes.slice(3), "http://d:4200"), "", "home silent → nothing")


func test_resolve_target_keeps_the_on_box_client_home() -> void:
	var home := "http://127.0.0.1:4200"
	var mine := PackedStringArray(["192.168.0.23", "100.64.1.2"])
	t.eq(F.resolve_target("http://192.168.0.23:4200", home, mine), home, "own LAN address → home (WO-724)")
	t.eq(F.resolve_target("http://100.64.1.2:4200", home, mine), home, "any own address")
	t.eq(F.resolve_target("http://192.168.0.4:4200", home, mine), "http://192.168.0.4:4200", "another box: follow it")
	t.eq(F.resolve_target("http://192.168.0.23:4290", home, mine), "http://192.168.0.23:4290", "another port here = another server")
	t.eq(F.resolve_target("http://192.168.0.23:4200", "http://10.0.0.5:4200", mine), "http://192.168.0.23:4200", "a remote client: as is")
	t.eq(F.resolve_target("", home, mine), "", "nothing")
	t.eq(F.port_of("https://box.local/x"), 443, "https default port")
	t.eq(F.port_of("http://[::1]:4201"), 4201, "IPv6 port")
