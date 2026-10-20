extends RefCounted
## Nuclear-password gate answers → ask or not.

const N := preload("res://app/nuclear_model.gd")
var t


func test_needs_password() -> void:
	t.eq(N.needs_password({"status": 200, "data": {}}), false)
	t.eq(N.needs_password({"status": 403, "data": {"error": "Invalid password."}}), true)
	t.eq(N.needs_password({"status": 403, "data": {"ok": false, "error": "Invalid password.", "passwordRequired": true}}), true)
	t.eq(N.needs_password({"status": 403, "data": {"error": "Nuclear password required but not configured.", "passwordRequired": true}}), false,
		"not configured cannot succeed")
	t.eq(N.needs_password({"status": 403, "data": null, "error": "Invalid password."}), true, "error from the parsed response")
	t.eq(N.needs_password({"status": 403, "data": {"error": "Forbidden"}}), false)
