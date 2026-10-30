extends RefCounted
## WO-836 part 3 — pixel probes for the release scenarios: numbers from a picture (a Caspar PRINT, or a screenshot of
## the client), and the PRINT round trip itself. Two rules from earlier misreads:
##  - a probe is only trusted once it has told a good frame from a bad one (`self_test`, and every air step checks the
##    black baseline AND the picture with the same probe);
##  - a crop past the frame is REFUSED, never clamped (ffmpeg clamps X when X+W > width and silently measures another place).
## PRINT frames are RGBA: a black channel prints with alpha 0, a picture with alpha 255 — both are reported.

const SMPTE := [[192, 192, 192], [192, 192, 0], [0, 192, 192], [0, 192, 0], [192, 0, 192], [192, 0, 0], [0, 0, 192]]
const NATIVE_X := [0.0906, 0.289, 0.505, 0.72, 0.914]
const NATIVE_COLS := [[192, 192, 0], [0, 192, 192], [0, 192, 0], [192, 0, 192], [192, 0, 0]]
const MAX_SAMPLES := 40000
const PRINT_NAME := "^\\d{8}T\\d{6}\\.png$"  # what Caspar's PRINT writes into the media root

var _last_print := 0


## {luma, nonblack, rgb:[r,g,b], alpha, alpha_nonzero, frame:Vector2i, rect:Rect2i} — or {error} when `rect` leaves the frame.
## `rect` = Rect2i() means the whole frame. nonblack = share of pixels whose max channel is > 16.
static func stats(img: Image, rect := Rect2i()) -> Dictionary:
	var frame := Vector2i(img.get_width(), img.get_height())
	var r := Rect2i(Vector2i.ZERO, frame) if rect.size == Vector2i.ZERO else rect
	if r.position.x < 0 or r.position.y < 0 or r.size.x <= 0 or r.size.y <= 0 or r.end.x > frame.x or r.end.y > frame.y:
		return {"error": "crop %s is outside the %dx%d frame (refused, not clamped)" % [r, frame.x, frame.y]}
	var step := maxi(1, int(ceil(sqrt(float(r.size.x * r.size.y) / MAX_SAMPLES))))
	var n := 0
	var sum := Vector3.ZERO
	var nonblack := 0
	var a_sum := 0.0
	var a_nz := 0
	for y in range(r.position.y, r.end.y, step):
		for x in range(r.position.x, r.end.x, step):
			var c := img.get_pixel(x, y)
			n += 1
			sum += Vector3(c.r, c.g, c.b) * 255.0
			if maxf(c.r, maxf(c.g, c.b)) * 255.0 > 16.0:
				nonblack += 1
			a_sum += c.a * 255.0
			if c.a > 0.0:
				a_nz += 1
	var m := sum / float(n)
	return {"luma": 0.299 * m.x + 0.587 * m.y + 0.114 * m.z, "nonblack": float(nonblack) / n, "rgb": [m.x, m.y, m.z],
		"alpha": a_sum / n, "alpha_nonzero": float(a_nz) / n, "frame": frame, "rect": r}


## "" when the frame shows the colours `cols` (RGB, ±40 per channel) at the horizontal fractions `xs`, on the band y = 25 % of
## the height, else what was seen. Probes the colour AND the geometry: a picture scaled or shifted differently fails.
static func bars_why(img: Image, xs: Array, cols: Array) -> String:
	var w := img.get_width()
	var h := img.get_height()
	var seen := []
	var bad := false
	for k in xs.size():
		var s := stats(img, Rect2i(int(xs[k] * w) - 8, int(h * 0.25) - 8, 16, 16))
		if s.has("error"):
			return s.error
		var rgb: Array = s.rgb
		seen.append("%d,%d,%d" % [rgb[0], rgb[1], rgb[2]])
		for i in 3:
			if absf(rgb[i] - cols[k][i]) > 40.0:
				bad = true
	return ("colours at %d probe points: %s (want %s)" % [xs.size(), " | ".join(seen), " | ".join(cols.map(func(c: Array) -> String: return "%d,%d,%d" % c))]) if bad else ""


