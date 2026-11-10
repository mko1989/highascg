extends RefCounted
## WO-1029 plan 07 C9 — pictures of a screen that is output by ANOTHER linked server (pure: no autoloads, unit-tested).
## The client asks its OWN node for the plain role of the screen, `pgmN` / `prvN` with N = screen index + 1 (the same
## name as for a screen that is here — never a channel number or a server id). The node relays it from the owner
## (src/cluster/feed-relay.js) and marks the descriptor `transport: "feed"`, `relay: {server: {id, name}, state}`.
## Such a role is read from the node's /api/video-feed even when this client runs on the box (shm has no segment for
## it); every other role keeps its transport. Not relayed: multiview cells (composed inside Caspar), inN / chN, audio.


## "pgm3" for (pgm, screen 2); "" when the screen has no relayable role (index ≥ 4, other bus).
static func screen_role(bus: String, idx: int) -> String:
	if not (bus in ["pgm", "prv"]) or idx < 0 or idx > 3:
		return ""
	return "%s%d" % [bus, idx + 1]


## Is this server descriptor a relayed role (picture from another server through this node's feed)?
static func is_relayed(desc: Variant) -> bool:
	return desc is Dictionary and str((desc as Dictionary).get("transport", "")) == "feed"


## The owner's name from a relayed descriptor ("" when not relayed).
static func server_name(desc: Variant) -> String:
	if not is_relayed(desc):
		return ""
	var r: Variant = (desc as Dictionary).get("relay")
	var s: Variant = (r as Dictionary).get("server") if r is Dictionary else null
	return str((s as Dictionary).get("name", (s as Dictionary).get("id", ""))) if s is Dictionary else ""


## The held roles that go over the local node's feed: every role when the client is not on the box (`all_feed`),
## otherwise only the relayed ones.
static func feed_roles(held: Array, descriptors: Dictionary, all_feed: bool) -> Array:
	var out := []
	for r in held:
		if all_feed or is_relayed(descriptors.get(r)):
			out.append(r)
	return out


## What a relayed tile shows: "none" (no frame yet: the placeholder), "live", "stalled" (the last frame greyed with
## "no picture from <box>" — the reader saw nothing for 2 s).
static func tile_state(has_frame: bool, lost: bool) -> String:
	if not has_frame:
		return "none"
	return "stalled" if lost else "live"


## Roles to hold for the remote PGM / PRV windows of the Live compose: only while the tiles are visible, only relayed
## roles. `remote` = per cell, is it a screen on another server; `descriptors` = VideoSurfaces.descriptors.
static func tile_roles(cells: Array, remote: Array, descriptors: Dictionary, visible: bool) -> Array:
	var out := []
	if not visible:
		return out
	for i in cells.size():
		var c: Variant = cells[i]
		if not (c is Dictionary) or i >= remote.size() or not remote[i]:
			continue
		var role := screen_role(str((c as Dictionary).get("role", "")), int((c as Dictionary).get("mainIndex", -1)))
		if role != "" and is_relayed(descriptors.get(role)) and not (role in out):
			out.append(role)
	return out
