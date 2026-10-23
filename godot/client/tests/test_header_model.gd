extends RefCounted
## WO-608 header — notice lines, project list rows, load replies (server shapes from routes-data-project-*.js).

const H := preload("res://app/header_model.gd")
var t


func test_notices() -> void:
	t.eq(H.notice("autosaved", "", "20:18"), {"text": "Autosaved at 20:18", "tone": "muted", "sticky": false}, "autosave")
	t.eq(H.notice("saved", "", "09:05").text, "Saved at 09:05", "explicit save")
	t.eq(H.notice("failed", "", "").text, "Autosave failed: unknown error", "no reason")
	t.eq(H.notice("failed", "stale_rev", "").tone, "error", "failure is red")
	t.eq(H.notice("gone", "", "").sticky, true, "a deleted project stays up (WO-311)")
	t.eq(H.hhmm({"hour": 7, "minute": 3}), "07:03", "hh:mm")
	t.eq(H.clock_text({"hour": 20, "minute": 18, "second": 9}), "20:18:09", "wall clock")


func test_project_rows() -> void:
	var data := {"activeSlug": "untitled", "projects": [
		{"slug": "untitled", "name": "Untitled", "savedAt": "2026-10-20T20:18:19.789Z", "active": true},
		{"slug": "npcc", "name": "", "savedAt": "2026-10-17T19:06:08.145Z", "active": false},
		{"name": "no slug"}, "junk"]}
	var rows := H.project_rows(data)
	t.eq(rows.map(func(r: Dictionary) -> Array: return [r.slug, r.name, r.active]), [["untitled", "Untitled", true], ["npcc", "npcc", false]], "slug rows only, name falls back to slug")
	t.eq(str(rows[0].saved).length(), 16, "yyyy-mm-dd hh:mm")
	t.eq(H.project_rows({"error": "x"}), [], "no list")
	t.eq(H.saved_label(""), "", "no savedAt")


func test_stick_offer_and_rows() -> void:  # WO-697
	var vols := func(m: Variant, b: Variant) -> Dictionary: return {"volumes": {"usb": {"mounted": m, "bootStick": b}}}
	t.eq(H.offers_stick(vols.call(true, false)), true, "a stick this box did not boot from")
	t.eq(H.offers_stick(vols.call(true, true)), false, "the boot stick syncs on its own")
	t.eq(H.offers_stick(vols.call(false, false)), false, "no stick")
	t.eq(H.offers_stick({"projects": []}), false, "older server without volumes")
	var rows := H.stick_rows({"projects": [{"slug": "gig", "name": "", "savedAt": "2026-10-20T18:00:00Z", "onBox": true},
		{"slug": "a", "name": "A"}, {"name": "no slug"}, "junk"]})
	t.eq(rows.map(func(r: Dictionary) -> Array: return [r.slug, r.name, r.on_box]), [["gig", "gig", true], ["a", "A", false]], "slug rows, name falls back")
	t.eq(H.stick_rows({"mounted": false}), [], "no projects key")


func test_load_reply() -> void:
	var reply := {"version": 3, "name": "npcc", "_activation": {"slug": "npcc", "restartRequired": false}, "_recoveredFromAutosave": true}
	t.eq(H.loaded_project(reply), {"version": 3, "name": "npcc"}, "bookkeeping keys stripped")
	t.eq(reply.has("_activation"), true, "reply untouched")
	t.eq(H.load_notice(reply).text, "Project loaded — recovered newer autosaved work", "recovered")
	t.eq(H.load_notice({"_activation": {"restartRequired": true, "restartReason": "Channel layout differs"}}), {"text": "Channel layout differs", "tone": "error", "sticky": false}, "restart needed wins")
	t.eq(H.load_notice({}).text, "Project loaded", "plain")


func test_project_file() -> void:
	t.eq(H.parse_project_file("[1]").has("error"), true, "not an object")
	t.eq(H.parse_project_file("{oops").has("error"), true, "not JSON")
	t.eq(H.parse_project_file('{"version": 3}').project.name, "Untitled", "nameless file gets the default name")
	t.eq(H.clean_name("  Show A  "), "Show A", "trimmed")
