extends RefCounted
## Test-only writer for the shm frame ABI v1 (caspar/modules/shm/hshm_abi.h): the writer's open_path() mode, a
## regular file instead of /dev/shm. Not a test file (run_tests.gd runs test_*.gd only).
## Edits go in place through READ_WRITE: FileAccess WRITE saves via a temp file + rename, i.e. a NEW inode, which
## would leave the native reader's mmap on the old file (and look like a Caspar restart).

const HEADER := 4096
const SLOT_HEADER := 4096
const PAGE := 4096
const SLOTS := 3
const BGRA8_PREMULT := 1

var path: String  # OS path (the native reader mmaps it)
var width: int
var height: int
var stride: int
var generation := 1
var seq := 0  # frame_seq of the last publish


func _init(os_path: String, w: int, h: int, gen := 1) -> void:
	path = os_path
	width = w
	height = h
	stride = w * 4
	generation = gen
	create()


func slot_size() -> int:
	return ceili(float(SLOT_HEADER + stride * height) / PAGE) * PAGE


func slot_offset(s: int) -> int:
	return HEADER + s * slot_size()


func size() -> int:
	return HEADER + SLOTS * slot_size()


## A fresh, empty segment (latest = 0): what the writer leaves before its first frame. Replaces the file (new inode).
func create(pixel_format := BGRA8_PREMULT, slot_count := SLOTS, abi := 1) -> void:
	var b := PackedByteArray()
	b.resize(size())
	b.encode_u32(8, abi)
	b.encode_u32(12, HEADER)
	b.encode_u32(16, width)
	b.encode_u32(20, height)
	b.encode_u32(24, stride)
	b.encode_u32(28, pixel_format)
	b.encode_u32(32, 50)
	b.encode_u32(36, 1)
	b.encode_u32(40, slot_count)
	b.encode_u32(44, 1)
	for s in SLOTS:
		b.encode_u64(48 + 8 * s, slot_offset(s))
	b.encode_u64(72, slot_size())
	b.encode_u64(80, generation)
	b.encode_u64(88, OS.get_process_id())
	for i in 8:
		b[i] = "HASCGSHM".unicode_at(i)
	var f := FileAccess.open(path, FileAccess.WRITE)
	f.store_buffer(b)
	f.close()
	seq = 0


## Publish frame `n` (default: the next one) into slot n % 3, every pixel byte = `fill`, as the writer does:
## slot seq odd → pixels → slot header → seq 2n → latest = (n << 8) | slot. `seq_override` ≥ 0 leaves the slot's seq
## at that value instead (a writer mid-copy, or one that already lapped the slot).
func publish(fill: int, n := -1, seq_override := -1) -> int:
	n = seq + 1 if n < 0 else n
	var s := n % SLOTS
	var px := PackedByteArray()
	px.resize(stride * height)
	px.fill(fill)
	var sh := PackedByteArray()
	sh.resize(32)
	sh.encode_u64(0, 2 * n if seq_override < 0 else seq_override)
	sh.encode_u64(8, Time.get_ticks_usec() * 1000)
	sh.encode_u64(16, 1000 + n)  # frame_number: the channel's own counter
	sh.encode_u64(24, int(Time.get_unix_time_from_system() * 1.0e9))
	_patch(slot_offset(s) + SLOT_HEADER, px)
	_patch(slot_offset(s), sh)
	set_u64(96, (n << 8) | s)
	set_u64(104, Time.get_ticks_usec() * 1000)
	seq = n
	return n


func set_u64(offset: int, v: int) -> void:
	var b := PackedByteArray()
	b.resize(8)
	b.encode_u64(0, v)
	_patch(offset, b)


func set_magic(text: String) -> void:
	_patch(0, text.to_ascii_buffer())


func remove() -> void:
	DirAccess.remove_absolute(path)


func _patch(offset: int, data: PackedByteArray) -> void:
	var f := FileAccess.open(path, FileAccess.READ_WRITE)
	f.seek(offset)
	f.store_buffer(data)
	f.close()
