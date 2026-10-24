extends RefCounted
## WO-670 P2 — pure helpers of cluster_panel.gd (the linked servers under the cables list). The role a server plays
## for a shared destination follows the cables in each server's own Devices view (WO-670 design): cabled here and on
## the peer → the peer is its backup; cabled only on the peer → the peer extends the show with it.

const PARITY := {"same": "media ✓", "differs": "media differs", "other-show": "other show", "unknown": "media ?"}

## WO-723 — what a linked server's "Does:" line names, from its ping `duties` (resolved from its config and the links
## by server src/cluster/server-duties.js — never ticked). Media is not listed: that is the destinations above.
const DOES := [["tracking", "tracking"], ["lighting", "lights out"], ["ptz", "PTZ out"]]


## destination id → its label, for every destination cabled in this device-view payload.
static func cabled(payload: Dictionary) -> Dictionary:
	var graph: Dictionary = payload.get("graph", {}) if payload.get("graph") is Dictionary else {}
	var dest_of := {}
	for c in graph.get("connectors", []):
		if c is Dictionary and c.get("kind") == "destination_in" and str(c.get("externalRef", "")) != "":
			dest_of[str(c.id)] = str(c.externalRef)
	var labels := {}
	var sd: Variant = payload.get("screenDestinations")
	for d in (sd.get("destinations", []) if sd is Dictionary else []):
		if d is Dictionary:
			labels[str(d.get("id", ""))] = str(d.get("label", "")) if str(d.get("label", "")) != "" else str(d.get("id", ""))
	var out := {}
	for e in graph.get("edges", []):
		if e is Dictionary and dest_of.has(str(e.get("sourceId", ""))) and str(e.get("sinkId", "")) != "":
			var did: String = dest_of[str(e.sourceId)]
			out[did] = labels.get(did, did)
	return out


## [{id, label, role: "backup" | "extension"}] — what the peer does for each destination it has cabled.
static func roles(own: Dictionary, peer: Dictionary) -> Array:
	var mine := cabled(own)
	var theirs := cabled(peer)
	var out := []
	for did in theirs:
		out.append({"id": did, "label": theirs[did], "role": "backup" if mine.has(did) else "extension"})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.label < b.label)
	return out


static func roles_text(list: Array) -> String:
	if list.is_empty():
		return "No destination cabled on this server."
	return " · ".join(PackedStringArray(list.map(func(r: Dictionary) -> String: return "%s: %s" % [r.label, r.role])))


## One line under the server's name.
static func facts(p: Dictionary) -> String:
	var bits := ["%s:%d" % [str(p.get("host", "")), int(p.get("port", 4200))]]
	if str(p.get("version", "")) != "":
		bits.append(str(p.version))
	if str(p.get("role", "")) != "":
		bits.append(str(p.role))
	if p.get("program_channels") != null:
		bits.append("%d program ch" % int(p.program_channels))
	bits.append(PARITY.get(str(p.get("media_parity", "unknown")), "media ?"))
	if p.get("online") == false and str(p.get("error", "")) != "":
		bits.append("offline: " + str(p.error))
	return " · ".join(PackedStringArray(bits))


## WO-732 — "" while the link holds both ways (or nothing is known yet); else why that server does not list this one
## (the server keeps asking it again, src/cluster/cluster-peers.js heal()).
static func link_line(p: Dictionary) -> String:
	if p.get("linked_back") != false:
		return ""
	var why := str(p.get("link_back_error", ""))
	return "One-way: %s does not list this server%s." % [str(p.get("name", "it")), " (%s)" % why if why != "" else ", asking it again"]


## WO-723 — the one line on a linked server's card ("" from an older server: its duties carry no `tracking`, they
## were WO-712 R1 ticks, not what it does).
static func does_text(duties: Variant) -> String:
	if not duties is Dictionary or not (duties as Dictionary).has("tracking"):
		return ""
	var bits := PackedStringArray()
	for d in DOES:
		if duties.get(d[0]) == true:
			bits.append(str(d[1]))
	if duties.get("accept_remote", true) != true:
		bits.append("refuses remote actions")
	return "" if bits.is_empty() else "Does: " + " · ".join(bits)


## WO-723 — the "Sent by" / "Received by" items (sender_picker.gd) from GET /api/server/senders: [{text, by, tip}],
## Auto first (naming who Auto picks now), then every server. A server that refused the choices (an older version
## keeps its own settings) says "not in sync". [] while no server is linked: the picker hides.
static func sender_items(view: Variant, kind: String) -> Array:
	var servers: Array = view.get("servers", []) if view is Dictionary and view.get("servers") is Array else []
	if servers.size() < 2:
		return []
	var s := sender_of(view, kind)
	var auto_name := str(s.get("auto_name", ""))
	var items := [{"text": "Auto — every server" if auto_name == "*" else ("Auto — " + auto_name if auto_name != "" else "Auto"), "by": "", "tip": ""}]
	for srv in servers:
		if srv is Dictionary and str(srv.get("fp", "")) != "":
			var t := str(srv.get("name", ""))
			var tip := ""
			if srv.get("self") == true:
				t += " (this server)"
			elif srv.get("online") != true:
				t += " (offline)"
			elif str(srv.get("refused", "")) != "":
				t += " (not in sync)"
				tip = "It did not take this choice (%s). An older HighAsCG keeps its own settings: update it." % str(srv.refused)
			items.append({"text": t, "by": str(srv.fp), "tip": tip})
	return items


