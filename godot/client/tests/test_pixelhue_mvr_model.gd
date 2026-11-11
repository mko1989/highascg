extends RefCounted
## WO-1039 MVR — mvr_model.gd: Studio state normalising (shapes from the owner's P20), pending changes, readback
## reconcile (mvr-reconcile.js), undo stack, edit validation (app.js edit / number fields / aspect toggle), request
## bodies (lib/pixelhue.js validateChanges, lib/mvr-layers.js, lib/mvr-templates.js) and labels.

const M := preload("res://features/pixelhue/mvr_model.gd")
var t


func _w(x: int, y: int, w: int, h: int) -> Dictionary:
	return {"x": x, "y": y, "width": w, "height": h}


## A trimmed copy of the owner's P20 GET /api/state (JSON numbers arrive as floats).
func _raw() -> Dictionary:
	return {
		"screens": [{"id": 7.0, "name": "MVR ", "width": 1920.0, "height": 1080.0, "dimensionsAssumed": false}],
		"signals": [{"id": 25.0, "connected": true, "width": 1920.0, "height": 1080.0}, {"id": 28.0, "connected": false, "width": null, "height": null},
			{"id": 1.0, "sourceType": 3.0, "connected": true, "width": 3072.0, "height": 1024.0}],
		"layers": [
			{"id": 121831424.0, "screenId": 7.0, "name": "Layer1", "source": "Input 1-DP 1.2", "window": {"width": 400.0, "height": 249.0, "x": 1215.0, "y": 22.0},
				"sourceId": 25.0, "sourceType": 2.0, "umdHeight": 24.0, "aspectMode": 5.0, "aspectLock": 1.7777777777777777},
			{"id": 121831425.0, "screenId": 7.0, "name": "Layer1", "source": "Input 2-HDMI 2.0", "window": {"width": 258.0, "height": 169.0, "x": 1641.0, "y": 4.0},
				"sourceId": 28.0, "sourceType": 2.0, "umdHeight": 24.0, "aspectMode": 5.0, "aspectLock": null},
			{"id": 121831436.0, "screenId": 7.0, "name": "Layer1", "source": "Screen 1", "window": {"width": 1131.0, "height": 401.0, "x": 24.0, "y": 21.0},
				"sourceId": 1.0, "sourceType": 3.0, "umdHeight": 24.0, "aspectMode": 5.0, "aspectLock": 3.0}],
		"sources": [{"type": 3.0, "id": 1.0, "name": "Screen 1 PGM", "width": 3072.0, "height": 1024.0, "umdHeight": 24.0, "usedBy": 121831436.0},
			{"type": 2.0, "id": 25.0, "name": "Input 1-DP 1.2", "width": 1920.0, "height": 1080.0, "umdHeight": 24.0, "usedBy": 121831424.0},
			{"type": 2.0, "id": 28.0, "name": "Input 2-HDMI 2.0", "width": null, "height": null, "umdHeight": 24.0, "usedBy": 121831425.0},
			{"type": 2.0, "id": 40.0, "name": "Input 6-DP 1.2", "width": 3072.0, "height": 1024.0, "umdHeight": 24.0, "usedBy": null},
			{"type": 4.0, "id": 1.0, "name": "Screen 1 PVW", "width": 3072.0, "height": 1024.0, "umdHeight": null, "usedBy": null}],
		"session": "1f31bc78", "device": {"model": "P20", "serial": "SN0000000000001"}, "capabilities": {"inputs": true, "mvr": true, "audio": true}}


func _state() -> Dictionary:
	return M.normalize_state(_raw())


func test_normalize_state() -> void:
	var s := _state()
	t.eq(typeof(s.layers[0].id), TYPE_INT, "ids are ints")
	t.eq(s.layers[0].window, _w(1215, 22, 400, 249), "window ints")
	t.eq(typeof(s.layers[0].window.x), TYPE_INT, "window x int")
	t.eq(s.layers[1].aspectLock, null, "unlocked stays null")
	t.eq(s.layers[2].aspectLock, 3.0, "lock")
	t.ok(not s.signals[0].has("sourceType"), "input signals carry no sourceType")
	t.eq(s.signals[2].sourceType, 3, "screen signals do")
	t.eq(s.sources[3].usedBy, null, "unused source")
	t.eq(s.sources[4].umdHeight, null, "unknown UMD kept as null")
	t.eq(s.session, "1f31bc78", "session kept")
	t.eq(M.windows_of(s, 7).size(), 3, "windows of the output")
	t.eq(M.screen_of(s, 7).width, 1920, "screen")


