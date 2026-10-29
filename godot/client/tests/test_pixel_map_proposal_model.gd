extends RefCounted
## WO-807 automatic edge proposal — pixel_map_proposal_model.gd: parsing GET /api/fixtures/pixelmap/proposal, the
## state and the Pixel map button's tooltip line, the per-wall grouping and row text, strips, notes.

const PM := preload("res://features/previs/fixtures/pixel_map_proposal_model.gd")
var t

const WALLS := [
	{"id": "led_wall_1", "name": "LED wall 1", "channelNo": 1.0, "rect": {"x": 0.0, "y": 0.0, "w": 1024.0, "h": 1792.0},
		"size_m": [4.0, 7.0], "notes": []},
	{"id": "led_wall_3", "name": "LED wall 3", "channelNo": 1.0, "rect": {"x": 2816.0, "y": 0.0, "w": 1024.0, "h": 1792.0},
		"size_m": [4.0, 7.0], "notes": []},
]
const FX_A := {"fixtureId": "mvr-a", "name": "Pixel Line IP 1042", "pixels": 16.0, "wall": "led_wall_3", "wallName": "LED wall 3",
	"channelNo": 1.0, "edge": "left", "distance_m": 0.265, "mapped": true, "rule": "gdtf", "spacing_m": 0.062,
	"spacing_px": 16.0, "inset_px": 50.0, "depth_px": 40.0, "off_edge": 0.0,
	"rects": [{"x": 2866.0, "y": 1537.0, "w": 40.0, "h": 16.0}, {"x": 2866.0, "y": 1552.0, "w": 40.0, "h": 16.0}], "warning": null}
const FX_B := {"fixtureId": "mvr-b", "name": "Pixel Line IP 99", "pixels": 16.0, "wall": "led_wall_3", "channelNo": 1.0,
	"edge": "left", "distance_m": 0.07, "mapped": true, "spacing_m": 0.062, "spacing_px": 16.0,
	"rects": [{"x": 2866.0, "y": 0.0, "w": 40.0, "h": 16.0}], "warning": "2 pixel(s) lie past the end of the left edge — clamped to the wall"}
const FX_C := {"fixtureId": "mvr-c", "name": "Pixel Line IP 7", "pixels": 16.0, "wall": "led_wall_1", "channelNo": 1.0,
	"edge": "right", "distance_m": 0.1, "mapped": true, "spacing_m": 0.062, "spacing_px": 16.0,
	"rects": [{"x": 934.0, "y": 100.0, "w": 40.0, "h": 16.0}], "warning": null}
const FX_FAR := {"fixtureId": "mvr-d", "name": "Far bar", "pixels": 8.0, "wall": "led_wall_1", "edge": "top",
	"distance_m": 3.2, "mapped": false, "warning": "nearest edge (LED wall 1 top) is 3.2 m away, beyond 1.5 m — not mapped"}
const FX_NOWALL := {"fixtureId": "mvr-e", "name": "Lost bar", "pixels": 8.0, "mapped": false,
	"warning": "no LED wall bound to a running channel — not mapped"}


static func _resp(pending: bool, applied: bool) -> Dictionary:
	var maps: Array = []
	for i in 4:
		maps.append({"id": "auto-%d" % i})
	return {"ok": true, "pending": pending, "applied": applied, "at": "2026-10-29T13:29:17.896Z",
		"params": {"inset_px": 50.0, "depth_px": 40.0, "threshold_m": 1.5, "mode": "average"},
		"walls": WALLS, "fixtures": [FX_A, FX_B, FX_C, FX_FAR, FX_NOWALL], "mappings": maps, "mapped": 3.0,
		"out_of_range": 1.0, "walls_skipped": [{"id": "led_wall_9", "name": "LED wall 9", "reason": "channel 7 is not running in Caspar"}],
		"last": null, "sig": "abc"}


