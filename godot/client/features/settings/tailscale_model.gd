extends RefCounted
## WO-608 — pure helpers for Settings → Tailscale (web settings-modal-tailscale.js renderStatus).


static func summary(st: Dictionary) -> String:
	if st.get("connected") == true:
		return "Connected (%s)" % _or(st.get("backendState"), "Running")
	if st.get("needsLogin") == true:
		return "Login required (%s)" % _or(st.get("backendState"), "NeedsLogin")
	if st.get("installed") == true:
		return "Not connected (%s)" % _or(st.get("backendState"), "unknown")
	return "Tailscale CLI not installed"


static func auth_url(st: Dictionary) -> String:
	return str(st.get("authUrl", "") if st.get("authUrl") != null else "").strip_edges()


## [label, value] rows for the key/value block.
static func rows(st: Dictionary) -> Array:
	var d: Dictionary = st.get("daemon", {}) if st.get("daemon") is Dictionary else {}
	var unit := str(d.get("unit", "")) if d.get("unit") != null else ""
	var url := auth_url(st)
	return [
		["Tailnet IPv4", _or(st.get("ipv4"), "—")],
		["Machine", _or(st.get("dnsName"), _or(st.get("hostname"), "—"))],
		["Daemon", _or(d.get("state"), "unknown") + (" (%s)" % unit if unit != "" else "")],
		["Login URL", url if url != "" else ("— (already connected)" if st.get("connected") == true else "—")],
	]


static func _or(v: Variant, fallback: String) -> String:
	return fallback if v == null or str(v) == "" else str(v)
