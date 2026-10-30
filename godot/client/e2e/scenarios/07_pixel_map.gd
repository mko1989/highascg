extends "res://e2e/e2e_scenario.gd"
## WO-807 — region → fixture pixel mapping, walked as the operator does it: Previs → Lighting → DMX output → "Pixel
## map…"; pick channel 1 (PGM) and see its picture; draw two regions on it (snapped, then typed exactly into x / y / w /
## h, one with maths); pick the PixelLine head; pixel 1 → region 1 (average, rgb), pixel 2 → region 2 (point, rgb);
## Save; the live swatches = GET /live = the DMX slots = the average re-computed from the channel frame = the ArtDMX
## packet on the wire; unmap both, Save → the project has no pixelMappings key.
## Needs tools/e2e/pixel-map-fixture.js (run-gui-e2e.js starts it for this scenario): the loopback-only copy of the MHP
## patch (every dest 127.0.0.1:6455, DMX master on for artnet:18) and a known picture on the sandbox's pgm1 surface.
## The wire check binds 127.0.0.1:6455 — nothing is ever sent to a broadcast address or to :6454.

const View := preload("res://features/previs/fixtures/pixel_map_view.gd")
const SLUG := "e2e_pixel_map"
const HEAD := "Pixel Line IP 1042"
const UNIVERSE := 18
const R1 := Rect2i(400, 300, 100, 200)
const R2 := Rect2i(1200, 500, 60, 40)
## Hand calc from the pattern (pixel-map-fixture.js): R1 = 50 px columns of (240,32,0) | (16,96,200) → the mean;
## R2's centre pixel ((1200+1260-1)>>1, (500+540-1)>>1) = (1229, 519) lies in the (255,255,0) marker.
const R1_AVG := [128, 64, 100]
const R2_POINT := [255, 255, 0]

var win: AcceptDialog
var view: Control
var fx := {}  # GET /api/fixtures/pixelmap/pixels entry of HEAD
var udp := PacketPeerUDP.new()
var wire := {}  # last ArtDMX data of UNIVERSE (PackedByteArray) under "data"
var live := {}  # last GET /live
var frame_avg := []  # computed here from the shm file
var frame_point := []


func _cm() -> Dictionary:
	var r: Dictionary = await api("/api/settings")
	var cm: Variant = r.data.get("channelMap") if r.get("data") is Dictionary else null
	return cm if cm is Dictionary else {}


## A control in the tree (visible, maybe scrolled out of view — the Inspector column scrolls) by its text.
func _in_tree(cls: String, text: String) -> Control:
	for c in ui.all(cls, null, false):
		if (c as Control).is_visible_in_tree() and ui.label_of(c) == text:
			return c
	return null


func _pixmap_button() -> Variant:
	return _in_tree("BaseButton", "Pixel map…")


func _ctl(cls: String, tip: String) -> Control:
	return ui.find(cls, tip, win)


## The row widgets of pixel n: {label, region, mode, order: OptionButton, swatch: ColorRect} or {}.
func _row(n: int) -> Dictionary:
	for l in ui.all("Label", win, false):
		if (l as Label).text == str(n) and (l as Label).tooltip_text.begins_with("Pixel %d ·" % n):
			var obs: Array = l.get_parent().get_children().filter(func(c: Node) -> bool: return c is OptionButton)
			var sw: Array = l.get_parent().get_children().filter(func(c: Node) -> bool: return c is ColorRect)
			if obs.size() >= 3 and sw.size() >= 1:
				return {"label": l, "region": obs[0], "mode": obs[1], "order": obs[2], "swatch": sw[0]}
	return {}


func _row_count() -> int:
	return ui.all("Label", win, false).filter(func(l: Label) -> bool:
		return l.text.is_valid_int() and l.tooltip_text.begins_with("Pixel %s ·" % l.text)).size()