func test_changes_and_same_edit() -> void:
	var s := _state()
	var base := s.duplicate(true)
	t.eq(M.changes(s, base), [], "nothing pending")
	s.layers[1].window.x = 1600
	s.layers[2].aspectLock = null
	var c := M.changes(s, base)
	t.eq(c.size(), 2, "two pending")
	t.eq(c[0], {"id": 121831425, "window": _w(1600, 4, 258, 169), "aspectLock": null, "aspectMode": 5}, "geometry change")
	t.eq(c[1].aspectLock, null, "unlock is a change")
	t.eq(M.changes({}, base), [], "no state")


func test_reconcile_keeps_newer_local_edits() -> void:
	var base := _state()
	var local := base.duplicate(true)
	local.layers[0].window.x = 1000  # sent
	var sent := M.changes(local, base)
	local.layers[1].window.x = 1500  # edited while the request ran
	var readback := base.duplicate(true)
	readback.layers[0].window.x = 1000
	var merged := M.reconcile(local, base, readback, sent)
	t.eq(merged.layers[0].window.x, 1000, "sent edit comes from the device")
	t.eq(merged.layers[1].window.x, 1500, "newer local edit kept")
	t.eq(M.changes(merged, readback).size(), 1, "and still pending")
	local.layers[0].window.x = 900  # edited again after sending
	t.eq(M.reconcile(local, base, readback, sent).layers[0].window.x, 900, "a re-edit of a sent window wins too")
	var snapshot := base.duplicate(true)
	snapshot.layers[0].window.x = 1300
	t.eq(M.reconcile(base, base, snapshot, []).layers[0].window.x, 1300, "an error snapshot shows the device's real layout")


func test_undo_stack() -> void:
	var s := _state()
	var stack := M.new_stack()
	t.eq(M.step(stack, M.geometry(s)), [], "nothing to undo")
	M.remember(stack, M.geometry(s))
	s.layers[0].window.x = 10
	var back := M.step(stack, M.geometry(s))
	M.restore(s, back)
	t.eq(s.layers[0].window.x, 1215, "undo")
	M.restore(s, M.step(stack, M.geometry(s), true))
	t.eq(s.layers[0].window.x, 10, "redo")
	M.remember(stack, M.geometry(s))
	t.eq(stack.redo, [], "a new edit clears redo")
	for i in 150:
		M.remember(stack, [])
	t.eq(stack.undo.size(), 100, "100 steps kept")


func test_restore_brings_back_locks() -> void:
	var s := _state()
	var g := M.geometry(s)
	s.layers[2].aspectLock = null
	s.layers[2].window = _w(0, 0, 64, 64)
	M.restore(s, g)
	t.eq(s.layers[2].aspectLock, 3.0, "lock restored")
	t.eq(s.layers[2].window, _w(24, 21, 1131, 401), "window restored")


func test_edit_rules() -> void:
	var s := _state()
	var scr := M.screen_of(s, 7)
	var l: Dictionary = s.layers[1]
	t.eq(M.edit(s, l, scr, l.window.duplicate()), {}, "same window: nothing")
	t.eq(M.edit(s, l, scr, _w(1620, 4, 258, 169)), {"window": _w(1620, 4, 258, 169)}, "free move")
	t.eq(M.edit(s, l, scr, _w(1300, 30, 258, 169)).get("error"), "MVR windows cannot overlap. Choose a smaller size or a free position.", "overlap refused")
	t.eq(M.edit(s, l, scr, _w(1800, 4, 258, 169)), {"window": _w(1662, 4, 258, 169)}, "kept inside the output (fit)")
	var grown := M.edit(s, l, scr, _w(1300, 500, 700, 500))
	t.eq(grown.window, _w(1220, 500, 512, 480), "fitted first (x 1220), then shrunk to 512 × 480")
	t.ok(str(grown.notice).begins_with("Input windows are limited to 512 × 480 on P20 (glitch-free size). Resized to 512 × 480."), "notice")
	var locked: Dictionary = s.layers[0]
	t.eq(M.edit(s, locked, scr, _w(1215, 22, 380, 249)).get("error"), "This size cannot fit while keeping the locked aspect ratio.", "lock")
	t.eq(M.edit(s, locked, scr, _w(1215, 300, 400, 249)), {"window": _w(1215, 300, 400, 249)}, "a locked window still moves")
	t.eq(M.edit(s, {}, scr, _w(0, 0, 100, 100)), {}, "nothing selected")


