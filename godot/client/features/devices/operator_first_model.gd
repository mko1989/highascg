extends RefCounted
## WO-868 — the "Operator GUI first" switch on the Caspar server page (one check under "Channels"): channel 1 = the
## operator GUI and its monitor at x=0; every other Caspar channel moves up by one. Pure: the page state keys, the
## item list, the confirm text built from the server's dry run (POST /api/system/operator-first {dryRun: true}) and
## the status line after the switch. server_flow.gd runs the requests.

const R := preload("res://features/devices/cable_rules.gd")

const TEXT := "Operator GUI first"
const HINT_OFF := "Channel 1 becomes the operator GUI and its monitor moves to the left; every other channel moves up by one. Caspar restarts."
const HINT_ON := "Channel 1 is the operator GUI; its monitor is leftmost."
const PATH := "/api/system/operator-first"


static func init_state(s: Dictionary) -> void:
	s.op_first = null  # unknown until the GET answers (an older server has no route: the check stays disabled)
	s.op_block = ""
	s.op_error = ""


## GET /api/system/operator-first → {enabled, refusals, warnings, channels}.
static func apply_get(s: Dictionary, r: Dictionary) -> void:
	if not r.ok or not r.data is Dictionary:
		s.op_first = null
		s.op_block = ""
		s.op_error = "Not available on this server" + (": " + str(r.error) if str(r.error) != "" else "")
		return
	s.op_first = r.data.get("enabled") == true
	s.op_error = ""
	s.op_block = blocking(r.data)


## Refusals the operator cannot override here (on-air is forceable: the confirm asks instead).
static func blocking(plan: Dictionary) -> String:
	var out := []
	for x in R.a(plan.get("refusals")):
		var d := R.d(x)
		if d.get("forceable") != true:
			out.append(str(d.get("message", d.get("code", ""))))
	return " ".join(out)


static func needs_force(plan: Dictionary) -> bool:
	for x in R.a(plan.get("refusals")):
		if R.d(x).get("forceable") == true:
			return true
	return false


static func items(s: Dictionary) -> Array:
	var on: bool = s.get("op_first") == true
	var blocked: bool = not on and str(s.get("op_block", "")) != ""
	var note := HINT_ON if on else HINT_OFF
	var tone := ""
	if s.get("op_first") == null:
		note = str(s.get("op_error", ""))
		tone = "warn"
	elif blocked:
		note = str(s.op_block)
		tone = "warn"
	return [{"t": "heading", "text": "Channels"},
		{"t": "check", "key": "operator_first", "text": TEXT, "checked": on, "disabled": s.get("op_first") == null or blocked},
		{"t": "small", "text": note, "tone": tone}]


static func _remapped(plan: Dictionary, ch: int) -> int:
	var m := R.d(plan.get("remap"))
	return int(m.get(str(ch), ch))


## The confirm dialog: what moves (channels, monitors), what is rewritten, what to check outside HighAsCG.
static func confirm_text(plan: Dictionary, enable: bool) -> String:
	var lines := ["Turn %s %s?" % [TEXT, "on" if enable else "off"], ""]
	var moves := []
	for x in R.a(R.d(plan.get("channels")).get("before")):
		var d := R.d(x)
		var ch := int(d.get("ch", 0))
		var to := _remapped(plan, ch)
		if to != ch:
			moves.append("%s: %d → %d" % [str(d.get("label", d.get("role", ""))), ch, to])
	if not moves.is_empty():
		lines.append("Caspar channels")
		lines.append_array(moves)
		lines.append("")
	var lay := R.d(plan.get("layout"))
	var before := {}
	for x in R.a(lay.get("before")):
		var d := R.d(x)
		before["%s:%s" % [d.get("kind"), d.get("n")]] = d
	var mon := []
	for x in R.a(lay.get("after")):
		var d := R.d(x)
		var b := R.d(before.get("%s:%s" % [d.get("kind"), d.get("n")]))
		if not b.is_empty() and int(b.get("x", 0)) != int(d.get("x", 0)):
			var name := "Operator GUI" if str(d.get("kind")) == "operator_gui" else "Screen %s" % str(d.get("n"))
			mon.append("%s (%s): x %d → %d" % [name, str(d.get("sysId", "")), int(b.get("x", 0)), int(d.get("x", 0))])
	if not mon.is_empty():
		lines.append("Monitors")
		lines.append_array(mon)
		lines.append("")
	var pr := R.d(plan.get("projects"))
	if int(pr.get("files", 0)) > 0:
		lines.append("Projects: %d renumbered, %d stamped (%d files)" % [int(pr.get("renumbered", 0)), int(pr.get("stamped", 0)), int(pr.get("files", 0))])
	var keys := R.a(R.d(plan.get("persistence")).get("keys"))
	if not keys.is_empty():
		lines.append("Saved state: " + ", ".join(keys))
	var slices := R.a(R.d(plan.get("config")).get("slices"))
	if not slices.is_empty():
		lines.append("Settings: " + ", ".join(slices))
	for x in R.a(plan.get("refusals")) + R.a(plan.get("warnings")):
		lines.append(str(R.d(x).get("message", "")))
	var ext := R.a(plan.get("external"))
	if not ext.is_empty():
		lines.append("")
		lines.append("Check outside HighAsCG:")
		for e in ext:
			lines.append("- " + str(e))
	lines.append("")
	lines.append("A backup is kept in ~/.highascg/backup/. Caspar restarts now.")
	return "\n".join(lines)


## Status line after POST {dryRun: false}.
static func done_text(res: Dictionary, enable: bool) -> String:
	var tail := " — Caspar config written" if not R.d(res.get("apply")).is_empty() else ""
	if str(res.get("applySkipped", "")) == "offline_mode":
		tail = " — offline mode: the Caspar config follows on the next apply"
	return "%s %s%s" % [TEXT, "on: channel 1 is the operator GUI" if enable else "off: legacy channel numbers", tail]
