extends RefCounted
## WO-608 — Settings → Tailscale text, same answers as client/components/settings-modal-tailscale.js renderStatus.

const M := preload("res://features/settings/tailscale_model.gd")
var t


func test_summary() -> void:
	t.eq(M.summary({"connected": true, "backendState": "Running"}), "Connected (Running)")
	t.eq(M.summary({"connected": true}), "Connected (Running)")
	t.eq(M.summary({"needsLogin": true}), "Login required (NeedsLogin)")
	t.eq(M.summary({"installed": true, "backendState": "Stopped"}), "Not connected (Stopped)")
	t.eq(M.summary({}), "Tailscale CLI not installed")


func test_rows_and_url() -> void:
	var st := {"ipv4": "100.1.2.3", "hostname": "box", "dnsName": "box.ts.net", "connected": true, "authUrl": null,
		"daemon": {"unit": "tailscaled.service", "state": "active"}}
	t.eq(M.rows(st), [["Tailnet IPv4", "100.1.2.3"], ["Machine", "box.ts.net"],
		["Daemon", "active (tailscaled.service)"], ["Login URL", "— (already connected)"]])
	t.eq(M.auth_url(st), "")
	var login := {"hostname": "box", "authUrl": " https://login.tailscale.com/a/x ", "daemon": null}
	t.eq(M.auth_url(login), "https://login.tailscale.com/a/x")
	t.eq(M.rows(login), [["Tailnet IPv4", "—"], ["Machine", "box"], ["Daemon", "unknown"],
		["Login URL", "https://login.tailscale.com/a/x"]])
