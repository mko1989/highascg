extends RefCounted
## WO-595 M0: GDScript reader for the HighAsCG shm frame ABI v1 (caspar/modules/shm/hshm_abi.h).
## Spike only — production reads through the hshm GDExtension (WO-596). FileAccess re-reads the
## segment each frame (Linux: /dev/shm is RAM; macOS: page-cached temp file).

const MAGIC := "HASCGSHM"
const ABI_VERSION := 1
const SLOTS := 3
const SLOT_HEADER_SIZE := 4096
const HEADER_SIZE := 4096
const PAGE := 4096
const PIXEL_FORMAT_BGRA8_PREMULT := 1
const OFF_ABI_VERSION := 8
const OFF_WIDTH := 16
const OFF_HEIGHT := 20
const OFF_STRIDE := 24
const OFF_PIXEL_FORMAT := 28
const OFF_FPS_NUM := 32
const OFF_FPS_DEN := 36
const OFF_SLOT_COUNT := 40
const OFF_SLOT_OFFSET := 48
const OFF_GENERATION := 80
const OFF_LATEST := 96
const OFF_DROPPED := 112
const SLOT_OFF_SEQ := 0
const SLOT_OFF_FRAME_NUMBER := 16
const SLOT_OFF_PUBLISH_REALTIME_NS := 24
const SIGNAL_LOST_MS := 500

var path: String
var width := 0
var height := 0
var stride := 0
var fps := 0.0
var generation := 0
var frame := PackedByteArray()
var frame_number := 0
var latency_ms := 0.0
var read_ms := 0.0
var frames := 0
var gaps := 0
var lapped := 0
var reopens := 0
var signal_lost := true

var _opened := false
var _writer_dropped := 0
var _slot_offsets: Array[int] = []
var _last_latest := 0
var _last_seq := 0
var _last_new_frame_ms := 0
var _next_open_ms := 0


func _init(segment_path: String) -> void:
	path = segment_path


## Returns true when a new, verified frame is in `frame`.
## Every read goes through a FRESH FileAccess: stdio buffering + fseek-within-buffer would
## otherwise serve stale header bytes (seen on macOS: frames stopped after 4 reads).
func poll() -> bool:
	var now := Time.get_ticks_msec()
	if not _opened:
		if now < _next_open_ms:
			return false
		_next_open_ms = now + SIGNAL_LOST_MS
		if not _open():
			signal_lost = true
			return false
	var hdr := _read(0, 128)
	if hdr.size() < 128 or hdr.slice(0, 8).get_string_from_ascii() != MAGIC:
		if hdr.size() == 0:
			_close()
		return _stale(now)  # writer gone or re-initialising
	if hdr.decode_u64(OFF_GENERATION) != generation:
		_close()  # geometry/generation changed → reopen next poll
		return false
	var latest := hdr.decode_u64(OFF_LATEST)
	_writer_dropped = hdr.decode_u64(OFF_DROPPED)
	if latest == 0 or latest == _last_latest:
		return _stale(now)
	var n := latest >> 8
	var slot := latest & 0xff
	if slot >= SLOTS:
		return _stale(now)
	var base: int = _slot_offsets[slot]
	if _read(base, 8).decode_u64(0) != 2 * n:
		lapped += 1
		return false
	var t0 := Time.get_ticks_usec()
	var data := _read(base + SLOT_HEADER_SIZE, stride * height)
	read_ms = (Time.get_ticks_usec() - t0) / 1000.0
	var sh := _read(base, 32)
	if data.size() != stride * height or sh.size() < 32 or sh.decode_u64(SLOT_OFF_SEQ) != 2 * n:
		lapped += 1  # torn: the writer reused the slot during our read
		return false
	frame_number = sh.decode_u64(SLOT_OFF_FRAME_NUMBER)
	var published_ns := sh.decode_u64(SLOT_OFF_PUBLISH_REALTIME_NS)
	latency_ms = (Time.get_unix_time_from_system() * 1.0e9 - float(published_ns)) / 1.0e6
	if _last_seq != 0 and n != _last_seq + 1:
		gaps += n - _last_seq - 1
	_last_seq = n
	_last_latest = latest
	frame = data
	frames += 1
	_last_new_frame_ms = now
	signal_lost = false
	return true


func writer_dropped() -> int:
	return _writer_dropped


func _stale(now: int) -> bool:
	if now - _last_new_frame_ms > SIGNAL_LOST_MS:
		signal_lost = true
	return false


func _read(offset: int, length: int) -> PackedByteArray:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return PackedByteArray()
	f.seek(offset)
	return f.get_buffer(length)


func _open() -> bool:
	if not FileAccess.file_exists(path):
		return false
	var hdr := _read(0, 128)
	if hdr.size() < 128 or hdr.slice(0, 8).get_string_from_ascii() != MAGIC:
		return false
	# Same refusals as the native reader (caspar/modules/shm/hshm_reader.h open): ABI, pixel format, slot count, and a
	# file big enough for the geometry it claims (a short one would read garbage slots).
	if hdr.decode_u32(OFF_ABI_VERSION) != ABI_VERSION or hdr.decode_u32(OFF_PIXEL_FORMAT) != PIXEL_FORMAT_BGRA8_PREMULT:
		return false
	if hdr.decode_u32(OFF_SLOT_COUNT) != SLOTS or _length() < segment_size(hdr.decode_u32(OFF_STRIDE), hdr.decode_u32(OFF_HEIGHT)):
		return false
	width = hdr.decode_u32(OFF_WIDTH)
	height = hdr.decode_u32(OFF_HEIGHT)
	stride = hdr.decode_u32(OFF_STRIDE)
	fps = float(hdr.decode_u32(OFF_FPS_NUM)) / float(max(hdr.decode_u32(OFF_FPS_DEN), 1))
	generation = hdr.decode_u64(OFF_GENERATION)
	_slot_offsets.clear()
	for s in SLOTS:
		_slot_offsets.append(hdr.decode_u64(OFF_SLOT_OFFSET + 8 * s))
	_last_latest = 0
	_last_seq = 0
	_opened = true
	reopens += 1
	return true


## hshm_abi.h hshm_segment_size: the header page + 3 slots, each its header page + pixels, rounded up to a page.
static func segment_size(row_stride: int, rows: int) -> int:
	return HEADER_SIZE + SLOTS * ceili(float(SLOT_HEADER_SIZE + row_stride * rows) / PAGE) * PAGE


func _length() -> int:
	var f := FileAccess.open(path, FileAccess.READ)
	return f.get_length() if f != null else 0


func _close() -> void:
	_opened = false
	signal_lost = true
