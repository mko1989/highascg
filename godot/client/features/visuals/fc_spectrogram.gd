extends RefCounted
## WO-999 — FragCoord's `u_audio`: a 512×512 history, x = frequency bin, y = time with row 0 the newest, at 60 rows/s
## (≈8.5 s). R = the A-weighted FFT, G = the waveform, B = the raw FFT. The server computes both spectrum rows with
## FragCoord's analyser settings (src/audio/fft-fragcoord.js, `fcWeighted` / `fcRaw` in each `audio_fft` frame); this
## model only scrolls them. Step rules (FragCoord's player): the first step writes row 0; then elapsed time accrues and
## every whole 1/60 s shifts the history down one row and writes the current row on top; a step shorter than a row
## rewrites row 0; a gap longer than the whole history fills every row with the current one.
## Stored RGBA8 (alpha 255): RGB8 is not a sampled format on most Vulkan drivers. One shared instance per app, so every
## FragCoord layer reads the same history; `pull()` advances it at most once per rendered frame.

const W := 512
const H := 512
const ROW_S := 1.0 / 60.0
const BPP := 4
const ROW_BYTES := W * BPP
const STALE_MS := 1000  # no frame for this long → silent rows (visuals_stage.gd AUDIO_STALE_MS)

var data := PackedByteArray()  # H rows of ROW_BYTES, row 0 first (= uv.y 0 in the shader)
var rev := 0  # bumps on every change, so a consumer uploads only a new history
var _row := PackedByteArray()  # the current row
var _silent := PackedByteArray()
var _left := 0.0
var _started := false
var _frame := -1
var _at := -1.0  # ms of the last frame (-1 = none yet)
var _pending: Variant = null  # the latest WS frame, decoded only when a layer pulls (no cost without FragCoord layers)

static var _shared: RefCounted


static func shared() -> RefCounted:
	if _shared == null:
		_shared = new()
	return _shared


func _init() -> void:
	_silent = _make_row(PackedByteArray(), PackedByteArray(), PackedByteArray())
	_row = _silent
	_fill()


## One `audio_fft` frame. A server without the FragCoord rows (older build) gives a black spectrum and the wave only.
func frame_from_ws(d: Variant, now_ms := -1.0) -> void:
	if not d is Dictionary:
		return
	_pending = d
	_at = now_ms if now_ms >= 0.0 else float(Time.get_ticks_msec())


func set_row(weighted: PackedByteArray, wave: PackedByteArray, raw: PackedByteArray) -> void:
	_row = _make_row(weighted, wave, raw)


## The feed went stale: the next rows are silence (spectrum 0, wave at its centre 128).
func silence() -> void:
	_row = _silent


## Advance by `dt` seconds (FragCoord's rules, see the header).
func advance(dt: float) -> void:
	rev += 1
	if not _started or dt <= 0.0:
		_started = true
		_write(0)
		return
	if dt > H * ROW_S + ROW_S:
		_left = 0.0
		_fill()
		return
	_left += dt
	var n := int(floor(_left / ROW_S))
	_left -= n * ROW_S
	if n <= 0:
		_write(0)
		return
	n = mini(n, H)
	var top := PackedByteArray()
	for i in n:
		top.append_array(_row)
	data = top + data.slice(0, (H - n) * ROW_BYTES) if n < H else top


## Advance once per rendered frame however many layers ask (`frame` = Engine.get_frames_drawn()); returns `data`.
## A feed silent for STALE_MS scrolls silence in.
func pull(frame: int, dt: float, now_ms := -1.0) -> PackedByteArray:
	if frame != _frame:
		_frame = frame
		var now := now_ms if now_ms >= 0.0 else float(Time.get_ticks_msec())
		if _pending is Dictionary:
			set_row(_b64(_pending.get("fcWeighted")), _b64(_pending.get("wave")), _b64(_pending.get("fcRaw")))
			_pending = null
		if _at < 0.0 or now - _at > STALE_MS:
			silence()
		advance(dt)
	return data


## The row at `y` (0 = newest), for tests and probes.
func row(y: int) -> PackedByteArray:
	return data.slice(y * ROW_BYTES, (y + 1) * ROW_BYTES)


func _write(y: int) -> void:
	data = data.slice(0, y * ROW_BYTES) + _row + data.slice((y + 1) * ROW_BYTES)


func _fill() -> void:
	var all := PackedByteArray()
	for y in H:
		all.append_array(_row)
	data = all


static func _make_row(weighted: PackedByteArray, wave: PackedByteArray, raw: PackedByteArray) -> PackedByteArray:
	var r := PackedByteArray()
	r.resize(ROW_BYTES)
	for x in W:
		r[x * 4] = weighted[x] if x < weighted.size() else 0
		r[x * 4 + 1] = wave[x] if x < wave.size() else 128
		r[x * 4 + 2] = raw[x] if x < raw.size() else 0
		r[x * 4 + 3] = 255
	return r


static func _b64(v: Variant) -> PackedByteArray:
	return Marshalls.base64_to_raw(v) if v is String and v != "" else PackedByteArray()