func test_numeric_fields() -> void:
	var s := _state()
	var scr := M.screen_of(s, 7)
	t.eq(M.numeric(s, s.layers[1], scr, "x", "abc"), {"error": "Enter a whole number of pixels."}, "garbage")
	t.eq(M.numeric(s, s.layers[1], scr, "x", ""), {"error": "Enter a whole number of pixels."}, "empty")
	t.eq(M.numeric(s, s.layers[1], scr, "y", "300").window, _w(1641, 300, 258, 169), "unlocked: one key")
	var w: Dictionary = M.numeric(s, s.layers[0], scr, "width", "320").window
	t.eq(w, _w(1215, 22, 320, 204), "locked width → content 180 + 24")
	t.eq(M.numeric(s, s.layers[0], scr, "height", "204").window, _w(1215, 22, 320, 204), "locked height → width")
	t.eq(M.numeric(s, s.layers[0], scr, "width", "10").window, _w(1215, 22, 72, 65), "at least the minimum")
	var pgm: Dictionary = s.layers[2]
	pgm.window = _w(1856, 0, 64, 64)
	t.eq(M.numeric(s, pgm, scr, "width", "2000").get("error"), "No room for this locked aspect ratio at the minimum window size.", "")


func test_center_and_nudge() -> void:
	var scr := {"width": 1920, "height": 1080}
	t.eq(M.center_x(_w(5, 5, 401, 100), scr), _w(760, 5, 401, 100), "Center X rounds like JS")
	t.eq(M.center_y(_w(5, 5, 100, 249), scr), _w(5, 416, 100, 249), "Center Y")
	t.eq(M.nudge(_w(5, 5, 100, 100), Vector2i(-1, 0), false), _w(4, 5, 100, 100), "1 px")
	t.eq(M.nudge(_w(5, 5, 100, 100), Vector2i(0, 1), true), _w(5, 15, 100, 100), "Shift = 10 px")


func test_drag_limit() -> void:
	t.eq(M.drag_limit({}, _w(0, 0, 600, 300)), {}, "none")
	t.eq(M.drag_limit({"width": 512, "height": 480}, _w(0, 0, 600, 300)), {"width": 600, "height": 480}, "an oversized window may only shrink")


func test_aspect_toggle() -> void:
	var s := _state()
	t.eq(M.aspect_toggle(s.layers[1], true), {"aspectLock": 258.0 / 145.0, "aspectMode": 5}, "content ratio without the strip")
	t.eq(M.aspect_toggle(s.layers[0], false), {"aspectLock": null, "aspectMode": 5}, "unlock")
	var unknown: Dictionary = s.layers[1].duplicate(true)
	unknown.umdHeight = null
	t.ok(str(M.aspect_toggle(unknown, true).get("error", "")).begins_with("UMD height is unavailable."), "unknown UMD refuses a lock")
	t.eq(M.aspect_toggle(unknown, false).aspectLock, null, "but unlocking is fine")


func test_request_bodies() -> void:
	var s := _state()
	var base := s.duplicate(true)
	s.layers[1].window.x = 1600
	var body := M.windows_body(M.changes(s, base))
	t.eq(body, {"changes": [{"id": 121831425, "window": _w(1600, 4, 258, 169), "aspectLock": null, "aspectMode": 5}]}, "PUT /api/windows")
	t.ok(not body.has("session"), "the server adds the session")
	t.eq(typeof(body.changes[0].window.width), TYPE_INT, "integers (Number.isSafeInteger)")
	t.eq(M.create_body(7, s.sources[3], _w(0, 0, 400, 157)), {"screenId": 7, "action": "create", "source": {"type": 2, "id": 40}, "window": _w(0, 0, 400, 157)}, "create")
	t.eq(M.source_body(7, 121831425, "2:40"), {"screenId": 7, "action": "source", "layerId": 121831425, "source": {"type": 2, "id": 40}}, "replace source")
	t.eq(M.delete_body(7, 121831425), {"screenId": 7, "action": "delete", "layerId": 121831425}, "delete")
	t.eq(M.template_body(7, "1:4"), {"screenId": 7, "templateId": 4, "type": 1, "confirmReplace": true}, "device layout")
	t.eq(M.parse_key("3:1"), {"type": 3, "id": 1}, "key")
	t.eq(M.find_source(s, "2:40").name, "Input 6-DP 1.2", "find source")


func test_add_source() -> void:
	var s := _state()
	var r := M.add_source(s, 7, M.find_source(s, "2:40"), Vector2(200, 700))
	t.eq(r.body.action, "create", "create")
	t.eq(r.body.window, {"x": 0, "y": 608, "width": 480, "height": 184}, "3:1 input under the 512 limit, near the drop point")
	t.eq(r.success, "Input 6-DP 1.2 added to the MVR.", "message")
	t.ok(str(M.add_source(s, 7, M.find_source(s, "4:1")).get("error", "")).begins_with("UMD height is unavailable."), "unknown UMD")
	t.eq(M.add_source(s, 99, M.find_source(s, "2:40")).get("error"), "Choose a current MVR output.", "no output")