func _fields() -> Rect2i:
	var v := func(tip: String) -> int: return int((_ctl("SpinBox", tip) as SpinBox).value)
	return Rect2i(v.call("Left edge in channel pixels"), v.call("Top edge in channel pixels"),
		v.call("Width in channel pixels"), v.call("Height in channel pixels"))


## Channel pixel → root-viewport point inside the picture.
func _at(p: Vector2) -> Vector2:
	var r: Rect2 = ui.screen_rect(view)
	var sc := view.get_global_transform_with_canvas().get_scale()
	return r.position + (view.call("to_view", p) as Vector2) * sc


## Draw a region by dragging over `approx` (a little outside `want`), check the snapped rect the fields show, then
## type the exact numbers like an operator (x as maths: RULES.md 2).
func _draw_region(want: Rect2i, label: String) -> String:
	var a := Vector2(want.position) - Vector2(6, 6)
	var b := Vector2(want.end) + Vector2(6, 6)
	var why: String = await ui.press_drag(view, _at(a), _at(b))
	if why != "":
		return why
	var got := _fields()
	var title: Label = ui.find("Label", label + " ·", win, false)
	if title == null:
		return "no %s after the drag (fields %s)" % [label, got]
	if absi(got.position.x - int(a.x)) > 4 or absi(got.position.y - int(a.y)) > 4 or absi(got.end.x - int(b.x)) > 4 or absi(got.end.y - int(b.y)) > 4:
		return "the drawn rect %s is not the dragged %s → %s (snapped to channel pixels)" % [got, a, b]
	print("[e2e] drew %s: fields %d,%d %d×%d" % [label, got.position.x, got.position.y, got.size.x, got.size.y])
	for k in [["Left edge in channel pixels", "%d/2" % (want.position.x * 2)], ["Top edge in channel pixels", str(want.position.y)],
			["Width in channel pixels", str(want.size.x)], ["Height in channel pixels", str(want.size.y)]]:
		why = await ui.type_into(_ctl("SpinBox", k[0]), k[1])
		if why != "":
			return why
	got = _fields()
	if got != want:
		return "fields show %s after typing, want %s" % [got, want]
	var t := "%s · %d × %d px at %d, %d" % [label, want.size.x, want.size.y, want.position.x, want.position.y]
	return expect(title.text.begins_with(t), "region title %s, want %s…" % [title.text, t])


func _pick(ob: OptionButton, text: String) -> String:
	if ob == null:
		return "row control missing"
	await ui.reveal(ob)
	var why: String = await ui.choose(ob, text)
	if why == "" and ob.get_item_text(ob.selected) != text:
		why = "%s shows %s after picking %s" % [ob.tooltip_text.left(30), ob.get_item_text(ob.selected), text]
	return why


func _map_row(n: int, region: String, mode: String, order: String) -> String:
	for k in [["region", region], ["mode", mode], ["order", order]]:
		var why := await _pick(_row(n).get(k[0]), k[1])
		if why != "":
			return "pixel %d %s: %s" % [n, k[0], why]
	return ""


## Drain 127.0.0.1:6455: the newest ArtDMX packet of UNIVERSE → wire.data.
func _drain() -> void:
	while udp.get_available_packet_count() > 0:
		var p := udp.get_packet()
		if p.size() > 18 and p.slice(0, 8).get_string_from_ascii() == "Art-Net" and p.decode_u16(8) == 0x5000 and (p[14] | (p[15] << 8)) == UNIVERSE:
			wire["data"] = p.slice(18, 18 + ((p[16] << 8) | p[17]))
			wire["n"] = int(wire.get("n", 0)) + 1