func test_parse_and_state() -> void:
	var p := PM.parse(_resp(true, false))
	t.eq([p.ok, p.pending, p.applied, p.mappings, p.mapped, p.out_of_range], [true, true, false, 4, 3, 1])
	t.eq(p.params, {"inset_px": 50, "depth_px": 40, "threshold_m": 1.5, "mode": "average"}, "params as numbers")
	t.eq((p.walls as Array).size(), 2)
	t.eq(PM.state(p), "pending")
	t.eq(PM.state(PM.parse(_resp(false, true))), "applied", "the live box: mapped and applied")
	t.eq(PM.state(PM.parse(_resp(true, true))), "applied", "applied wins over a stale pending flag")
	t.eq(PM.state(PM.parse(_resp(false, false))), "available", "computable, neither pending nor applied")
	t.eq(PM.state(PM.parse({"ok": true, "pending": false, "applied": false, "mappings": [], "fixtures": []})), "none",
		"no MVR / no wall: nothing to propose")
	t.eq(PM.state(PM.parse(null)), "none", "a failed request")
	t.eq(PM.state(PM.parse({"ok": false, "error": "fixture engine not running"})), "none")
	t.eq(PM.parse({"ok": false, "error": "fixture engine not running"}).error, "fixture engine not running")
	var bare := PM.parse({"ok": true, "fixtures": [FX_A, FX_FAR], "mappings": [{}]})
	t.eq([bare.mapped, bare.params.inset_px, bare.params.depth_px, bare.last_state], [1, 50, 40, ""], "defaults")
	t.eq(PM.parse({"ok": true, "last": {"state": "dismissed"}}).last_state, "dismissed")


func test_tooltip() -> void:
	t.eq(PM.tooltip_line(PM.parse(_resp(true, false))), "3 fixture mappings proposed (click to review)")
	t.eq(PM.tooltip_line(PM.parse(_resp(false, true))), "3 mappings applied from the automatic proposal (4 pixels)")
	var one := _resp(true, false)
	one.mapped = 1.0
	t.eq(PM.tooltip_line(PM.parse(one)), "1 fixture mapping proposed (click to review)", "singular")
	t.eq(PM.tooltip_line(PM.parse(null)), "", "no proposal: no line")
	var dis := _resp(false, false)
	dis.last = {"state": "dismissed"}
	t.ok(PM.tooltip_line(PM.parse(dis)).contains("dismissed earlier"), "available after a dismiss says so")
	t.eq(PM.button_tooltip("Base", PM.parse(null)), "Base", "hidden when there is no proposal")
	t.eq(PM.button_tooltip("Base", PM.parse(_resp(true, false))), "3 fixture mappings proposed (click to review)\n\nBase")


func test_summary_params_time() -> void:
	t.eq(PM.time_label("2026-10-29T13:29:17.896Z"), "2026-10-29 13:29 UTC")
	t.eq(PM.time_label(""), "")
	t.eq(PM.params_line(PM.parse(_resp(true, false))),
		"Inset 50 px from the edge · depth 40 px · fixtures within 1.5 m · average colour")
	t.eq(PM.summary(PM.parse(_resp(true, false))),
		"Proposed: 3 fixtures · 4 pixels · 2 LED walls · 1 out of range (computed 2026-10-29 13:29 UTC) — not applied yet")
	t.ok(PM.summary(PM.parse(_resp(false, true))).begins_with("Applied: 3 fixtures"))
	t.ok(PM.summary(PM.parse(null)).begins_with("No proposal"))
	t.eq(PM.summary(PM.parse({"ok": false, "error": "boom"})), "No proposal: boom")
	t.eq(PM.skipped_lines(PM.parse(_resp(true, false))), ["LED wall 9 skipped: channel 7 is not running in Caspar"])


