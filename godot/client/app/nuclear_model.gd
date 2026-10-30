extends RefCounted
## Nuclear-password gate answers (src/api/routes-system-setup.js checkNuclearPassword): 403 "Invalid password." means
## a password is required and the one sent (or none) was wrong — worth asking; 403 "… not configured." cannot succeed.


static func needs_password(res: Dictionary) -> bool:
	if int(res.get("status", 0)) != 403:
		return false
	var d: Dictionary = res.data if res.get("data") is Dictionary else {}
	var err := str(d.get("error", res.get("error", "")))
	return err.findn("not configured") < 0 and (err.findn("invalid password") >= 0 or d.get("passwordRequired") == true)


## WO-830c: why the "Set password" action must not run ("" = fine). Setting is explicit (a button + a repeat entry), never
## a side effect of typing or leaving the field: a typo'd value used to replace the stored password on focus-out.
static func new_password_error(first: String, again: String) -> String:
	var a := first.strip_edges()
	if a == "":
		return "Type the new password first."
	if a != again.strip_edges():
		return "The two entries differ - nothing changed."
	return ""
