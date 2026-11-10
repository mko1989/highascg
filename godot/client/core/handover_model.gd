extends RefCounted
## WO-1029 — the decision of the remote-client handover (RULES.md "Linked servers" 6, contract rule 8). PURE: no nodes,
## no I/O, no clock of its own — app/handover_watch.gd gathers the inputs and executes the answer. All times are unix
## seconds (the cue after a restart needs them to outlive the process).
##
## A client that was pointed at another machine works like a local client of that box. When that box has not answered
## for HANDOVER_AFTER and a server it LINKS TO (as the box itself reported them) confirms the loss, the client moves
## there by itself. The on-box client (loopback origin) never moves, whatever the cluster says (WO-802).
##
## State dictionary (decide):
##   local        bool   the origin is this machine
##   now          float  unix seconds
##   ws_down_since / http_down_since   float, -1 while that path answers
##   box          {id, host}  the connected box as it described itself (identity for "lists the old box offline")
##   targets      [{id, name, origin}]  learned from the box (parse / learn_targets); NOTHING else is ever a target
##   answers      {origin: {ok, auth, is_master, settled, peers: [{id, host, online}]}}  last GET /api/cluster of each
##   busy         bool   operator mid-drag or a modal dialog is open
##   last_move    float  unix seconds of the last handover (-1 = none)
##   home         {origin, name}  the box this client was handed over from ("" origin = none)
##   home_up      bool   home answers GET /api/cluster again
## Result: {action: stay | move | offer | offer_return, target: {id, name, origin}, waiting: bool, cue: String}

const HANDOVER_AFTER := 5.0  ## s the connected box is silent on HTTP and WS before a target is asked
const HOLD := 30.0  ## s after a move with no further automatic move (no flapping)
const SECTION := "handover"


static func target_origin(host: String, port: int) -> String:
	return "http://%s:%d" % [host, port if port > 0 else 4200]


## Targets from a box's `GET /api/cluster` answer: its `peers[]` (id, name, host, port). Only what the box reports.
static func learn_targets(cluster: Variant) -> Array:
	var out := []
	var peers: Variant = cluster.get("peers") if cluster is Dictionary else null
	for p in (peers if peers is Array else []):
		if p is Dictionary and str(p.get("host", "")) != "":
			var id := str(p.get("id", ""))
			out.append({"id": id, "name": str(p.get("name", "")) if str(p.get("name", "")) != "" else id,
				"origin": target_origin(str(p.host), int(p.get("port", 4200)))})
	return out


## What a target's (or the old box's) `GET /api/cluster` says about the cluster, reduced to what the decision reads.
static func read_answer(cluster: Variant) -> Dictionary:
	var m: Variant = cluster.get("master") if cluster is Dictionary else null
	var peers := []
	for p in (cluster.get("peers", []) if cluster is Dictionary and cluster.get("peers") is Array else []):
		if p is Dictionary:
			peers.append({"id": str(p.get("id", "")), "host": str(p.get("host", "")), "online": p.get("online") != false})
	return {"ok": cluster is Dictionary, "auth": true,
		"id": str((cluster.get("self") as Dictionary).get("id", "")) if cluster is Dictionary and cluster.get("self") is Dictionary else "",
		"is_master": m is Dictionary and (m as Dictionary).get("is_master") == true,
		"settled": m is Dictionary and (m as Dictionary).get("settled") != false, "peers": peers}


## The box as it described itself: {id, host}.
static func box_of(cluster: Variant, origin: String) -> Dictionary:
	var self_v: Variant = cluster.get("self") if cluster is Dictionary else null
	return {"id": str((self_v as Dictionary).get("id", "")) if self_v is Dictionary else "", "host": host_of(origin)}


static func host_of(origin: String) -> String:
	var s := origin.trim_prefix("http://").trim_prefix("https://").get_slice("/", 0)
	return s.get_slice("]", 0) + "]" if s.begins_with("[") else s.get_slice(":", 0)


## Does this target's answer confirm that the old box is gone? It is master now, or it lists the old box offline.
static func confirms(answer: Dictionary, box: Dictionary) -> bool:
	if not bool(answer.get("ok", false)) or not bool(answer.get("auth", true)):
		return false
	if answer.get("is_master") == true and answer.get("settled") != false:
		return true
	for p in answer.get("peers", []):
		var same: bool = (str(box.get("id", "")) != "" and str(p.get("id", "")) == str(box.id)) \
			or (str(box.get("host", "")) != "" and str(p.get("host", "")) == str(box.host))
		if same and p.get("online") == false:
			return true
	return false


