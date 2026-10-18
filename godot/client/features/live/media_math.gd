extends RefCounted
## WO-601 media file inspector helpers — 1:1 with client/components/inspector-media-file-library.js
## parseTimeInput and inspector-media-file-wave.js formatMediaTimecode (golden-tested against the JS).


## "1:02.5" / "62.5" / "1:02:03" → seconds; "" → null; garbage → NAN. JS quirk kept: an empty part is 0.
static func parse_time_input(text: String) -> Variant:
	var t := text.strip_edges()
	if t == "":
		return null
	var acc := 0.0
	for p in t.split(":"):
		var s := (p as String).strip_edges()
		var n := 0.0 if s == "" else (float(s) if s.is_valid_float() else NAN)
		if is_nan(n) or n < 0.0:
			return NAN
		acc = acc * 60.0 + n
	return acc


static func format_timecode(sec: float, fps: float) -> String:
	var f := maxi(1, int(floor((fps if fps > 0.0 else 25.0) + 0.5)))
	var total := maxi(0, int(floor(maxf(0.0, sec) * f)))
	var ff := total % f
	var s := total / f
	var m := s / 60
	var h := m / 60
	if h > 0:
		return "%d:%02d:%02d.%02d" % [h, m % 60, s % 60, ff]
	return "%d:%02d.%02d" % [m, s % 60, ff]
