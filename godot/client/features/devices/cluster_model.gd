extends RefCounted
## WO-670 P2 — pure helpers of cluster_panel.gd (the linked servers under the cables list). The role a server plays
## for a shared destination follows the cables in each server's own Devices view (WO-670 design): cabled here and on
## the peer → the peer is its backup; cabled only on the peer → the peer extends the show with it.

const PARITY := {"same": "media ✓", "differs": "media differs", "other-show": "other show", "unknown": "media ?"}


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