## The still e2e_still.png (1920x1080 SMPTE bars) at contentFit "native" on a 1280x720 channel: unscaled and centred, so the
## channel shows the middle 1280 px of the still — yellow, cyan, green, magenta, red (the grey and blue bars are cropped off).
static func native_still_why(img: Image) -> String:
	return bars_why(img, NATIVE_X, NATIVE_COLS)


## Share of pixels in `rect` (whole frame when empty) whose channels differ by more than 80 — colour, not grey/black.
## A flat panel and a grey UI read ~0, colour bars ~0.7. → -1.0 when the crop leaves the frame.
static func saturated(img: Image, rect := Rect2i()) -> float:
	var frame := Vector2i(img.get_width(), img.get_height())
	var r := Rect2i(Vector2i.ZERO, frame) if rect.size == Vector2i.ZERO else rect
	if r.position.x < 0 or r.position.y < 0 or r.size.x <= 0 or r.size.y <= 0 or r.end.x > frame.x or r.end.y > frame.y:
		return -1.0
	var step := maxi(1, int(ceil(sqrt(float(r.size.x * r.size.y) / MAX_SAMPLES))))
	var n := 0
	var hit := 0
	for y in range(r.position.y, r.end.y, step):
		for x in range(r.position.x, r.end.x, step):
			var c := img.get_pixel(x, y)
			n += 1
			if (maxf(c.r, maxf(c.g, c.b)) - minf(c.r, minf(c.g, c.b))) * 255.0 > 80.0:
				hit += 1
	return float(hit) / maxf(n, 1.0)


static func is_black(s: Dictionary) -> bool:
	return not s.has("error") and s.luma < 3.0 and s.nonblack < 0.01


## Probe self-test on synthetic frames: bars separate from black on every measure, a flat grey is not bars, and a crop past
## the frame edge is refused. "" = the probe can be trusted.
static func self_test() -> String:
	var pic := Image.create(1280, 720, false, Image.FORMAT_RGBA8)
	pic.fill(Color8(0, 0, 0, 255))  # opaque black under the bars, like a real frame
	var black := Image.create(1280, 720, false, Image.FORMAT_RGBA8)
	black.fill(Color(0, 0, 0, 0))
	var edges := [0, 232, 508, 784, 1060, 1280]  # the native still on the channel (see native_still_why)
	for k in 5:
		pic.fill_rect(Rect2i(edges[k], 0, edges[k + 1] - edges[k], 540), Color8(NATIVE_COLS[k][0], NATIVE_COLS[k][1], NATIVE_COLS[k][2], 255))
	var sb := stats(pic)
	var sk := stats(black)
	if is_black(sb) or not is_black(sk):
		return "probe cannot tell the picture (luma %.0f, nonblack %.2f) from black (luma %.0f, nonblack %.2f)" % [sb.luma, sb.nonblack, sk.luma, sk.nonblack]
	if native_still_why(pic) != "":
		return "the bars probe rejects the expected picture: " + native_still_why(pic)
	if native_still_why(black) == "":
		return "the bars probe accepts black"
	var grey := Image.create(1280, 720, false, Image.FORMAT_RGBA8)
	grey.fill(Color8(128, 128, 128, 255))
	if native_still_why(grey) == "":
		return "the bars probe accepts a flat grey"
	var wrong := Image.create(1280, 720, false, Image.FORMAT_RGBA8)  # the same bars scaled to fit (7 bars) must not pass as native
	for k in 7:
		wrong.fill_rect(Rect2i(k * 1280 / 7, 0, 1280 / 7 + 1, 720), Color8(SMPTE[k][0], SMPTE[k][1], SMPTE[k][2], 255))
	if native_still_why(wrong) == "":
		return "the bars probe accepts a scaled-to-fit picture (geometry not checked)"
	if not stats(pic, Rect2i(1200, 0, 100, 10)).has("error"):  # X + W = 1300 > 1280: ffmpeg would clamp this one
		return "a crop past the right edge was not refused"
	if sb.alpha_nonzero < 0.99 or sk.alpha_nonzero > 0.01:
		return "alpha plane not reported (picture %.2f, black %.2f)" % [sb.alpha_nonzero, sk.alpha_nonzero]
	return ""


