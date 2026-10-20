extends RefCounted
## WO-608 — Settings → Variables, same answers as client/components/variables-panel.js.

const M := preload("res://features/settings/variables_model.gd")
var t


func test_filter_and_clip() -> void:
	var v := {"osc_b": "1", "caspar_connected": "true", "osc_a": "2", "app_x": "3", "media_count": "346"}
	t.eq(M.filtered(v, "", ""), ["app_x", "caspar_connected", "media_count", "osc_a", "osc_b"])
	t.eq(M.filtered(v, "", "osc_"), ["osc_a", "osc_b"])
	t.eq(M.filtered(v, "CONN", ""), ["caspar_connected"])
	t.eq(M.filtered(v, "a", "caspar_"), ["caspar_connected"])
	t.eq(M.filtered(v, " $(highascg:osc_a) ", ""), ["osc_a"])
	t.eq(M.clip("media_count"), "$(highascg:media_count)")


func test_display() -> void:
	t.eq(M.display(null), {"text": "", "tip": ""})
	t.eq(M.display("short"), {"text": "short", "tip": ""})
	t.eq(M.display(5), {"text": "5", "tip": ""})
	var long := "x".repeat(100)
	t.eq(M.display(long), {"text": "x".repeat(55) + "…", "tip": "100 characters"})
