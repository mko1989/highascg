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


func test_new_password_needs_the_repeat_to_match() -> void:
	t.eq(N.new_password_error("", ""), "Type the new password first.", "empty is never a password")
	t.eq(N.new_password_error("hunter2", "hunter3") != "", true, "a typo in either entry changes nothing")
	t.eq(N.new_password_error("hunter2", ""), "The two entries differ - nothing changed.")
	t.eq(N.new_password_error("hunter2", "hunter2"), "")
	t.eq(N.new_password_error(" hunter2 ", "hunter2"), "", "surrounding blanks are stripped on both, like the post")
