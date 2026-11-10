extends RefCounted
## WO-1029 C9 — role naming and the lease model of relayed pictures (video/feed_roles.gd).

const FR := preload("res://video/feed_roles.gd")
var t

const RELAYED := {"transport": "feed", "relay": {"server": {"id": "vb-b", "name": "highascg5867"}, "state": "live"}}


func test_screen_role_is_the_plain_role_by_screen_index() -> void:
	t.eq(FR.screen_role("pgm", 0), "pgm1")
	t.eq(FR.screen_role("prv", 2), "prv3", "screen index 2 = prv3 (never a channel number)")
	t.eq(FR.screen_role("pgm", 4), "", "no relayable role past screen 4")
	t.eq(FR.screen_role("mv", 0), "", "multiview cells are not relayed")
	t.eq(FR.screen_role("pgm", -1), "")


func test_relayed_descriptor() -> void:
	t.ok(FR.is_relayed(RELAYED))
	t.ok(not FR.is_relayed({"role": "pgm1", "channel": 1}), "shm descriptor")
	t.ok(not FR.is_relayed(null), "no descriptor (older node)")
	t.eq(FR.server_name(RELAYED), "highascg5867")
	t.eq(FR.server_name({"transport": "feed", "relay": {"server": {"id": "vb-b"}}}), "vb-b")
	t.eq(FR.server_name({"channel": 2}), "")


func test_feed_roles_per_transport() -> void:
	var d := {"pgm1": {"channel": 1}, "pgm3": RELAYED}
	t.eq(FR.feed_roles(["opgui", "pgm1", "pgm3"], d, false), ["pgm3"], "on the box: only relayed roles over the feed")
	t.eq(FR.feed_roles(["opgui", "pgm3"], d, true), ["opgui", "pgm3"], "remote client: everything")


func test_tile_state() -> void:
	t.eq(FR.tile_state(false, true), "none", "no frame yet: placeholder")
	t.eq(FR.tile_state(true, false), "live")
	t.eq(FR.tile_state(true, true), "stalled", "last frame greyed")


func test_tile_roles_only_visible_remote_relayed() -> void:
	var cells := [{"role": "pgm", "mainIndex": 0}, {"role": "pgm", "mainIndex": 2}, {"role": "prv", "mainIndex": 2}, {"role": "mv", "mainIndex": 2}, {"role": "pgm", "mainIndex": 3}]
	var remote := [false, true, true, true, true]
	var d := {"pgm3": RELAYED, "prv3": RELAYED}
	t.eq(FR.tile_roles(cells, remote, d, true), ["pgm3", "prv3"], "local, multiview and not-relayed (pgm4: older owner) are not held")
	t.eq(FR.tile_roles(cells, remote, d, false), [], "hidden tiles hold nothing (no lease, owner stops encoding)")
	t.eq(FR.tile_roles(cells, remote, {}, true), [], "older node: no descriptors → placeholder only")
