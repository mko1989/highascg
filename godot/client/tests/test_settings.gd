extends RefCounted
## WO-608 settings — the POST body (only dirty sections, redaction placeholders dropped), form path helpers, the
## Companion status text (web settings-modal-companion.js formatStatusText / buildStatusQuery).

const P := preload("res://core/settings_payload.gd")
const M := preload("res://features/settings/settings_model.gd")
var t


func test_payload_only_dirty_sections() -> void:
	var s := {"editorDefaults": {"scene": {"loop": true}}, "osc": {"listenPort": 6251}, "offline_mode": true,
		"companion": {"host": "x"}}
	t.eq(P.build(s, ["editorDefaults"]), {"editorDefaults": {"scene": {"loop": true}}}, "osc not re-posted")
	t.eq(P.build(s, ["offline_mode", "nope"]), {}, "offline_mode never sent (web deletes it); unknown keys skipped")


func test_payload_strips_redacted() -> void:
	var s := {"ui": {"invertTouchpadScroll": true, "nuclearRequirePassword": "[REDACTED]",
		"nuclearPassword": "[REDACTED]", "nuclearPasswordHash": "[REDACTED]", "x": null},
		"rtmp": {"big": "a…[truncated]", "n": 2}}
	var b := P.build(s, ["ui", "rtmp"])
	t.eq(b.ui, {"invertTouchpadScroll": true, "nuclearPassword": "[REDACTED]", "x": null},
		"the server keeps the stored require flag / hash; nuclearPassword stays the keep-hash signal")
	t.eq(b.rtmp, {"n": 2}, "a truncated string is not written back")
	t.eq(s.ui.nuclearRequirePassword, "[REDACTED]", "the mirror is not changed")


func test_form_helpers() -> void:
	t.eq(M.nest("editorDefaults.scene.loop", true), {"editorDefaults": {"scene": {"loop": true}}})
	t.eq(M.nest("local_media_path", "/m"), {"local_media_path": "/m"})
	t.eq(M.is_on(null, true), true, "unset → fallback (x !== false)")
	t.eq(M.is_on(false, true), false)
	t.eq(M.is_on("true", false), true)
	t.eq(M.is_on(1, false), false, "only true / 'true' count (web === true)")


func test_companion_status() -> void:
	t.eq(M.companion_status_text(null), "Could not check Companion connection.")
	var st := {"connected": true, "http": {"connected": true, "host": "127.0.0.1", "port": 8000.0, "error": null},
		"satellite": {"enabled": true, "connected": true, "subscriptionsSupported": true, "host": "127.0.0.1", "port": 16622.0}}
	t.eq(M.companion_status_text(st),
		"HTTP press API reachable at 127.0.0.1:8000. Satellite preview connected at 127.0.0.1:16622.")
	st.http = {"connected": false, "host": "h", "port": 1, "error": "ECONNREFUSED"}
	st.satellite = {"enabled": true, "connected": true, "subscriptionsSupported": false, "host": "h", "port": 2, "hint": "Enable it"}
	t.eq(M.companion_status_text(st), "HTTP press API unreachable at h:1 (ECONNREFUSED). Satellite TCP connected at "
		+ "h:2, but Button Subscriptions API is not enabled in Companion. Enable it")
	st.satellite = {"enabled": false}
	t.ok(M.companion_status_text(st).ends_with("Satellite preview disabled in these settings."))
	t.eq(M.companion_query({}), "host=127.0.0.1&port=8000&satelliteEnabled=1&satellitePort=16622", "web defaults")
	t.eq(M.companion_query({"host": " a b ", "port": "9000", "satelliteEnabled": false, "satelliteHost": "s"}),
		"host=a%20b&port=9000&satelliteEnabled=0&satellitePort=16622&satelliteHost=s")


