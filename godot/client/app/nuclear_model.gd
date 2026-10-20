extends RefCounted
## Nuclear-password gate answers (src/api/routes-system-setup.js checkNuclearPassword): 403 "Invalid password." means
## a password is required and the one sent (or none) was wrong — worth asking; 403 "… not configured." cannot succeed.


static func needs_password(res: Dictionary) -> bool:
	if int(res.get("status", 0)) != 403:
		return false
	var d: Dictionary = res.data if res.get("data") is Dictionary else {}
	var err := str(d.get("error", res.get("error", "")))
	return err.findn("not configured") < 0 and (err.findn("invalid password") >= 0 or d.get("passwordRequired") == true)
