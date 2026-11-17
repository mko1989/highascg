extends RefCounted
## WO-797 — the previs rig watches tracking:fixtures only while its viewport renders; Ws holds a watch per owner.

const F := preload("res://features/previs/fixtures/fixtures_3d_model.gd")
const NetUtil := preload("res://core/net_util.gd")
var t


func test_renders_follows_the_subviewport_update_mode() -> void:
	t.ok(not F.renders(null), "no viewport: nothing drawn")
	var sv := SubViewport.new()
	t.ok(F.renders(sv), "default UPDATE_WHEN_VISIBLE draws")
	sv.render_target_update_mode = SubViewport.UPDATE_DISABLED
	t.ok(not F.renders(sv), "a hidden view (previs_tab / live_stage_3d set UPDATE_DISABLED)")
	sv.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	t.ok(F.renders(sv), "UPDATE_ALWAYS draws")
	sv.free()
	var win := Window.new()
	t.ok(F.renders(win), "a rig straight in a window always draws")
	win.free()


func test_a_watch_is_held_until_the_last_owner_releases_it() -> void:
	var holds := {}
	t.ok(NetUtil.hold(holds, 1, true), "first holder: tell the server on")
	t.ok(not NetUtil.hold(holds, 2, true), "second holder: already on")
	t.ok(not NetUtil.hold(holds, 1, true), "a repeat changes nothing")
	t.ok(not NetUtil.hold(holds, 1, false), "2 still holds it")
	t.eq(holds.keys(), [2])
	t.ok(NetUtil.hold(holds, 2, false), "last release: tell the server off")
	t.ok(not NetUtil.hold(holds, 3, false), "releasing what nobody holds: nothing to say")


func test_wo1115_a_delta_is_merged_into_the_kept_state() -> void:
	var whole := {"fixtures": [{"id": "a", "n": 0}, {"id": "b", "n": 0}]}
	var kept: Dictionary = F.merged({}, whole)
	t.ok(kept == whole, "a whole payload is kept as it is")
	kept = F.merged(kept, {"fixtures": [{"id": "b", "n": 5}, {"id": "zz", "n": 1}], "delta": true})
	t.ok(kept.fixtures == [{"id": "a", "n": 0}, {"id": "b", "n": 5}] and not kept.has("delta"), "delta merged by id, unknown ids dropped")
	t.ok(F.merged(kept, kept) == kept, "re-applying the kept state")
	t.ok(F.merged(kept, {"fixtures": [{"id": "c"}]}).fixtures == [{"id": "c"}], "a whole payload replaces")
