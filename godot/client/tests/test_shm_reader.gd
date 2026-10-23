extends RefCounted
## WO-596 — the Godot side of the shm frame ABI v1: video/shm_reader.gd (the GDScript reader, used whenever the hshm
## extension is not loaded) and, when the extension IS loaded, the native HshmSource through video/shm_native.gd,
## both against shm_fake_writer.gd (a segment in a regular file, as the writer's open_path() mode makes). The C++
## writer/reader pair has its own torn-frame test (caspar/modules/shm/tests); this pins what the client does with
## a segment: geometry, frames, gaps, laps, a writer re-initialising or restarting, and foreign segments.

const R := preload("res://video/shm_reader.gd")
const ShmNative := preload("res://video/shm_native.gd")
const W := preload("res://tests/shm_fake_writer.gd")
var t
var _n := 0


func _seg(w := 8, h := 4, gen := 1) -> W:
	_n += 1
	var p := OS.get_user_data_dir().path_join("test_hshm_%d_%d.seg" % [OS.get_process_id(), _n])
	return W.new(p, w, h, gen)


## A reader whose next poll may (re)open now instead of after the 500 ms reopen pace.
func _reopen_now(r: R) -> void:
	r._next_open_ms = 0


func test_missing_segment_is_signal_lost() -> void:
	var r := R.new(OS.get_user_data_dir().path_join("test_hshm_none.seg"))
	t.ok(not r.poll(), "no file → no frame")
	t.ok(r.signal_lost, "signal lost")
	t.eq(r.reopens, 0, "nothing opened")


func test_opens_and_reads_each_frame_once() -> void:
	var w := _seg(8, 4)
	var r := R.new(w.path)
	t.ok(not r.poll(), "empty segment (latest 0): opened, no frame")
	t.eq([r.reopens, r.width, r.height, r.stride, r.fps], [1, 8, 4, 32, 50.0], "geometry from the header")
	w.publish(0x11)
	t.ok(r.poll(), "first frame")
	t.eq(r.frame.size(), 8 * 4 * 4, "width × height × 4 bytes")
	t.ok(r.frame[0] == 0x11 and r.frame[r.frame.size() - 1] == 0x11, "the published pixels")
	t.eq(r.frame_number, 1001, "the slot's frame_number")
	t.ok(not r.signal_lost, "signal back")
	t.ok(absf(r.latency_ms) < 2000.0, "latency from the realtime stamp: %.1f ms" % r.latency_ms)
	t.ok(not r.poll(), "the same frame is not read twice")
	w.publish(0x22)
	t.ok(r.poll(), "next frame")
	t.eq([r.frame[0], r.frames, r.gaps, r.lapped], [0x22, 2, 0, 0], "counters")
	w.remove()


func test_gaps_and_writer_dropped() -> void:
	var w := _seg()
	var r := R.new(w.path)
	r.poll()
	w.publish(1)
	r.poll()
	w.publish(2, 4)  # frames 2 and 3 were overwritten before this reader looked
	t.ok(r.poll(), "newest frame")
	t.eq(r.gaps, 2, "two frames skipped")
	w.set_u64(112, 7)
	w.publish(3)
	r.poll()
	t.eq(r.writer_dropped(), 7, "the writer's own drop counter")
	w.remove()


func test_mid_write_and_lapped_slots_are_never_shown() -> void:
	var w := _seg()
	var r := R.new(w.path)
	r.poll()
	w.publish(0x10)
	r.poll()
	w.publish(0x20, 2, 3)  # seq odd: the writer is still copying slot 2
	t.ok(not r.poll(), "a slot being written is not read")
	t.eq([r.lapped, r.frame[0]], [1, 0x10], "counted as a lap; the last good frame stays")
	w.publish(0x30, 3, 2 * 6)  # seq belongs to a later frame: the writer lapped this slot
	t.ok(not r.poll(), "a lapped slot is not read")
	t.eq(r.lapped, 2, "lapped")
	w.publish(0x40, 4)
	t.ok(r.poll(), "a stable slot after that is read")
	t.eq(r.frame[0], 0x40, "its pixels")
	w.set_u64(96, (5 << 8) | 7)  # slot index 7 does not exist
	t.ok(not r.poll(), "slot index ≥ 3 is ignored")
	t.eq(r.frame[0], 0x40, "frame untouched")
	w.remove()


