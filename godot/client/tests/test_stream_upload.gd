extends RefCounted
## Streaming multipart uploader — framing + HTTP response parsing (the socket loop runs on the box probe).

const U := preload("res://core/stream_upload.gd")
var t


func test_origin() -> void:
	t.eq(U.parse_origin("http://127.0.0.1:4200"), {"host": "127.0.0.1", "port": 4200}, "host:port")
	t.eq(U.parse_origin("http://box.local/"), {"host": "box.local", "port": 80}, "default port")
	t.eq(U.parse_origin("https://x"), {}, "https refused (raw TCP)")


func test_multipart_framing() -> void:
	var mp := U.multipart_parts("B", "a\"b.mov")
	t.eq(mp.head.get_string_from_utf8(), "--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a_b.mov\"\r\nContent-Type: application/octet-stream\r\n\r\n", "head (quote neutralised)")
	t.eq(mp.tail.get_string_from_utf8(), "\r\n--B--\r\n", "tail")
	var h := U.request_head("h", 4200, "/api/x?path=A%2FB", "B", 123).get_string_from_utf8()
	t.ok(h.begins_with("POST /api/x?path=A%2FB HTTP/1.1\r\n") and h.contains("Content-Length: 123\r\n") and h.ends_with("\r\n\r\n"), "request head")


func test_response_parse() -> void:
	var plain := "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\n\r\n{\"ok\":true}".to_utf8_buffer()
	var r := U.parse_http_response(plain)
	t.eq(r.status, 200, "status")
	t.eq(r.body.get_string_from_utf8(), "{\"ok\":true}", "body")
	var chunked := "HTTP/1.1 409 Conflict\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n{\"err\"\r\n5\r\n:\"x\"}\r\n0\r\n\r\n".to_utf8_buffer()
	var c := U.parse_http_response(chunked)
	t.eq(c.status, 409, "error status")
	t.eq(c.body.get_string_from_utf8(), "{\"err\":\"x\"}", "chunked decoded")
	t.eq(U.parse_http_response("garbage".to_utf8_buffer()).status, 0, "unparseable")


func test_fields_go_before_the_file() -> void:
	var mp := U.multipart_parts("B", "a.png", {"path": "projects/x"})
	t.eq(mp.head.get_string_from_utf8(), "--B\r\nContent-Disposition: form-data; name=\"path\"\r\n\r\nprojects/x\r\n--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.png\"\r\nContent-Type: application/octet-stream\r\n\r\n", "path field first (busboy order)")
