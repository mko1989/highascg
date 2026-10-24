extends RefCounted
## WO-670 P3b — pure helpers of app/cluster_follow.gd: this client follows the cluster's master (server
## cluster-master.js). From the `cluster:peers` snapshot of the server it is on, it remembers every server of the
## cluster (ui.cfg [cluster] servers) and where the master is; when its server is gone it asks the remembered ones
## which is master.


static func host_of(origin: String) -> String:
	var s := origin
	for p in ["http://", "https://"]:
		if s.begins_with(p):
			s = s.substr(p.length())
	s = s.get_slice("/", 0)
	if s.begins_with("["):
		return s.get_slice("]", 0) + "]"
	return s.get_slice(":", 0)


## A peer as this client reaches it: a loopback address in the server's view is that server's own host.
static func peer_origin(current: String, peer: Dictionary) -> String:
	var host := str(peer.get("host", ""))
	if host == "":
		return ""
	if host in ["127.0.0.1", "localhost", "::1"]:
		host = host_of(current)
	return "http://%s:%d" % [host, int(peer.get("port", 4200))]


static func port_of(origin: String) -> int:
	var s := origin
	for p in ["http://", "https://"]:
		if s.begins_with(p):
			s = s.substr(p.length())
	s = s.get_slice("/", 0)
	var tail := s.get_slice("]", 1) if s.begins_with("[") else s
	return int(tail.get_slice(":", 1)) if tail.count(":") == 1 else (443 if origin.begins_with("https://") else 80)


## The origin to go to: `home` when `origin` is this machine under one of its own addresses (its LAN IP as a linked
## server lists it) and home is loopback — the on-box client keeps 127.0.0.1 and shared-memory pictures. WO-724: a
## real failover round trip left the kiosk on http://<own LAN IP>:4200, i.e. on the JPEG feed of its own box.
static func resolve_target(origin: String, home: String, local_addrs: PackedStringArray) -> String:
	if origin == "" or not host_of(home) in ["127.0.0.1", "localhost", "::1"]:
		return origin
	if host_of(origin) in ["127.0.0.1", "localhost", "::1"] or (host_of(origin) in local_addrs and port_of(origin) == port_of(home)):
		return home
	return origin


## This server + every linked one (the list kept for when this server is gone).
static func servers(current: String, snap: Dictionary) -> PackedStringArray:
	var out := PackedStringArray([current])
	for p in snap.get("peers", []):
		if p is Dictionary:
			var o := peer_origin(current, p)
			if o != "" and not out.has(o):
				out.append(o)
	return out


## The master's origin when it is another (online) server, else "".
static func master_origin(current: String, snap: Dictionary) -> String:
	var m: Dictionary = snap.get("master", {}) if snap.get("master") is Dictionary else {}
	var id := str(m.get("master_id", ""))
	if int(m.get("epoch", 0)) <= 0 or id == "" or id == "self":
		return ""
	for p in snap.get("peers", []):
		if p is Dictionary and str(p.get("id", "")) == id and p.get("online") == true:
			return peer_origin(current, p)
	return ""


static func master_name(snap: Dictionary) -> String:
	var m: Dictionary = snap.get("master", {}) if snap.get("master") is Dictionary else {}
	for p in snap.get("peers", []):
		if p is Dictionary and str(p.get("id", "")) == str(m.get("master_id", "")):
			return str(p.get("name", p.id))
	return "another server"


## probes: [{origin, ok, data: GET /api/cluster/master}] → the origin that says it is master (highest epoch); with no
## master answering, `home` (where this client goes without the cluster) if it answers; else "".
static func pick(probes: Array, home := "") -> String:
	var best := ""
	var epoch := 0
	for p in probes:
		if p is Dictionary and p.get("ok") == true and p.get("data") is Dictionary:
			var d: Dictionary = p.data
			if d.get("is_master") == true and int(d.get("epoch", 0)) > epoch:
				epoch = int(d.epoch)
				best = str(p.origin)
	if best == "" and home != "":
		for p in probes:
			if p is Dictionary and str(p.get("origin", "")) == home and p.get("ok") == true:
				return home
	return best


## WO-726: this client followed a master to another server, and that server is no longer in a cluster with this
## client's home — unlinked (no master, epoch 0) or none of its linked servers is home — so the follow is over. A
## kiosk that followed the master during WO-724's tests stayed on the other box after the unlink, driving it.
static func follow_over(snap: Dictionary, current: String, home: String, local_addrs: PackedStringArray) -> bool:
	if current == home:
		return false
	var m: Variant = snap.get("master")
	if not m is Dictionary or int(m.get("epoch", 0)) <= 0:
		return true
	for p in snap.get("peers", []):
		if p is Dictionary and resolve_target(peer_origin(current, p), home, local_addrs) == home:
			return false
	return true
