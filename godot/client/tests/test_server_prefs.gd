extends RefCounted
## WO-1029 — the saved GPU layout / DeckLink rear order belong to the server whose rear panel they describe
## (core/server_prefs.gd): a linked server's panel never takes this box's rows, a save while editing it goes to it (prefs
## AND topology, one api) and leaves this box's untouched, a WS broadcast of this node cannot reach the edited server's
## copy, and the un-keyed devices.cfg entry moves to this box's key once.

const SP := preload("res://core/server_prefs.gd")
const CP := preload("res://core/client_prefs.gd")
const GL := preload("res://features/devices/gpu_layout.gd")
const DO := preload("res://features/devices/decklink_order.gd")
const Model := preload("res://features/devices/devices_model.gd")
const GLE := preload("res://features/devices/gpu_layout_editor.gd")
const TMP := "user://wo1029_test.cfg"
var t


class FakeApi:
	extends RefCounted
	var posts := []
	var reply := {"ok": true, "data": {"prefs": {}}}

	func post_json(path: String, body: Variant) -> Dictionary:
		posts.append([path, body.duplicate(true)])
		return {"ok": true, "data": {}, "error": ""}

	func get_json(_path: String) -> Dictionary:
		return reply


func _reset() -> void:
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TMP))
	SP.path_override = TMP
	SP.peers = {}
	CP.node = {}
	CP._listeners.clear()


func _done() -> void:
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TMP))
	SP.path_override = ""
	SP.peers = {}
	CP.node = {}


func _labels(m: Dictionary) -> Array:
	return m.slots[0].items.map(func(i: Dictionary) -> String: return str(i.get("label")))


func test_model_uses_the_servers_own_layout() -> void:
	_reset()
	var payload := {"graph": {"connectors": [{"id": "gpu_p0", "deviceId": "caspar_host", "kind": "gpu_out", "label": "GPU 0", "externalRef": "DP-0"}]},
		"live": {"gpu": {"displays": [], "physicalMap": {"effectiveTopology": [{"physicalPortId": "gpu_p0", "slotOrder": 0, "dpA": "DP-0", "dpB": "DP-1"}],
			"ports": [{"physicalPortId": "gpu_p0", "slotOrder": 0, "pair": {"dpA": "DP-0", "dpB": "DP-1"}, "runtime": {"connected": false}}]}}}}
	CP.node = {"gpuLayout": [{"id": "gpu_p0", "label": "BOX-A"}], "decklinkRearOrder": ["a2", "a1"]}
	SP.from_reply("B", {"prefs": {"gpuLayout": [{"id": "gpu_p0", "label": "PEER-B"}]}})
	var a: Dictionary = Model.build(payload, null, null, DO.saved(""), GL.saved(""))
	var b: Dictionary = Model.build(payload, null, null, DO.saved("B"), GL.saved("B"))
	var none: Dictionary = Model.build(payload, null, null, DO.saved("C"), GL.saved("C"))
	t.ok(_labels(a).has("BOX-A"), "this box: its own layout")
	t.ok(_labels(b).has("PEER-B") and not _labels(b).has("BOX-A"), "server B: B's layout, never A's")
	t.ok(not _labels(none).has("BOX-A") and not _labels(none).has("PEER-B"), "server with nothing saved: none, not A's")
	t.eq(DO.saved("B"), [], "B has no DeckLink order of its own: not A's")
	t.eq(DO.saved(""), ["a2", "a1"], "this box keeps its order")
	_done()


func test_peer_reply_only_valid_and_failure_means_none() -> void:
	_reset()
	SP.from_reply("B", {"prefs": {"gpuLayout": [{"hidden": true}], "decklinkRearOrder": ["x"], "hardwarePolicy": "keep_live"}})
	t.eq(SP.peers.B.keys(), ["decklinkRearOrder"], "valid global values only, hardwarePolicy stays per node")
	var api := FakeApi.new()
	api.reply = {"ok": false, "error": "502"}
	SP.load_peer("B", api)
	t.ok(not SP.peers.has("B"), "an unreadable peer has no prefs")
	t.eq(GL.saved("B"), [], "and so no layout")
	_done()


func test_save_while_editing_b_leaves_a_untouched() -> void:
	_reset()
	CP.node = {"gpuLayout": [{"id": "gpu_p0", "label": "BOX-A"}]}
	var api := FakeApi.new()
	var io := GLE.Io.new()
	io.server = "B"
	io.api = api
	var rows := [{"id": "gpu_p0", "label": "PEER-B", "hidden": false}]
	io.prefs_save(rows)
	t.eq(api.posts, [["/api/client-prefs", {"key": "gpuLayout", "value": rows}]], "B's prefs go to B's api")
	await io.post_json("/api/settings", {"gpuPhysicalTopology": rows})
	t.eq(api.posts[1][0], "/api/settings", "the topology goes to the same api")
	t.eq(CP.node.gpuLayout[0].label, "BOX-A", "this box's mirror untouched")
	t.eq(GL.saved("B")[0].label, "PEER-B", "B reads its own")
	t.eq(GL.saved("")[0].label, "BOX-A", "this box reads its own")
	io.prefs_clear()
	t.eq(api.posts[2][1], {"key": "gpuLayout", "value": null}, "clear goes to B")
	t.eq(GL.saved("B"), [], "B cleared")
	t.eq(CP.node.gpuLayout[0].label, "BOX-A", "A still untouched")
	DO.save(["d2", "d1"], "B", api)
	t.eq(DO.saved("B"), ["d2", "d1"], "DeckLink order saved for B")
	t.ok(not CP.node.has("decklinkRearOrder"), "not on this box")
	_done()


func test_broadcast_does_not_reach_the_edited_server() -> void:
	_reset()
	SP.from_reply("B", {"prefs": {"gpuLayout": [{"id": "gpu_p0", "label": "PEER-B"}]}})
	t.ok(CP.apply_broadcast({"key": "gpuLayout", "value": [{"id": "gpu_p0", "label": "BOX-A"}]}), "this node's broadcast applies to the mirror")
	t.eq(GL.saved("B")[0].label, "PEER-B", "B's copy unchanged")
	t.eq(GL.saved("")[0].label, "BOX-A", "A's changed")
	_done()


func test_local_copy_keyed_by_server_and_legacy_migrated_once() -> void:
	_reset()
	var cfg := ConfigFile.new()
	cfg.set_value("gpu", "layout", [{"id": "gpu_p1", "label": "OLD"}])
	cfg.set_value("decklink", "rear_order", ["d1"])
	cfg.save(TMP)
	t.eq(SP.local("gpu", "layout", "B"), null, "a peer never inherits the un-keyed entry")
	t.eq(GL.local(""), [{"id": "gpu_p1", "label": "OLD"}], "moved to this box's key")
	t.eq(DO.local(""), ["d1"], "decklink too")
	var after := ConfigFile.new()
	after.load(TMP)
	t.ok(not after.has_section_key("gpu", "layout") and after.has_section_key("gpu", SP.cfg_key("layout", "")), "legacy key gone")
	SP.save("B", null, "gpuLayout", "gpu", "layout", [{"id": "gpu_p0", "label": "B"}])
	t.eq(GL.local("B"), [{"id": "gpu_p0", "label": "B"}], "B has its own key")
	t.eq(GL.local(""), [{"id": "gpu_p1", "label": "OLD"}], "A's key untouched")
	t.eq(SP.migrate(), false, "second migrate moves nothing")
	_done()