func test_attachment_name() -> void:
	var h := PackedStringArray(["Content-Type: application/zip", 'Content-Disposition: attachment; filename="highascg-support_box_2026.zip"'])
	t.eq(M.attachment_name(h, "x.zip"), "highascg-support_box_2026.zip")
	t.eq(M.attachment_name(PackedStringArray(["content-disposition: attachment; filename=a.zip"]), "x.zip"), "a.zip")
	t.eq(M.attachment_name(PackedStringArray(['Content-Disposition: attachment; filename="../../etc/p.zip"']), "x.zip"), "p.zip", "no path parts")
	t.eq(M.attachment_name(PackedStringArray(), "x.zip"), "x.zip")


## WO-737 — after a detached install the pane waits through the restart: the old server (job "detached") and no
## server at all are "wait"; the new server (no job) is "back"; past the limit, "gave_up".
func test_updates_restart_wait() -> void:
	var U := preload("res://features/settings/updates_model.gd")
	var old := {"ok": true, "data": {"active": false, "phase": "detached", "ok": true}}
	var down := {"ok": false, "status": 0, "data": null, "error": "server not reachable (restarting or offline)"}
	var fresh := {"ok": true, "data": {"active": false}}
	t.eq(U.restart_step(old, 3.0, 180), "wait")
	t.eq(U.restart_step(down, 30.0, 180), "wait")
	t.eq(U.restart_step(fresh, 45.0, 180), "back")
	t.eq(U.restart_step(down, 181.5, 180), "gave_up")
	t.eq(U.restart_step({"ok": true, "data": {"active": true, "phase": "extract"}}, 6.0, 180), "running", "WO-748: a dropped poll mid-install")


## WO-748 — before the restart wait: the old server gone before a poll saw "detached" is "restarting", and the new
## server (no job) is "back" at once, not "Phase: ?" + Install enabled again (.4, 25.10).
func test_updates_install_step() -> void:
	var U := preload("res://features/settings/updates_model.gd")
	t.eq(U.install_step({"ok": true, "data": {"active": true, "phase": "download"}}), "running")
	t.eq(U.install_step({"ok": true, "data": {"active": false, "phase": "detached", "done": true, "ok": true}}), "restarting")
	t.eq(U.install_step({"ok": false, "status": 0, "data": null, "error": "server not reachable"}), "restarting", "old server already gone")
	t.eq(U.install_step({"ok": true, "data": {"active": false}}), "back", "the new server answered first")
	t.eq(U.install_step({"ok": true, "data": {"active": false, "phase": "done", "ok": true}}), "done")
	t.eq(U.install_step({"ok": true, "data": {"active": false, "phase": "error", "ok": false, "error": "x"}}), "failed")


func test_updates_texts() -> void:
	var U := preload("res://features/settings/updates_model.gd")
	var ver := {"buildStamp": "2026.05.20", "retainDrop": true, "volumes": {"usb": {"mounted": false},
		"bridge": {"mounted": true, "dropStamp": null}}}
	t.eq(U.stamp(ver), "2026.05.20")
	t.eq(U.stamp({"packageVersion": "1.2"}), "1.2")
	t.eq(U.stamp({}), "(unknown)")
	t.eq(U.volumes(ver), "USB exFAT: not mounted · Bridge drop: — · retain mode")
	t.eq(U.volumes({"volumes": {"usb": {"mounted": true, "dropStamp": "a", "appliedStamp": "b"}}}), "USB drop: a (applied b) · Bridge: not mounted")
	t.eq(U.check_line({"latest": "2026-10-04T033256Z", "updateAvailable": true, "error": null}), "Latest: 2026-10-04T033256Z — update available")
	t.eq(U.check_line({"latest": "x", "updateAvailable": false, "cached": true}), "Latest: x — up to date (cached)")
	t.eq(U.check_line({"error": "rate limited"}), "GitHub check failed: rate limited")
	t.eq(U.check_line({}), "No highascg-server_*.tar.gz asset on the latest release.")
	t.eq(U.can_apply({"updateAvailable": true, "error": null}), true)
	t.eq(U.can_apply({"updateAvailable": true, "error": "x"}), false)
	t.eq(U.status_log({"phase": "download", "log": ["a", "b"], "error": "boom"}), "Phase: download\na\nb\nERROR: boom")
