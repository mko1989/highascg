extends RefCounted
## WO-999 — FragCoord's u_audio history: row layout (R weighted, G wave, B raw, A 255), the 60 rows/s scroll with
## row 0 newest, sub-row steps, the long-gap fill, once-per-frame pulls, stale silence and the WS frame decode.

const FC := preload("res://features/visuals/fc_spectrogram.gd")
var t

const DT := 1.0 / 60.0


func _bytes(v: int, n := 512) -> PackedByteArray:
	var b := PackedByteArray()
	b.resize(n)
	b.fill(v)
	return b


func _px(s: RefCounted, y: int, x: int) -> Array:
	var r: PackedByteArray = s.row(y)
	return [r[x * 4], r[x * 4 + 1], r[x * 4 + 2], r[x * 4 + 3]]


func test_starts_silent_and_sized() -> void:
	var s := FC.new()
	t.eq(s.data.size(), 512 * 512 * 4, "512×512 RGBA8")
	t.eq(_px(s, 0, 0), [0, 128, 0, 255], "silence: no spectrum, wave centred, opaque")
	t.eq(_px(s, 511, 511), [0, 128, 0, 255])


func test_row_layout_r_weighted_g_wave_b_raw() -> void:
	var s := FC.new()
	s.set_row(_bytes(200), _bytes(90), _bytes(40))
	s.advance(DT)
	t.eq(_px(s, 0, 7), [200, 90, 40, 255])
	s.set_row(PackedByteArray([1, 2]), PackedByteArray(), PackedByteArray([3]))
	s.advance(DT)
	t.eq(_px(s, 0, 0), [1, 128, 3, 255], "short rows pad: spectrum 0, wave 128")
	t.eq(_px(s, 0, 1), [2, 128, 0, 255])


func test_first_step_writes_row0_then_scrolls_at_60_rows_per_s() -> void:
	var s := FC.new()
	s.set_row(_bytes(10), _bytes(10), _bytes(10))
	s.advance(1.0)  # first call: row 0 only, whatever dt
	t.eq(_px(s, 0, 0)[0], 10)
	t.eq(_px(s, 1, 0)[0], 0, "nothing shifted on the first step")
	s.set_row(_bytes(20), _bytes(20), _bytes(20))
	s.advance(DT * 3.5)  # 3 whole rows, half a row left over
	t.eq([_px(s, 0, 0)[0], _px(s, 1, 0)[0], _px(s, 2, 0)[0]], [20, 20, 20], "3 new rows on top")
	t.eq(_px(s, 3, 0)[0], 10, "the old row 0 moved down 3")
	t.eq(_px(s, 4, 0)[0], 0)
	s.set_row(_bytes(30), _bytes(30), _bytes(30))
	s.advance(DT * 0.6)  # 0.5 + 0.6 → one more row
	t.eq(_px(s, 0, 0)[0], 30)
	t.eq(_px(s, 4, 0)[0], 10, "shifted one more")


func test_sub_row_steps_rewrite_row0() -> void:
	var s := FC.new()
	s.advance(DT)
	s.set_row(_bytes(50), _bytes(50), _bytes(50))
	s.advance(DT * 0.25)
	t.eq(_px(s, 0, 0)[0], 50, "row 0 shows the newest frame")
	t.eq(_px(s, 1, 0)[0], 0, "no shift")
	s.set_row(_bytes(60), _bytes(60), _bytes(60))
	s.advance(0.0)
	t.eq(_px(s, 0, 0)[0], 60, "dt 0 rewrites row 0")
	s.advance(-1.0)
	t.eq(_px(s, 1, 0)[0], 0, "negative dt does not shift")


func test_a_gap_longer_than_the_history_fills_every_row() -> void:
	var s := FC.new()
	s.advance(DT)
	s.set_row(_bytes(70), _bytes(70), _bytes(70))
	s.advance(512.0 / 60.0 + 2.0 / 60.0)
	t.eq([_px(s, 0, 0)[0], _px(s, 255, 3)[0], _px(s, 511, 511)[0]], [70, 70, 70], "the whole history is the current row")
	s.set_row(_bytes(80), _bytes(80), _bytes(80))
	s.advance(DT)
	t.eq([_px(s, 0, 0)[0], _px(s, 1, 0)[0]], [80, 70], "and scrolls on from there")
	s.advance(512.5 * DT)  # just under the fill threshold: 512 rows shifted, no fill rule
	t.eq([_px(s, 0, 0)[0], _px(s, 511, 0)[0]], [80, 80], "512 rows shifted in")


func test_pull_advances_once_per_frame_and_goes_silent_when_stale() -> void:
	var s := FC.new()
	s.frame_from_ws({"fcWeighted": Marshalls.raw_to_base64(_bytes(111)), "wave": Marshalls.raw_to_base64(_bytes(99)),
		"fcRaw": Marshalls.raw_to_base64(_bytes(77))}, 1000.0)
	s.pull(1, DT, 1000.0)
	t.eq(_px(s, 0, 100), [111, 99, 77, 255], "the WS frame decoded into row 0")
	s.pull(2, DT, 1010.0)
	var r0: int = s.rev
	s.pull(2, DT, 1010.0)  # a second layer, same frame
	t.eq(s.rev, r0, "no second advance in one frame")
	t.eq([_px(s, 0, 0)[0], _px(s, 1, 0)[0], _px(s, 2, 0)[0]], [111, 111, 0])
	s.pull(3, DT, 2500.0)
	t.eq(_px(s, 0, 0), [0, 128, 0, 255], "stale for over a second: silence scrolls in")
	t.eq(_px(s, 1, 0)[0], 111)


func test_old_server_frames_and_junk() -> void:
	var s := FC.new()
	s.frame_from_ws({"freq": Marshalls.raw_to_base64(_bytes(222)), "wave": Marshalls.raw_to_base64(_bytes(140))}, 0.0)
	s.pull(1, DT, 0.0)
	t.eq(_px(s, 0, 0), [0, 140, 0, 255], "no fc rows: black spectrum, the wave still drawn")
	s.frame_from_ws("junk")
	s.frame_from_ws(null)
	t.eq(_px(s, 0, 0), [0, 140, 0, 255], "junk ignored")


func test_shared_is_one_instance() -> void:
	t.ok(FC.shared() == FC.shared(), "every FragCoord layer reads the same history")
