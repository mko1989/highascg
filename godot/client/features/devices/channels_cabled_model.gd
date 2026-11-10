extends RefCounted
## WO-1029 plan 07 (C12) — the text of the "Channels only for the screens cabled here" switch (Devices → Servers),
## from GET|POST /api/cluster/channels-where-cabled (server src/system/channels-cabled-plan.js). Pure: the flow
## (channels_cabled_flow.gd) asks the server, this turns its dry run into the words of the confirm.

const SWITCH_TEXT := "Channels only for the screens cabled here"
const SWITCH_TIP := "On: this server creates Caspar channels only for the screens its own cables reach (a GPU, SDI, stream, record, "
const SWITCH_TIP_2 := "virtual camera or Local use jack). Every other screen is driven on the server that has it. Needs Apply (restarts Caspar)."


## The endpoint of one server: "" = the server this client talks to, else a linked server's id (through the relay, WO-802).
static func endpoint(peer_id := "") -> String:
	if peer_id == "":
		return "/api/cluster/channels-where-cabled"
	return "/api/cluster/peers/%s/relay/api/cluster/channels-where-cabled" % peer_id.uri_encode()


static func _d(v: Variant) -> Dictionary:
	return v if v is Dictionary else {}


static func _a(v: Variant) -> Array:
	return v if v is Array else []


## GET answer → whether the switch is on, or null when the server does not know the route (an older build).
static func is_on(answer: Variant) -> Variant:
	var d := _d(answer)
	return d.get("on") if d.get("on") is bool else null


static func state_line(answer: Variant) -> String:
	var on: Variant = is_on(answer)
	if on == null:
		return "Not available on this server (older build)."
	return "On: channels only where a screen is cabled here." if on else "Off: every screen has channels here."


## "PGM/PRV 3 (5, 6)" for a removed / added row.
static func row_text(r: Dictionary) -> String:
	var chs := _a(r.get("ch")).map(func(c: Variant) -> String: return str(int(c)))
	var base := str(r.get("label", "?"))
	if chs.is_empty():
		return base
	return "%s (ch %s)" % [base, ", ".join(chs)]


## Refusals the operator can override with "Switch anyway".
static func forceable(plan: Dictionary) -> bool:
	var rs := _a(plan.get("refusals"))
	return not rs.is_empty() and rs.all(func(r: Variant) -> bool: return _d(r).get("forceable") == true)


## Refusals nobody can override: the switch cannot go on.
static func blocked(plan: Dictionary) -> bool:
	return _a(plan.get("refusals")).any(func(r: Variant) -> bool: return _d(r).get("forceable") != true)


## The confirm: what disappears (and why), what is renumbered, what is dropped, refusals, then the outside consumers.
static func confirm_text(plan: Dictionary, server_name: String) -> String:
	var enable: bool = plan.get("enable") == true
	var lines: Array[String] = []
	lines.append("%s: %s" % [server_name if server_name != "" else "This server", "channels only for the screens cabled here" if enable else "channels for every screen again"])
	var removed := _a(plan.get("removed"))
	if not removed.is_empty():
		lines.append("")
		lines.append("These screens lose their channels here:")
		for r in removed:
			lines.append("  • %s: %s" % [row_text(_d(r)), str(_d(r).get("reason", ""))])
	var added := _a(plan.get("added"))
	if not added.is_empty():
		lines.append("")
		lines.append("These screens get channels here:")
		for r in added:
			lines.append("  • " + row_text(_d(r)))
	var kept := _a(plan.get("kept"))
	if not kept.is_empty():
		lines.append("")
		lines.append("Unchanged: " + ", ".join(kept.map(func(k: Variant) -> String: return str(k))))
	var ren := _a(plan.get("renumbered"))
	if not ren.is_empty():
		lines.append("")
		lines.append("Renumbered:")
		for r in ren:
			lines.append("  • %s: %d → %d" % [str(_d(r).get("label", "?")), int(_d(r).get("from", 0)), int(_d(r).get("to", 0))])
	var st := _d(plan.get("state"))
	if int(st.get("dropped", 0)) > 0 or int(st.get("references", 0)) > 0:
		lines.append("")
		lines.append("Saved live state: %d entr%s of removed channels dropped, %d reference(s) renumbered." % [int(st.get("dropped", 0)), "y" if int(st.get("dropped", 0)) == 1 else "ies", int(st.get("references", 0))])
	for r in _a(plan.get("refusals")):
		lines.append("")
		lines.append("Refused: " + str(_d(r).get("message", "")))
	for w in _a(plan.get("warnings")):
		if _d(w).get("code") != "caspar_down":
			lines.append("Note: " + str(_d(w).get("message", "")))
	var ext := _a(plan.get("external"))
	if not ext.is_empty():
		lines.append("")
		lines.append("The server cannot renumber these (check them):")
		for e in ext:
			lines.append("  • " + str(e))
	lines.append("")
	lines.append("Nothing restarts now: press Apply to restart Caspar with the new channels.")
	return "\n".join(lines)


## The line under the switch after the POST.
static func result_line(resp: Dictionary) -> String:
	var d := _d(resp.get("data"))
	if resp.get("ok") == true and d.get("ok") == true:
		return "Switched. Press Apply to restart Caspar with the new channels." if d.get("noop") != true else "Already in that state."
	var err := str(d.get("error", resp.get("error", "")))
	return "Not switched: " + (err if err != "" else "the server refused")
