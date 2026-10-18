extends RefCounted
## WO-601 — 1:1 ports of client/lib/audio-volume-scale.js (fader curve, dB text) and
## media-ext.js sourceSupportsLoopPlayback. Golden-tested against the JS.

const MIN_DB := -60.0
const MAX_DB := 6.0
const CURVE := [[100.0, 6.0], [83.333, 0.0], [66.667, -6.0], [50.0, -12.0], [33.333, -24.0], [16.667, -48.0], [0.0, -60.0]]
const STILL := ["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif"]
const VIDEO := ["mov", "qt", "mp4", "mxf", "avi", "mkv", "webm", "mpg", "mpeg", "m2v", "m4v", "wmv", "flv", "ts", "m2ts"]
const AUDIO := ["mp3", "wav", "aac", "m4a", "flac", "ogg", "opus", "wma"]


static func gain_to_db(g: float) -> float:
	if is_nan(g) or g <= 0.0:
		return MIN_DB
	return clampf(20.0 * log(g) / log(10.0), MIN_DB, MAX_DB)


static func db_to_gain(db: float) -> float:
	if is_nan(db) or db <= MIN_DB:
		return 0.0
	return pow(10.0, minf(MAX_DB, db) / 20.0)


static func format_db(g: float) -> String:
	var db := gain_to_db(g)
	if db <= MIN_DB + 0.05:
		return "−∞"
	return "%s%.1f dB" % ["+" if db > 0.0 else "", db]


static func fader_to_gain(percent: float) -> float:
	var p := clampf(percent if not is_nan(percent) else 0.0, 0.0, 100.0)
	if p <= 0.0:
		return 0.0
	var db := MIN_DB
	for i in CURVE.size() - 1:
		var up: Array = CURVE[i]
		var lo: Array = CURVE[i + 1]
		if p >= lo[0]:
			db = lo[1] + (p - lo[0]) / (up[0] - lo[0]) * (up[1] - lo[1])
			break
	return db_to_gain(db)


static func gain_to_fader(g: float) -> int:
	if is_nan(g) or g <= 0.0:
		return 0
	var db := gain_to_db(g)
	if db <= MIN_DB:
		return 0
	for i in CURVE.size() - 1:
		var up: Array = CURVE[i]
		var lo: Array = CURVE[i + 1]
		if db >= lo[1]:
			return int(floor(lo[0] + (db - lo[1]) / (up[1] - lo[1]) * (up[0] - lo[0]) + 0.5))
	return 100


static func _ext(v: String) -> String:
	var base := v.replace("\\", "/").get_file()
	var i := base.rfind(".")
	return "" if i < 0 else base.substr(i + 1).to_lower()


static func supports_loop(value: String, source_type: String) -> bool:
	if value == "":
		return false
	var t := source_type.to_lower()
	if t == "timeline":
		return true
	var v := value.strip_edges()
	if v.begins_with("route://") or t == "template":
		return false
	var e := _ext(v)
	if e != "" and STILL.has(e):
		return false
	if e != "" and (AUDIO.has(e) or VIDEO.has(e)):
		return true
	if (t == "media" or t == "file") and e == "":
		return true
	return (t == "media" or t == "file") and e != "" and not STILL.has(e) and not AUDIO.has(e)
