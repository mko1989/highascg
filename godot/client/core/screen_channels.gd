extends RefCounted
## WO-1029 plan 07 (C15) — the ONE place that turns a screen index into a Caspar channel of THIS server.
## With cluster.channelsWhereCabled on, channelMap.programChannels / previewChannels hold `null` for a screen cabled on
## another linked server (box A: [2, null, null, null], box B: [null, null, 2, 4]); channelMap.screenHosts says
## [{idx, destId, here, pgm, prv, owners?}]. A null is NOT "channel 1" and not "(i+1)*2": it means "not on this server".
## Everything below is pure (no autoloads), `cm` = state.channelMap. Flag off / older server / simulator: every screen
## index below screenCount (or below the array length) is here, exactly as before.

const NONE := -1


static func _arr(cm: Variant, key: String) -> Array:
	return (cm as Dictionary).get(key) if cm is Dictionary and (cm as Dictionary).get(key) is Array else []


static func _num(v: Variant) -> int:
	return int(v) if v is int or v is float else NONE


## Program channel of screen `idx` on this server, or -1 (hole / unknown).
static func pgm(cm: Variant, idx: int) -> int:
	var a := _arr(cm, "programChannels")
	return _num(a[idx]) if idx >= 0 and idx < a.size() else NONE


## Preview channel of screen `idx` on this server, or -1 (hole, or a PGM-only screen).
static func prv(cm: Variant, idx: int) -> int:
	var a := _arr(cm, "previewChannels")
	return _num(a[idx]) if idx >= 0 and idx < a.size() else NONE


## How many screens the show has (the shared count; holes included).
static func screen_count(cm: Variant) -> int:
	var n := _num((cm as Dictionary).get("screenCount")) if cm is Dictionary else NONE
	return maxi(maxi(n, _arr(cm, "programChannels").size()), 1)


static func holes_on(cm: Variant) -> bool:
	return cm is Dictionary and (cm as Dictionary).get("channelsWhereCabled") == true


## screenHosts entry of `idx` ({} when the server publishes none).
static func host_entry(cm: Variant, idx: int) -> Dictionary:
	for h in _arr(cm, "screenHosts"):
		if h is Dictionary and int((h as Dictionary).get("idx", -1)) == idx:
			return h
	return {}


## Is screen `idx` output by THIS server? Legacy maps (flag off): every screen is.
static func is_here(cm: Variant, idx: int) -> bool:
	if idx < 0:
		return false
	if not holes_on(cm):
		return true
	var h := host_entry(cm, idx)
	if h.has("here"):
		return h.get("here") == true
	return pgm(cm, idx) != NONE or prv(cm, idx) != NONE


## Screens on this server, ascending.
static func local_screens(cm: Variant) -> Array:
	var out := []
	for i in screen_count(cm):
		if is_here(cm, i):
			out.append(i)
	return out


## Screens on other servers, ascending.
static func remote_screens(cm: Variant) -> Array:
	var out := []
	for i in screen_count(cm):
		if not is_here(cm, i):
			out.append(i)
	return out


## First screen on this server, -1 when none (a box that outputs no screen).
static func first_local(cm: Variant) -> int:
	var l := local_screens(cm)
	return int(l[0]) if not l.is_empty() else NONE


## The screen whose PGM or PREVIEW channel is `ch` (-1 = none, e.g. a null entry never matches).
static func screen_of_channel(cm: Variant, ch: int) -> int:
	if ch < 0:
		return NONE
	for i in maxi(_arr(cm, "programChannels").size(), _arr(cm, "previewChannels").size()):
		if pgm(cm, i) == ch or prv(cm, i) == ch:
			return i
	return NONE


## Server ids that output screen `idx` (screenHosts[].owners, ids or {id}/{name} objects), [] when unknown.
static func owners(cm: Variant, idx: int) -> Array:
	var out := []
	var raw: Variant = host_entry(cm, idx).get("owners")
	for o in (raw if raw is Array else []):
		out.append(str((o as Dictionary).get("id", (o as Dictionary).get("name", ""))) if o is Dictionary else str(o))
	return out


## The screen index of destination `dest_id` (screenHosts), else `fallback` (its mainScreenIndex).
static func screen_of_dest(cm: Variant, dest_id: String, fallback := -1) -> int:
	for h in _arr(cm, "screenHosts"):
		if h is Dictionary and str((h as Dictionary).get("destId", "")) == dest_id and dest_id != "":
			return int(h.get("idx", fallback))
	return fallback


## Where screen `idx` is: {here, idx, destId, owners: [ids], name} — `name` is the server's display name from the
## cluster snapshot (GET /api/cluster: {self, peers: [{id, name, hostname}]}), "" when it cannot be told.
## Without owners in the map: exactly one linked server → that one; otherwise "" (the caller words it "another server").
static func host(cm: Variant, idx: int, cluster: Variant = null) -> Dictionary:
	var here := is_here(cm, idx)
	var ids := owners(cm, idx) if not here else []
	var peers: Array = (cluster as Dictionary).get("peers", []) if cluster is Dictionary and (cluster as Dictionary).get("peers") is Array else []
	var names := []
	for id in ids:
		names.append(_peer_name(peers, cluster, str(id)))
	if ids.is_empty() and not here and peers.size() == 1 and peers[0] is Dictionary:
		ids = [str((peers[0] as Dictionary).get("id", ""))]
		names = [_peer_name(peers, cluster, str(ids[0]))]
	return {"here": here, "idx": idx, "destId": str(host_entry(cm, idx).get("destId", "")), "owners": ids, "name": " / ".join(PackedStringArray(names))}


static func _peer_name(peers: Array, cluster: Variant, id: String) -> String:
	for p in peers:
		if p is Dictionary and str((p as Dictionary).get("id", "")) == id:
			return str((p as Dictionary).get("name", (p as Dictionary).get("hostname", id)))
	var me: Variant = (cluster as Dictionary).get("self") if cluster is Dictionary else null
	if me is Dictionary and str((me as Dictionary).get("id", "")) == id:
		return str((me as Dictionary).get("hostname", id))
	return id


## "on highascg5867" / "on another server" for a remote screen, "" for one that is here.
## `hint`: the owner's own name from scene.remoteLive[idx].server.name — authoritative when given.
static func cue(cm: Variant, idx: int, cluster: Variant = null, hint := "") -> String:
	if is_here(cm, idx):
		return ""
	var n := hint if hint != "" else str(host(cm, idx, cluster).get("name", ""))
	return "on " + (n if n != "" else "another server")


## Tooltip of a control that cannot act on a remote screen.
static func disabled_tip(cm: Variant, idx: int, cluster: Variant = null, hint := "") -> String:
	var c := cue(cm, idx, cluster, hint)
	return "" if c == "" else "This screen is %s — drive it from there." % c


## "Screens 2, 3, 4 are on highascg5867" — one quiet line for panels that list this server's screens only
## (multiview, Devices); "" when every screen is here. Several owners → one clause each, "; "-joined.
static func remote_note(cm: Variant, cluster: Variant = null) -> String:
	var by_cue := {}
	for i in remote_screens(cm):
		var c := cue(cm, i, cluster)
		if not by_cue.has(c):
			by_cue[c] = []
		(by_cue[c] as Array).append(str(i + 1))
	var bits := PackedStringArray()
	for c in by_cue:
		var nums: Array = by_cue[c]
		bits.append("Screen%s %s %s %s" % ["s" if nums.size() > 1 else "", ", ".join(PackedStringArray(nums)), "are" if nums.size() > 1 else "is", c])
	return "; ".join(bits)