## Re-average R1 and read R2's centre from the pgm1 segment file the sandbox announces (HASCGSHM v1, BGRA).
func _frame_check() -> String:
	var r: Dictionary = await api("/api/video-surfaces")
	var path := ""
	for s in (r.data.get("surfaces", []) if r.get("data") is Dictionary else []):
		if s.get("role") == "pgm1":
			path = str(s.get("path", ""))
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return "cannot read the pgm1 segment %s" % path
	f.seek(16)
	var w := f.get_32()
	f.seek(24)
	var stride := f.get_32()
	f.seek(96)
	var slot := int(f.get_64() & 0xff)
	f.seek(48 + 8 * slot)
	var base := f.get_64() + 4096
	var sum := [0, 0, 0]
	for y in range(R1.position.y, R1.end.y):
		f.seek(base + y * stride + R1.position.x * 4)
		var row := f.get_buffer(R1.size.x * 4)
		for i in range(0, row.size(), 4):
			sum[0] += row[i + 2]
			sum[1] += row[i + 1]
			sum[2] += row[i]
	var n := R1.size.x * R1.size.y
	frame_avg = [roundi(float(sum[0]) / n), roundi(float(sum[1]) / n), roundi(float(sum[2]) / n)]
	var c := Vector2i((R2.position.x + R2.end.x - 1) >> 1, (R2.position.y + R2.end.y - 1) >> 1)
	f.seek(base + c.y * stride + c.x * 4)
	var px := f.get_buffer(4)
	frame_point = [px[2], px[1], px[0]]
	print("[e2e] frame %dpx wide: R1 average %s, R2 centre %s %s" % [w, frame_avg, c, frame_point])
	return ""


## JSON numbers arrive as floats: compare as ints, nested.
static func _norm(v: Variant) -> Variant:
	if v is Array:
		return (v as Array).map(func(x: Variant) -> Variant: return _norm(x))
	return int(v) if v is float or v is int else v


static func _rgb(c: Color) -> Array:
	return [c.r8, c.g8, c.b8]


static func _dmx(m: Dictionary) -> Array:
	return (m.get("dmx", []) as Array).map(func(d: Dictionary) -> Array: return [int(d.slot), int(d.value)])


func _live_ok(d: Variant) -> bool:
	if not (d is Dictionary):
		return false
	live = d
	var ms: Array = d.get("mappings", [])
	return ms.size() == 2 and ms.all(func(m: Dictionary) -> bool: return m.get("on_wire") == true and m.get("rgb") is Array)


