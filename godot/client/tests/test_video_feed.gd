extends RefCounted
## WO-670 P1 — remote JPEG video feed: when it is used, its URL, the wire frame, and a real JPEG decode.

const F := preload("res://video/video_feed.gd")
const ShmTexture := preload("res://video/shm_texture.gd")
var t


func test_wanted_only_off_box() -> void:
	t.ok(not F.wanted("http://127.0.0.1:4200", {}), "on the box: shm")
	t.ok(not F.wanted("http://localhost:4200", {}), "localhost: shm")
	t.ok(not F.wanted("http://[::1]:4200", {}), "ipv6 loopback: shm")
	t.ok(F.wanted("http://192.168.1.40:4200", {}), "another machine: feed")
	t.ok(F.wanted("http://127.0.0.1:4200", {"video": "feed"}), "--video=feed forces it on the box")
	t.ok(not F.wanted("http://10.0.0.2:4200", {"video": "shm"}), "--video=shm forces shm")


func test_url() -> void:
	t.eq(F.url_for("http://10.0.0.2:4200", {}), "ws://10.0.0.2:4200/api/video-feed?width=960&fps=15")
	t.eq(F.url_for("https://box:443", {"video-width": "640", "video-fps": "25"}), "wss://box:443/api/video-feed?width=640&fps=25")


func test_parse_frame() -> void:
	var pkt := PackedByteArray([4]) + "pgm1".to_ascii_buffer() + PackedByteArray([0xff, 0xd8, 0xff, 0xd9])
	var f := F.parse_frame(pkt)
	t.eq(f[0], "pgm1", "role")
	t.eq((f[1] as PackedByteArray).size(), 4, "jpeg bytes")
	t.eq(F.parse_frame(PackedByteArray([9, 1, 2])), [], "short packet")
	t.eq(F.parse_frame(PackedByteArray([0, 0xff, 0xd8, 0xff, 0xd9])), [], "empty role")


func test_reader_decodes_newest_jpeg_to_rgba() -> void:
	var img := Image.create(32, 18, false, Image.FORMAT_RGB8)
	img.fill(Color(1, 0, 0))
	var r := F.RoleReader.new()
	t.ok(not r.poll(), "nothing yet")
	t.ok(r.signal_lost, "no frame → signal lost")
	r.pending = img.save_jpg_to_buffer(0.9)
	r.last_ms = Time.get_ticks_msec()
	t.ok(r.poll(), "decoded")
	t.ok(not r.signal_lost, "fresh frame")
	t.eq([r.width, r.height, r.frame.size()], [32, 18, 32 * 18 * 4], "RGBA8 size")
	t.ok(r.frame[0] > 200 and r.frame[2] < 60 and r.frame[3] == 255, "red stays red (RGBA, not BGRA)")
	t.ok(not r.poll(), "same frame is not decoded twice")


func test_texture_rgba_path() -> void:
	var tex := ShmTexture.new()
	var data := PackedByteArray()
	data.resize(4 * 2 * 4)
	tex.update_rgba(data, 4, 2)
	t.eq([tex.width, tex.height], [4, 2], "sized")
	t.ok(tex.kind in ["rd-rgba", "image-fallback"], "rgba RD texture or the (RGBA) image fallback: %s" % tex.kind)
