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