func test_groups_and_rows() -> void:
	var g := PM.groups(PM.parse(_resp(true, false)))
	t.eq(g.size(), 3, "two walls + not mapped")
	t.eq(g[0].title, "LED wall 1 · channel 1 · 1024 × 1792 px at 0, 0 · 4 × 7 m")
	t.eq((g[0].fixtures as Array).map(func(f: Dictionary) -> String: return f.fixtureId), ["mvr-c"],
		"an out-of-range fixture is not listed under its nearest wall")
	t.eq((g[1].fixtures as Array).map(func(f: Dictionary) -> String: return f.name), ["Pixel Line IP 99", "Pixel Line IP 1042"],
		"natural order within an edge")
	t.eq(g[2].title, "Not mapped (2)")
	t.eq(g[2].wall, {})
	t.eq((g[2].fixtures as Array).size(), 2)
	t.eq(PM.groups(PM.parse(null)), [], "nothing to group")
	var addr := PM.addresses({"fixtures": [{"id": "mvr-a", "protocol": "artnet", "universe": 18.0, "address": 421.0},
		{"id": "mvr-s", "protocol": "sacn", "universe": 5.0, "address": 1.0}, {"id": "mvr-x"}]})
	t.eq(addr, {"mvr-a": "U18 @ 421", "mvr-s": "sACN 5 @ 1"}, "no universe: not listed")
	t.eq(PM.addresses(null), {})
	t.eq(PM.row_cells(FX_A, addr), ["Pixel Line IP 1042", "U18 @ 421", "left", "0.27 m", "16 px (0.062 m)", "2 / 16 px", ""])
	t.eq(PM.row_cells(FX_B, addr)[1], "—", "unknown address")
	t.ok(str(PM.row_cells(FX_B, addr)[6]).contains("clamped"), "the warning")
	t.eq(PM.row_cells(FX_FAR, {}), ["Far bar", "—", "top", "3.2 m", "—", "0 / 8 px", FX_FAR.warning])
	t.eq(PM.row_cells(FX_NOWALL, {})[2], "—", "no edge")


func test_strips_and_fit() -> void:
	var s := PM.strips(WALLS[1], [FX_A, FX_B])
	t.eq(s, [Rect2(50, 1537, 40, 16), Rect2(50, 1552, 40, 16), Rect2(50, 0, 40, 16)], "wall-local: x 2866 → 50 inside wall 3")
	t.eq(PM.strips(WALLS[0], [FX_FAR]), [], "no rects")
	var f := PM.fit(Vector2(1024, 1792), Vector2(150, 190))
	t.eq(snappedf(f.scale, 0.0001), snappedf(190.0 / 1792.0, 0.0001), "height-bound")
	t.eq(snappedf((f.offset as Vector2).x, 0.01), snappedf((150.0 - 1024.0 * 190.0 / 1792.0) * 0.5, 0.01), "centred")
	t.eq(PM.fit(Vector2.ZERO, Vector2(10, 10)).scale, 0.0)


func test_watch_key() -> void:
	var a := PM.watch_key({"previs": {"mvr": {"id": "m1"}}, "pixelMappings": [{}, {}],
		"pixelMappingProposal": {"state": "accepted", "sig": "s1", "at": "x"}})
	t.eq(a, "accepted/s1/x|m1|2")
	t.eq(PM.watch_key({}), "//|<null>|0")
	t.ok(PM.watch_key({"previs": {"mvr": {"id": "m2"}}, "pixelMappings": [{}, {}],
		"pixelMappingProposal": {"state": "accepted", "sig": "s1", "at": "x"}}) != a, "a new MVR")
	t.ok(PM.watch_key(null) == PM.watch_key({}))


func test_notes() -> void:
	t.eq(PM.accept_note({"ok": true, "data": {"ok": true, "accepted": 896.0, "kept": 0.0, "fixtures": 56.0}}),
		{"text": "Accepted: 896 pixel mappings for 56 fixtures saved.", "bad": false})
	t.eq(PM.accept_note({"ok": true, "data": {"accepted": 1.0, "kept": 2.0, "fixtures": 1.0}}).text,
		"Accepted: 1 pixel mapping for 1 fixture saved, 2 other mappings kept.")
	var bad := PM.accept_note({"ok": false, "error": "HTTP 400", "data": {"ok": false, "error": "invalid mappings",
		"errors": [{"index": 3.0, "error": "rect outside the raster"}]}})
	t.eq(bad, {"text": "Not accepted: invalid mappings (1 error, first: rect outside the raster)", "bad": true})
	t.eq(PM.accept_note({"ok": false, "error": "connection refused", "data": null}).text, "Not accepted: connection refused")
	t.eq(PM.dismiss_note({"ok": true, "data": {"dismissed": true}}).bad, false)
	t.eq(PM.dismiss_note({"ok": true, "data": {"dismissed": false}}).text, "Nothing pending to dismiss.")
	t.eq(PM.dismiss_note({"ok": false, "error": "HTTP 503"}), {"text": "Not dismissed: HTTP 503", "bad": true})
