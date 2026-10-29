extends RefCounted
## WO-732 — pure rule for core/devices_target.gd (unit-tested; the autoload itself needs the running client).
## (WO-802 removed `pick`: a client is never on another server than its own, so there is no "home" to pick.)


## WO-732 P3b — a linked server's origin as this server lists it (host and port from /api/cluster, "" = unknown). WO-802:
## only a name for Caspar-side URLs (host live webpages there); the client never connects to it.
static func peer_origin(peer: Dictionary) -> String:
	var host := str(peer.get("host", "")).strip_edges()
	if host == "" or host.contains("/"):
		return ""
	var port := int(peer.get("port", 4200))
	return "http://%s:%d" % ["[%s]" % host if host.contains(":") else host, port if port > 0 else 4200]


## WO-802 — is `id` among the linked servers of this server's /api/cluster snapshot? (An edit of a server that is no
## longer listed ends by itself.)
static func still_linked(snap: Dictionary, id: String) -> bool:
	for p in snap.get("peers", []):
		if p is Dictionary and str(p.get("id", "")) == id:
			return true
	return false
