extends RefCounted
## WO-692 — pure helpers for the Network panel (network_pane.gd; Settings → Network and the Devices server page):
## one card per NIC from GET /api/system/network `nics` (also ports that are down), the apply body, and the Wi-Fi rows
## from GET /api/system/network/wifi.


static func is_ipv4(s: String) -> bool:
	var parts := s.strip_edges().split(".")
	if parts.size() != 4:
		return false
	for p in parts:
		if not p.is_valid_int() or int(p) < 0 or int(p) > 255 or (p.length() > 1 and p.begins_with("0")):
			return false
	return true


## What a NIC card shows and pre-fills. Static fields: the saved profile's, else the address the port has now (so
## switching a DHCP port to static starts from where it is).
static func card(nic: Dictionary, primary: String) -> Dictionary:
	var name := str(nic.get("name", ""))
	var wifi := str(nic.get("kind", "")) == "wifi"
	var addrs: Array = nic.get("addresses", []) if nic.get("addresses") is Array else []
	var now := ", ".join(addrs.map(func(a: Variant) -> String: return "%s/%d" % [a.address, int(a.prefixLength)]))
	var link := "link up" if nic.get("carrier", false) else ("no cable" if not wifi else "not connected")
	var mode := str(nic.get("mode", "unknown"))
	var st: Dictionary = nic.get("static", {}) if nic.get("static") is Dictionary else {}
	var ip := str(st.get("address", ""))
	var prefix := int(st.get("prefixLength", 24))
	if ip == "" and not addrs.is_empty():
		ip = str(addrs[0].address)
		prefix = int(addrs[0].prefixLength)
	var dns: Array = st.get("dns", []) if st.get("dns") is Array else []
	var bits := PackedStringArray([link, now if now != "" else "no IPv4"])
	if mode in ["dhcp", "static"]:
		bits.append("DHCP" if mode == "dhcp" else "static")
	elif (nic.get("connection") == null or str(nic.get("connection")) == "") and not wifi:
		bits.append("not set up yet")
	return {
		"name": name,
		"title": "%s · %s%s" % [name, "Wi-Fi" if wifi else "Ethernet", "  (primary)" if name == primary else ""],
		"status": " · ".join(bits),
		"mac": str(nic.get("mac", "")),
		"wifi": wifi,
		"up": bool(nic.get("carrier", false)),
		"mode": "static" if mode == "static" else "dhcp",
		"ip": ip, "prefix": str(prefix), "gateway": str(st.get("gateway", "")), "dns": str(dns[0]) if not dns.is_empty() else "",
		"addresses": addrs.map(func(a: Variant) -> String: return str(a.address)),
	}


## POST /api/system/network/apply body, or {error}.
static func apply_body(name: String, mode: String, ip: String, prefix: String, gateway: String, dns: String) -> Dictionary:
	if name == "":
		return {"error": "No interface"}
	if mode == "dhcp":
		return {"body": {"interface": name, "mode": "dhcp"}}
	if not is_ipv4(ip):
		return {"error": "Enter a valid IPv4 address (e.g. 192.168.1.20)"}
	var p := prefix.strip_edges()
	if not p.is_valid_int() or int(p) < 1 or int(p) > 32:
		return {"error": "Prefix length must be 1–32 (24 = 255.255.255.0)"}
	if gateway.strip_edges() != "" and not is_ipv4(gateway):
		return {"error": "The gateway must be an IPv4 address or empty"}
	if dns.strip_edges() != "" and not is_ipv4(dns):
		return {"error": "DNS must be an IPv4 address or empty"}
	return {"body": {"interface": name, "mode": "static", "static": {"address": ip.strip_edges(), "prefixLength": int(p),
		"gateway": gateway.strip_edges(), "dns": [dns.strip_edges()] if dns.strip_edges() != "" else []}}}


## The client reaches the server through this port: changing it can cut the GUI off.
static func carries_origin(c: Dictionary, origin: String) -> bool:
	var host := origin.trim_prefix("http://").trim_prefix("https://").get_slice("/", 0).get_slice(":", 0)
	return host in c.addresses


## Wi-Fi list rows: [text, ssid, secured].
static func wifi_rows(st: Dictionary) -> Array:
	var out := []
	for n in st.get("networks", []):
		var sec := str(n.get("security", ""))
		out.append(["%s%s  ·  %d%%%s" % ["✓ " if n.get("inUse", false) else "", n.ssid, int(n.signal),
			"  ·  " + sec if sec != "" else "  ·  open"], str(n.ssid), sec != ""])
	return out


static func wifi_line(st: Dictionary) -> String:
	if not st.get("available", false):
		return "No Wi-Fi adapter on this machine."
	if str(st.get("radio", "")) == "off":
		return "Wi-Fi is off."
	var c: Variant = st.get("connected")
	return "Connected to \"%s\"." % c if c != null and str(c) != "" else "Not connected — pick a network and Join."