## One PRINT of Caspar channel `ch` through the node (POST /api/amcp/raw — the real AMCP link), picked up from the media
## folder `dir` (Caspar names it by the second, so prints are held ≥ 1.1 s apart), loaded, copied to `keep` (a PNG path, may
## be "") and deleted from the media folder. → {ok, img, error}
func print_once(sc: RefCounted, ch: int, dir: String, keep := "") -> Dictionary:
	var wait := 1100 - (Time.get_ticks_msec() - _last_print)
	if wait > 0:
		await sc.ui.sleep(wait / 1000.0)
	var before := _prints(dir)
	var r: Dictionary = await sc.post("/api/amcp/raw", {"cmd": "PRINT %d" % ch})
	_last_print = Time.get_ticks_msec()
	if not r.ok:
		return {"ok": false, "error": "PRINT %d refused: %s" % [ch, r.get("error")]}
	for i in 40:
		await sc.ui.sleep(0.15)
		for f in _prints(dir):
			if before.has(f):
				continue
			await sc.ui.sleep(0.25)  # let Caspar finish writing
			var path := dir.path_join(f)
			var img := Image.new()
			var err := img.load(path)
			DirAccess.remove_absolute(path)  # the test's scratch print, not the media library's
			if err != OK:
				return {"ok": false, "error": "PRINT %d wrote %s but it does not load (%d)" % [ch, f, err]}
			img.convert(Image.FORMAT_RGBA8)
			if keep != "":
				img.save_png(keep)
			return {"ok": true, "img": img}
	return {"ok": false, "error": "PRINT %d was accepted but no new PNG appeared in %s within 6 s" % [ch, dir]}


## PRINT `ch` again and again until `pred.call(stats, img) == ""` or `timeout_s` — the throwaway Caspar renders slowly
## (software GL: a clip's first picture arrives seconds after PLAY, the one after it later still), so one print proves
## nothing either way. → "" or the last reason; `out` gets {stats, png} of the accepted print.
func await_print(sc: RefCounted, ch: int, dir: String, pred: Callable, label: String, out: Dictionary, timeout_s := 45.0) -> String:
	var until := Time.get_ticks_msec() + int(timeout_s * 1000.0)
	var why := "no print"
	var n := 0
	while Time.get_ticks_msec() < until:
		n += 1
		var keep := ""
		if sc.ui.shots_dir != "":
			keep = "%s/print_%s_ch%d_%d.png" % [sc.ui.shots_dir, label.to_snake_case(), ch, n]
		var p: Dictionary = await print_once(sc, ch, dir, keep)
		if not p.ok:
			return p.error
		var s := stats(p.img)
		why = pred.call(s, p.img)
		if why == "":
			out["stats"] = s
			out["png"] = keep
			out["prints"] = n
			return ""
	return "%s on channel %d after %d prints / %.0f s: %s" % [label, ch, n, timeout_s, why]


static func _prints(dir: String) -> PackedStringArray:
	var re := RegEx.create_from_string(PRINT_NAME)
	var out := PackedStringArray()
	for f in DirAccess.get_files_at(dir):
		if re.search(f) != null:
			out.append(f)
	return out


static func fmt(s: Dictionary) -> String:
	return "luma %.0f, nonblack %.2f, rgb %d/%d/%d, alpha %.0f (%.0f%% nonzero), frame %dx%d" % [s.luma, s.nonblack,
		s.rgb[0], s.rgb[1], s.rgb[2], s.alpha, s.alpha_nonzero * 100.0, s.frame.x, s.frame.y]