func test_foreign_segments_are_refused() -> void:
	var cases := [["abi 2", W.BGRA8_PREMULT, W.SLOTS, 2], ["pixel format 2", 2, W.SLOTS, 1],
		["slot count 2", W.BGRA8_PREMULT, 2, 1]]
	for c in cases:
		var w := _seg()
		w.create(c[1], c[2], c[3])
		var r := R.new(w.path)
		t.ok(not r.poll(), "%s: no frame" % c[0])
		t.eq(r.reopens, 0, "%s: not opened" % c[0])
		w.remove()
	var w := _seg()
	var f := FileAccess.open(w.path, FileAccess.READ)
	var head := f.get_buffer(W.HEADER)
	f.close()
	f = FileAccess.open(w.path, FileAccess.WRITE)
	f.store_buffer(head)  # header only: the slots are missing
	f.close()
	var r := R.new(w.path)
	t.ok(not r.poll(), "truncated segment: no frame")
	t.eq(r.reopens, 0, "truncated segment: not opened")
	w.remove()


func test_writer_reinit_restart_and_generation_bump() -> void:
	var w := _seg(8, 4, 1)
	var r := R.new(w.path)
	r.poll()
	w.publish(0x10)
	t.ok(r.poll(), "frame")
	w.set_magic("XXXXXXXX")  # the writer re-initialising
	w.publish(0x20)
	t.ok(not r.poll(), "no frame while the magic is wrong")
	w.set_magic("HASCGSHM")
	t.ok(r.poll(), "the frame once the writer is done")
	t.eq(r.frame[0], 0x20, "its pixels")
	w.generation = 2
	w.width = 16
	w.stride = 64
	w.create()  # a Caspar restart with a new size: new generation, new geometry
	t.ok(not r.poll(), "generation changed → close")
	_reopen_now(r)
	r.poll()
	t.eq([r.reopens, r.generation, r.width, r.stride], [2, 2, 16, 64], "reopened on the new segment")
	w.publish(0x30)
	t.ok(r.poll(), "the new writer's first frame")
	t.eq([r.frame.size(), r.gaps], [16 * 4 * 4, 0], "new size; seq restarted at 1 is no gap")
	w.remove()
	t.ok(not r.poll(), "segment gone → no frame")
	_reopen_now(r)
	t.ok(not r.poll(), "still gone")
	t.ok(r.signal_lost, "signal lost")


func test_signal_lost_after_half_a_second_without_frames() -> void:
	var w := _seg()
	var r := R.new(w.path)
	r.poll()
	w.publish(1)
	r.poll()
	t.ok(not r.poll() and not r.signal_lost, "a quiet poll right after a frame is not loss")
	r._last_new_frame_ms -= R.SIGNAL_LOST_MS + 10
	r.poll()
	t.ok(r.signal_lost, "500 ms without a new frame")
	t.eq(R.segment_size(32, 4), 4096 + 3 * 8192, "segment size: slot header + pixels rounded up to a page")
	t.eq(R.segment_size(1920 * 4, 1080), 4096 + 3 * 8298496, "1080p: hshm_segment_size")
	w.publish(2)
	t.ok(r.poll() and not r.signal_lost, "back with the next frame")
	w.remove()


## The native reader (hshm GDExtension) on the same segments. CI has no binary (built per machine, not committed):
## then this only checks that the adapter reports it unavailable.
func test_native_hshm_source_on_the_same_segment() -> void:
	if not ShmNative.available():
		t.ok(not ClassDB.class_exists("HshmSource"), "extension not loaded here — native reader not tested")
		return
	var w := _seg(8, 4)
	var r := ShmNative.new(w.path)
	t.ok(not r.poll(), "empty segment: no frame")
	t.eq([r.reopens, r.width, r.height, r.fps], [1, 8, 4, 50.0], "geometry")
	w.publish(0x11)
	t.ok(r.poll(), "first frame")
	var px: PackedByteArray = r.src.call("get_frame")
	t.eq(px.size(), 8 * 4 * 4, "frame bytes")
	t.ok(px[0] == 0x11 and px[px.size() - 1] == 0x11, "the published pixels")
	t.eq(r.frame_number, 1001, "frame_number")
	t.ok(not r.poll(), "not read twice")
	w.publish(0x22, 4)
	t.ok(r.poll(), "newest frame")
	t.eq(r.gaps, 2, "gaps")
	w.publish(0x33, 5, 9)
	t.ok(not r.poll(), "mid-write slot refused")
	t.eq(r.lapped, 1, "lapped")
	w.set_u64(112, 5)
	t.eq(r.writer_dropped(), 5, "writer drops")
	w.generation = 2
	w.width = 16
	w.stride = 64
	w.create()
	t.ok(not r.poll(), "generation changed → close")
	r.poll()
	t.eq([r.reopens, r.width], [2, 16], "reopened on the new geometry")
	w.publish(0x44)
	t.ok(r.poll(), "new writer's frame")
	t.eq((r.src.call("get_frame") as PackedByteArray).size(), 16 * 4 * 4, "new size")
	var foreign := _seg()
	foreign.create(2)
	var n := ShmNative.new(foreign.path)
	t.ok(not n.poll(), "pixel format 2 refused")
	t.eq(n.reopens, 0, "not opened")
	foreign.remove()
	w.remove()