## Seconds both paths have been silent (0 while either answers).
static func silent_for(s: Dictionary) -> float:
	var ws := float(s.get("ws_down_since", -1.0))
	var http := float(s.get("http_down_since", -1.0))
	if ws < 0.0 or http < 0.0:
		return 0.0
	return maxf(0.0, float(s.now) - maxf(ws, http))


static func decide(s: Dictionary) -> Dictionary:
	var stay := {"action": "stay", "target": {}, "waiting": false, "cue": ""}
	if bool(s.get("local", true)):  # WO-802: the on-box client never moves
		return stay
	var home: Dictionary = s.get("home", {}) if s.get("home") is Dictionary else {}
	var silent := silent_for(s)
	if silent < HANDOVER_AFTER:
		if str(home.get("origin", "")) != "" and bool(s.get("home_up", false)):  # contract 6: stay, offer to return
			return {"action": "offer_return", "target": {"id": "", "name": str(home.get("name", "")), "origin": str(home.origin)},
				"waiting": false, "cue": "%s is back — return?" % _label(home)}
		return stay
	var box: Dictionary = s.get("box", {}) if s.get("box") is Dictionary else {}
	var answers: Dictionary = s.get("answers", {}) if s.get("answers") is Dictionary else {}
	var confirmed := []
	var answering := []
	for t in s.get("targets", []):  # only what the box reported ever gets considered
		var a: Variant = answers.get(str(t.get("origin", "")))
		if a is Dictionary and bool((a as Dictionary).get("ok", false)):
			answering.append(t)
			if confirms(a, box):
				confirmed.append(t)
	if answering.is_empty():
		return stay  # nobody to go to: keep retrying the first box
	if not confirmed.is_empty():
		var pick: Dictionary = confirmed[0]
		for t in confirmed:  # prefer the target that is master
			if (answers[t.origin] as Dictionary).get("is_master") == true:
				pick = t
				break
		var since_move := float(s.now) - float(s.get("last_move", -1.0)) if float(s.get("last_move", -1.0)) >= 0.0 else INF
		if since_move < HOLD:
			return stay
		if bool(s.get("busy", false)):
			return {"action": "stay", "target": pick, "waiting": true,
				"cue": "handing over to %s — waiting…" % _label(pick)}
		return {"action": "move", "target": pick, "waiting": false, "cue": "moving to %s" % _label(pick)}
	var other: Dictionary = answering[0]
	for t in answering:
		if (answers[t.origin] as Dictionary).get("is_master") == true:
			other = t
			break
	return {"action": "offer", "target": other, "waiting": false,
		"cue": "%s is not answering from here — continue on %s?" % [host_of_box(box), _label(other)]}


static func host_of_box(box: Dictionary) -> String:
	return str(box.get("host", "the server"))


static func _label(t: Dictionary) -> String:
	if str(t.get("name", "")) != "":
		return str(t.name)
	return host_of(str(t.get("origin", "")))


## The persistent amber cue after a move (contract 5): "on B — handed over from A 14:32".
static func cue_text(new_name: String, old_name: String, at_unix: float) -> String:
	return "on %s — handed over from %s %s" % [new_name, old_name, hhmm(at_unix)]


static func hhmm(at_unix: float) -> String:
	var d := Time.get_datetime_dict_from_unix_time(int(at_unix) + int(Time.get_time_zone_from_system().get("bias", 0)) * 60)
	return "%02d:%02d" % [int(d.hour), int(d.minute)]


## The learned list and the box's identity, as one string per origin in ui.cfg [handover] (contract 2: next start).
static func serialise(box: Dictionary, targets: Array) -> String:
	return JSON.stringify({"box": box, "targets": targets})


static func parse(raw: Variant) -> Dictionary:
	var out := {"box": {"id": "", "host": ""}, "targets": []}
	var v: Variant = JSON.parse_string(str(raw)) if str(raw) != "" else null
	if not (v is Dictionary):
		return out
	var b: Variant = v.get("box")
	if b is Dictionary:
		out.box = {"id": str(b.get("id", "")), "host": str(b.get("host", ""))}
	for t in (v.get("targets", []) if v.get("targets") is Array else []):
		if t is Dictionary and str(t.get("origin", "")) != "":
			out.targets.append({"id": str(t.get("id", "")), "name": str(t.get("name", "")), "origin": str(t.origin)})
	return out


static func load_cfg(cfg: ConfigFile, origin: String) -> Dictionary:
	return parse(cfg.get_value(SECTION, origin, ""))


static func store_cfg(cfg: ConfigFile, origin: String, box: Dictionary, targets: Array) -> void:
	cfg.set_value(SECTION, origin, serialise(box, targets))
