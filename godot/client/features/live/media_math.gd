extends RefCounted
## WO-601 media file inspector helpers — 1:1 with client/components/inspector-media-file-library.js
## parseTimeInput and inspector-media-file-wave.js formatMediaTimecode (golden-tested against the JS).


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