static func sender_of(view: Variant, kind: String) -> Dictionary:
	var all: Variant = view.get("senders") if view is Dictionary else null
	return all.get(kind) if all is Dictionary and all.get(kind) is Dictionary else {}


## The item the choice is on (Auto when it names a server that is not listed).
static func sender_index(view: Variant, kind: String) -> int:
	var by := str(sender_of(view, kind).get("by", ""))
	var items := sender_items(view, kind)
	for i in items.size():
		if str(items[i].by) == by:
			return i
	return 0


static func sending(p: Dictionary) -> bool:
	return p.get("media_send") is Dictionary and str(p.media_send.get("state", "")) == "sending"


static func send_failed(p: Dictionary) -> bool:
	return p.get("media_send") is Dictionary and str(p.media_send.get("state", "")) == "failed"


## The line under a server's name about the last Send media (refusal from this click wins).
static func send_line(p: Dictionary, refused: String) -> String:
	if refused != "":
		return refused
	var s: Variant = p.get("media_send")
	if not s is Dictionary:
		return ""
	match str(s.get("state", "")):
		"sending":
			return "Sending media… %d %%" % int(s.get("percent", 0))
		"done":
			return "Media sent (%d path%s)." % [int(s.get("files", 0)), "" if int(s.get("files", 0)) == 1 else "s"]
		"failed":
			return "Media send failed: " + str(s.get("error", ""))
	return ""


## P3a — the master line under the SERVERS header (server cluster-master.js view: epoch, master_id, is_master, auto,
## succession [{key_id, id, name}]).
static func master_line(m: Dictionary) -> String:
	if int(m.get("epoch", 0)) <= 0:
		return "No master yet: Make master on the server that runs the show."
	var who := "this server" if m.get("is_master") == true else master_name(m)
	return "Master: %s · epoch %d · %s" % [who, int(m.epoch), "auto failover" if m.get("auto") == true else "failover by hand"]


static func master_name(m: Dictionary) -> String:
	for s in m.get("succession", []):
		if s is Dictionary and str(s.get("key_id", "")) == str(m.get("master", "")):
			return str(s.get("name", ""))
	return "a server not linked here"


static func is_master(m: Dictionary, peer_id: String) -> bool:
	return int(m.get("epoch", 0)) > 0 and str(m.get("master_id", "")) == peer_id


## P4a/b — the line on a server's card while this server is master (server cluster-fanout.js status: fanout.peers[id] =
## {caspar, connected, sent, error, destinations [{label, pgm: [mine, theirs], prv}], caught_up {lines}}).
static func fanout_line(snap: Dictionary, peer_id: String) -> String:
	var f: Dictionary = snap.get("fanout", {}) if snap.get("fanout") is Dictionary else {}
	var peers: Dictionary = f.get("peers", {}) if f.get("peers") is Dictionary else {}
	if f.get("active") != true or not peers.get(peer_id) is Dictionary:
		return ""
	var p: Dictionary = peers[peer_id]
	if str(p.get("error", "")) != "":
		return "Takes not forwarded: " + str(p.error)
	if p.get("connected") != true:
		return "Takes not forwarded: its Caspar %s does not answer" % str(p.get("caspar", ""))
	var bits := PackedStringArray()
	for d in p.get("destinations", []):
		if d is Dictionary:
			var chs := "ch %d→%d" % [int(d.pgm[0]), int(d.pgm[1])]
			if d.get("prv") is Array:
				chs += ", %d→%d" % [int(d.prv[0]), int(d.prv[1])]
			bits.append("%s (%s)" % [str(d.get("label", d.get("id", ""))), chs])
	var line := "Takes forwarded: " + ", ".join(bits) + " · %d sent" % int(p.get("sent", 0))
	if p.get("caught_up") is Dictionary and int(p.caught_up.get("lines", 0)) > 0:
		line += " · caught up (%d lines)" % int(p.caught_up.get("lines", 0))
	return line


static func is_fanout_error(line: String) -> bool:
	return line.begins_with("Takes not forwarded")


## P4b — under the master line on a server that is not master: its PGM follows the master.
static func follow_note(snap: Dictionary) -> String:
	if snap.get("follows_master") == true:
		return "PGM here is driven by the master: local PGM takes are skipped (PRV still works)."
	return ""