func test_labels() -> void:
	var s := _state()
	t.eq(M.source_label(s.layers[2]), "Screen 1 PGM", "PGM suffix")
	t.eq(M.source_label({"source": "Screen 1", "sourceType": 4}), "Screen 1 PVW", "PVW suffix")
	t.eq(M.row_label({"source": "", "sourceType": 2, "name": "Layer9"}), "Layer9", "name when there is no source")
	t.eq(M.size_label(_w(0, 0, 400, 249)), "400 × 249", "size")
	t.eq(M.source_meta(s.sources[0]), "In MVR", "used")
	t.eq(M.source_meta(s.sources[3]), "3072 × 1024", "resolution")
	t.eq(M.source_meta({"usedBy": null, "width": null}), "No signal", "no signal")
	t.eq(M.dirty_label(true, true, 3), "Not saved", "error first")
	t.eq(M.dirty_label(false, true, 3), "Saving…", "saving")
	t.eq(M.dirty_label(false, false, 2), "Waiting to save…", "pending")
	t.eq(M.dirty_label(false, false, 0), "Saved · changes send automatically", "clean")
	t.eq(M.aspect_info(s.layers[0], s.signals), "Input 1920 × 1080 · UMD 24 px · Content ratio locked", "info")
	t.eq(M.aspect_info(s.layers[2], s.signals), "Screen 3072 × 1024 · UMD 24 px · Content ratio locked", "screen info")
	t.eq(M.aspect_info({"sourceType": 2, "sourceId": 99, "umdHeight": null, "aspectLock": null}, s.signals), "UMD height unavailable", "unknown")


func test_source_options() -> void:
	var s := _state()
	var o := M.source_options(s.sources, s.layers[0])
	t.eq(o.items, [["Input 1-DP 1.2", "2:25"], ["Input 6-DP 1.2", "2:40"], ["Screen 1 PVW", "4:1"]], "own source + unused ones")
	t.eq(o.index, 0, "current selected")
	var gone := M.source_options(s.sources, {"id": 5, "source": "Old input", "sourceType": 2, "sourceId": 77})
	t.eq(gone.items[0], ["Old input", ""], "missing current source shown first")
	t.eq(gone.index, 0, "and selected")


func test_templates_from_the_p20() -> void:
	var data := {"session": "x", "supported": true, "templates": [{"id": 0.0, "type": 1.0, "windows": 14.0, "label": "Layout 0 · 14 windows"},
		{"id": 4.0, "type": 1.0, "windows": 16.0, "label": "Layout 4 · 16 windows"}]}
	t.eq(M.template_items(data), [["Layout 0 · 14 windows", "1:0"], ["Layout 4 · 16 windows", "1:4"]], "items")
	t.eq(M.template_items({"supported": false, "templates": []}), [], "none")


func test_fix_stale() -> void:
	var s := _state()
	var base := s.duplicate(true)
	t.ok(not M.fix_stale(s.duplicate(true), s, base, 7), "unchanged")
	var moved := s.duplicate(true)
	moved.layers[0].window.x = 0
	t.ok(M.fix_stale(moved, s, base, 7), "device moved a window")
	var resession := s.duplicate(true)
	resession.session = "other"
	t.ok(M.fix_stale(resession, s, base, 7), "connection changed")
	var swapped := s.duplicate(true)
	swapped.layers[1].sourceId = 40
	t.ok(M.fix_stale(swapped, s, base, 7), "source changed")
	var local := s.duplicate(true)
	local.layers[0].window.x = 0  # a local (saved-later) edit is not staleness
	t.ok(not M.fix_stale(s.duplicate(true), local, base, 7), "compares with the confirmed base")


func test_fix_notice() -> void:
	t.eq(M.fix_notice({"fixed": [1, 2], "skipped": [{"id": 3, "reason": "No free space for this ratio at the 64 px minimum"}]}),
		"Fixed and locked 2 input/screen windows; 1 other windows unchanged. 1 cannot fit the 64 px minimum. Saving these changes automatically.", "fixed")
	t.eq(M.fix_notice({"fixed": [1], "skipped": [{"id": 3, "reason": "UMD height unavailable from device configuration"}]}),
		"Fixed and locked 1 input/screen windows; 1 other windows unchanged. Saving these changes automatically. Some windows were skipped because the device UMD height is unavailable.", "umd")
	t.eq(M.fix_notice({"fixed": [], "skipped": [{"id": 3, "reason": "No free space for this ratio at the 64 px minimum"}]}), "Source ratios cannot fit at the 64 px minimum. Make room first.", "too small")
	t.eq(M.fix_notice({"fixed": [], "skipped": []}), "No connected inputs or screen sources with usable resolution and UMD height were found.", "none")
