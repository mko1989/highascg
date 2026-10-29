extends RefCounted
## WO-811 phase 3 — Settings → Nuclear "Change casparcg login password…": the request the button posts and the text it
## shows. Pure (tests run without autoloads). The node opens `passwd` in a terminal on the box's own screen (:0) and
## accepts the request only from the box itself (src/api/box-local-request.js); off the box the button is disabled
## (owner 29.10: only from the box's own screen). No password ever passes through this client or the node.

const Platform := preload("res://core/platform.gd")

const PATH := "/api/system/gui-launch"
const ACTION := "os-password"
const LABEL := "Change casparcg login password…"
const NOTE := ("Also the sudo and SSH password. Opens a terminal on this box's screen: type the current password, then "
	+ "the new one twice. Auto-login is not affected. A forgotten password cannot be reset here.")
const OFF_BOX := "Only on the box's own screen (this client is connected to another machine)."


## The body for NuclearGate.post(PATH, …) — a fixed action, nothing else.
static func request_body() -> Dictionary:
	return {"action": ACTION}


## The button works only when this client runs on the box (its server is on loopback).
static func available(origin: String) -> bool:
	return Platform.is_local_origin(origin)


## Status line after the POST.
static func result_text(res: Dictionary) -> String:
	var d: Dictionary = res.get("data") if res.get("data") is Dictionary else {}
	if res.get("ok") == true:
		return str(d.get("note", "Terminal opened on the box screen — finish there."))
	return "Password change not started: %s" % str(d.get("error", res.get("error", "failed")))