func run() -> void:
	await step("Setup: PGM/PRV screen + the loopback MHP patch", func() -> String:
		# Setup, not under test: run-gui-e2e.js seeds one PGM/PRV screen before the sandbox boots (pixel-map-fixture.js
		# sandboxConfig — the simulated Caspar reports channel rasters only at connect, so a screen added now has none).
		var why := await await_api("/api/settings", func(d: Variant) -> bool:
			return JSON.stringify(d.get("channelMap", {}).get("channelResolutionsByChannel", {})).contains("\"1\""), "no channel 1 raster", 15.0)
		if why != "":
			var cm1 := await _cm()
			return "no channel 1 raster (run via tools/e2e/run-gui-e2e.js, which seeds the screen): pgm %s res %s" % [
				cm1.get("programChannels"), cm1.get("channelResolutionsByChannel")]
		var res: Dictionary = await post("/api/project/load", {"slug": SLUG, "broadcastProject": true})
		if not res.ok:
			return "load %s: %s" % [SLUG, res.error]
		why = await await_api("/api/fixtures/pixelmap/pixels", func(d: Variant) -> bool:
			for f in (d.get("fixtures", []) if d is Dictionary else []):
				if f.get("name") == HEAD:
					fx = f
			return not fx.is_empty(), HEAD + " not in the sandbox patch", 15.0)
		if why != "":
			return why
		if udp.bind(6455, "127.0.0.1") != OK:
			return "cannot listen on 127.0.0.1:6455 (another loopback test running?)"
		print("[e2e] %s: %s U%d @%d, %d pixels, pixel 1 slots %s" % [HEAD, fx.id, int(fx.universe), int(fx.address), fx.pixels.size(), fx.pixels[0].slots])
		return expect(int(fx.universe) == UNIVERSE, "%s is on universe %s, the sandbox sends %d" % [HEAD, fx.universe, UNIVERSE])
	)
	await step("Open Previs → Lighting → DMX output → Pixel map…", func() -> String:
		await ui.tab("Previs")
		var b3d: BaseButton = ui.button("3D")
		if b3d != null and not b3d.button_pressed:
			await ui.click(b3d)
		var btn: BaseButton = await ui.wait_for(_pixmap_button, 10.0)
		for fold in ["▸ Lighting", "▸ DMX output"]:  # a fold closed in this client's ui.cfg
			var f: Control = _in_tree("BaseButton", fold)
			if btn == null and f != null:
				await ui.reveal(f)
				await ui.click(f)
				btn = await ui.wait_for(_pixmap_button, 3.0)
		if btn == null:
			return "no \"Pixel map…\" button in the Previs Inspector"
		await ui.reveal(btn)
		var why: String = await ui.click(btn)
		if why != "":
			return why
		win = await ui.wait_for(func() -> Variant:
			for w in ui.root.find_children("*", "AcceptDialog", true, false):
				if (w as Window).visible and (w as Window).title.begins_with("Pixel map"):
					return w
			return null, 5.0)
		if win == null:
			return "the Pixel map window did not open"
		var vs: Array = win.find_children("*", "Control", true, false).filter(func(c: Node) -> bool: return c.get_script() == View)
		view = vs[0] if not vs.is_empty() else null
		if win.size.y > ui.vp().get_visible_rect().size.y or win.position.y < 0:
			return "the window (%s at %s) does not fit the %s screen" % [win.size, win.position, ui.vp().get_visible_rect().size]
		return expect(view != null and ui.shown(view), "the window has no picture view")
	)
	await step("Pick channel 1 (PGM): the picture shows", func() -> String:
		var ob: OptionButton = _ctl("OptionButton", "The Caspar channel whose output the regions sample")
		# the window fills its channel list after two API round trips (reload()): an immediate pick saw an empty list (~1 run in 2)
		await ui.wait_for(func() -> bool: return ob != null and ob.item_count > 0, 10.0)
		var why: String = await ui.choose(ob, "Channel 1 (Program 1) · 1920×1080")
		if why != "":
			return why
		if str(view.get("role")) != "pgm1" or view.get("raster") != Vector2i(1920, 1080):
			return "the view shows %s %s, want pgm1 1920×1080" % [view.get("role"), view.get("raster")]
		var tex: Texture2D = await ui.wait_for(func() -> Variant:
			var t := VideoSurfaces.texture("pgm1")
			return t if t != null and t.get_width() > 1 else null, 15.0)
		if tex == null:
			return "no picture from pgm1 within 15 s (feed)"
		var img := tex.get_image()
		var probe := func(p: Vector2i) -> Array:
			return _rgb(img.get_pixel(p.x * img.get_width() / 1920, p.y * img.get_height() / 1080))
		for want in [[Vector2i(420, 400), [240, 32, 0]], [Vector2i(480, 400), [16, 96, 200]], [Vector2i(1210, 510), [0, 180, 90]], [Vector2i(100, 100), [20, 24, 32]]]:
			var got: Array = probe.call(want[0])
			for i in 3:
				if absi(got[i] - want[1][i]) > 40:
					return "picture at %s is %s, the pattern has %s (JPEG ± 40)" % [want[0], got, want[1]]
		print("[e2e] pgm1 picture %d×%d matches the pattern at 4 probes" % [img.get_width(), img.get_height()])
		return ""
	)
	await step("Draw region 1 (100 × 200 at 400,300) and region 2 (60 × 40 at 1200,500)", func() -> String:
		var why := await _draw_region(R1, "R1")
		if why == "":
			why = await _draw_region(R2, "R2")
		return why
	)
	await step("Pick the PixelLine head", func() -> String:
		var ob: OptionButton = _ctl("OptionButton", "A patched fixture with colour pixels (a head selected in the 3D view is picked on open)")
		var label := "%s · U%d.%03d · %d px" % [HEAD, int(fx.universe), int(fx.address), (fx.pixels as Array).size()]
		var why: String = await ui.choose(ob, label)
		if why != "":
			return why
		await ui.frames(3)
		var n := _row_count()
		return expect(n == (fx.pixels as Array).size(), "%d pixel rows shown, the head has %d" % [n, (fx.pixels as Array).size()])
	)
	await step("Pixel list: 1 → R1 average rgb, 2 → R2 point rgb", func() -> String:
		var why := await _map_row(1, "R1 · 100 × 200 px", "average", "rgb")
		if why == "":
			why = await _map_row(2, "R2 · 60 × 40 px", "point", "rgb")
		if why != "":
			return why
		var r1 := _row(1)
		var r2 := _row(2)
		var shows := [r1.region.text, r1.mode.text, r1.order.text, r2.region.text, r2.mode.text, r2.order.text]
		if shows != ["R1 · 100 × 200 px", "average", "rgb", "R2 · 60 × 40 px", "point", "rgb"]:
			return "rows show %s" % [shows]
		if _row(3).is_empty() or _row(3).region.text != "—":
			return "pixel 3 should stay unmapped, shows %s" % str(_row(3).get("region", null))
		return expect(ui.button("Save *", win) != null, "Save does not show unsaved changes (Save *)")
	)
	await step("Save → the server keeps the 2 mappings", func() -> String:
		var why: String = await ui.click(ui.button("Save *", win))
		if why != "":
			return why
		var note: Label = await ui.await_control("Label", "Saved 2 mapping(s).", win, 8.0)
		if note == null or ui.button("Save", win) == null:
			return "no \"Saved 2 mapping(s).\" / Save still dirty"
		return await await_api("/api/fixtures/pixelmap", func(d: Variant) -> bool:
			var ms: Array = d.get("mappings", []) if d is Dictionary else []
			var want := [[1, R1, "average"], [2, R2, "point"]]
			if ms.size() != 2:
				return false
			for i in 2:
				var m: Dictionary = ms[i]
				var rc: Dictionary = m.get("rect", {})
				if m.fixtureId != fx.id or int(m.pixel) != want[i][0] or int(m.channelNo) != 1 or m.mode != want[i][2] \
						or str(m.colourOrder).to_lower() != "rgb" or Rect2i(int(rc.x), int(rc.y), int(rc.w), int(rc.h)) != want[i][1]:
					return false
			return true, "stored mappings differ from what the window shows")
	)
	await step("Live: swatches = /live = DMX slots = frame average = ArtDMX on 127.0.0.1:6455", func() -> String:
		var why := await await_api("/api/fixtures/pixelmap/live", _live_ok, "the 2 mappings are not on the wire with a colour", 10.0)
		if why != "":
			return why
		var ms: Array = live.mappings
		var by := {1: ms.filter(func(m: Dictionary) -> bool: return int(m.pixel) == 1)[0], 2: ms.filter(func(m: Dictionary) -> bool: return int(m.pixel) == 2)[0]}
		why = await _frame_check()
		if why != "":
			return why
		var p1: Array = _norm(fx.pixels[0].slots)
		var p2: Array = _norm(fx.pixels[1].slots)
		var checks := [
			[by[1].rgb, R1_AVG, "pixel 1 /live rgb vs hand calc"], [by[2].rgb, R2_POINT, "pixel 2 /live rgb vs hand calc"],
			[by[1].rgb, frame_avg, "pixel 1 /live rgb vs the frame's R1 average"], [by[2].rgb, frame_point, "pixel 2 /live rgb vs the frame's R2 centre"],
			[by[1].slots, p1, "pixel 1 slots vs the patch"], [by[2].slots, p2, "pixel 2 slots vs the patch"],
			[_dmx(by[1]), [[p1[0], R1_AVG[0]], [p1[1], R1_AVG[1]], [p1[2], R1_AVG[2]]], "pixel 1 DMX"],
			[_dmx(by[2]), [[p2[0], R2_POINT[0]], [p2[1], R2_POINT[1]], [p2[2], R2_POINT[2]]], "pixel 2 DMX"]]
		for c in checks:
			if _norm(c[0]) != _norm(c[1]):
				return "%s: %s ≠ %s" % [c[2], c[0], c[1]]
		var sw: Variant = await ui.wait_for(func() -> bool:
			return not _row(2).is_empty() and _rgb(_row(1).swatch.color) == R1_AVG and _rgb(_row(2).swatch.color) == R2_POINT, 4.0)
		if not sw:
			return "swatches show %s / %s, /live has %s / %s" % [_rgb(_row(1).swatch.color), _rgb(_row(2).swatch.color), by[1].rgb, by[2].rgb]
		if not str(_row(1).swatch.tooltip_text).contains("on the wire"):
			return "pixel 1 swatch tooltip: %s" % _row(1).swatch.tooltip_text
		var got: Variant = await ui.wait_for(func() -> bool:
			_drain()
			var d: PackedByteArray = wire.get("data", PackedByteArray())
			return d.size() >= p2[2] and Array(d.slice(p1[0] - 1, p1[0] + 2)) == R1_AVG and Array(d.slice(p2[0] - 1, p2[0] + 2)) == R2_POINT, 4.0)
		var d: PackedByteArray = wire.get("data", PackedByteArray())
		if not got:
			return "ArtDMX u%d on 127.0.0.1:6455 (%d packets): slots %s = %s, want %s %s" % [UNIVERSE, int(wire.get("n", 0)), p1,
				Array(d.slice(p1[0] - 1, p2[2])) if d.size() >= p2[2] else "—", R1_AVG, R2_POINT]
		print("[e2e] DMX u%d: %d-%d = %s, %d-%d = %s; /live %s %s; frame %s %s; swatches %s %s; %d ArtDMX packets" % [UNIVERSE,
			p1[0], p1[2], Array(d.slice(p1[0] - 1, p1[0] + 2)), p2[0], p2[2], Array(d.slice(p2[0] - 1, p2[0] + 2)), by[1].rgb, by[2].rgb,
			frame_avg, frame_point, _rgb(_row(1).swatch.color), _rgb(_row(2).swatch.color), int(wire.get("n", 0))])
		return ""
	)
	await step("Unmap both, Save → no pixelMappings in the project", func() -> String:
		for n in [1, 2]:
			var why := await _pick(_row(n).get("region"), "—")
			if why != "":
				return "pixel %d: %s" % [n, why]
		var why: String = await ui.click(ui.button("Save *", win))
		if why != "":
			return why
		if await ui.await_control("Label", "Saved 0 mapping(s).", win, 8.0) == null:
			return "no \"Saved 0 mapping(s).\""
		why = await await_api("/api/fixtures/pixelmap", func(d: Variant) -> bool:
			return d is Dictionary and (d.get("mappings", [1]) as Array).is_empty(), "mappings still stored")
		if why != "":
			return why
		why = await await_api("/api/project", func(d: Variant) -> bool:
			var p: Variant = d.get("project", d) if d is Dictionary else null
			return p is Dictionary and p.get("fixtures") is Dictionary and not (p as Dictionary).has("pixelMappings"), "the project still has pixelMappings")
		if why != "":
			return why
		return await await_api("/api/fixtures/pixelmap/live", func(d: Variant) -> bool:
			return d is Dictionary and (d.get("mappings", [1]) as Array).is_empty() and (d.get("channels", [1]) as Array).is_empty(),
			"/live still samples a channel")
	)
	udp.close()
	if win != null and is_instance_valid(win) and win.visible:
		await ui.click(ui.button("Close", win))
