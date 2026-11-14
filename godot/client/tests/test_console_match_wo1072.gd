extends RefCounted
## WO-1072 — "Match console positions" (console_match_model.gd): the text the operator reads for a preview, a mirrored
## plan, an applied move and an error, and when the two buttons may be pressed.

const Fold := preload("res://features/previs/fixtures/console_match_model.gd")
var t

const PREVIEW := {"ok": true, "rows": 92, "matched": 90, "by": "DMX address", "unmatched": [{"head": 7}, {"head": 8}], "applied": null,
	"fit": {"shift": {"x": -5.05, "y": -0.1, "z": -0.23}, "rms": 0.04, "max": 0.31, "yaw_deg": 0.1, "mirrored": false,
		"worst": [{"id": "a", "name": "Wash 409", "err": 0.31}, {"id": "b", "name": "Spot 1", "err": 0.02}]}}


func test_preview_text_and_apply_gate() -> void:
	var s: String = Fold.summary(PREVIEW)
	t.ok(s.contains("90 of 92 heads matched by DMX address."), s)
	t.ok(s.contains("Offset: X -5.05 m, upstage -0.10 m, height -0.23 m."), s)
	t.ok(s.contains("off by 0.04 m on average, 0.31 m at worst"), s)
	t.ok(s.contains("Furthest off: Wash 409 (0.31 m)."), s)
	t.ok(not s.contains("Spot 1"), "heads within 25 cm are not listed")
	t.ok(not s.contains("turned"), "a tenth of a degree is not reported")
	t.ok(s.contains("2 rows of the file match no patched fixture."), s)
	t.ok(Fold.can_apply(PREVIEW))


func test_mirrored_turned_applied_and_error() -> void:
	var mir := PREVIEW.duplicate(true)
	mir.fit.mirrored = true
	t.ok(Fold.summary(mir).contains("mirrored"))
	t.ok(not Fold.summary(mir).contains("Offset"))
	t.ok(not Fold.can_apply(mir))
	var turned := PREVIEW.duplicate(true)
	turned.fit.yaw_deg = -2.0
	t.ok(Fold.summary(turned).contains("turned by -2.0°"))
	var done := PREVIEW.duplicate(true)
	done.applied = {"mode": "heads", "shift": done.fit.shift, "heads": 90}
	t.ok(Fold.summary(done).contains("Moved: X -5.05 m"))
	t.ok(Fold.summary(done).contains("90 heads took the console's own positions."))
	t.ok(not Fold.can_apply(done), "an applied answer is not applied again")
	t.eq(Fold.summary({"ok": false, "error": "No heading row."}), "No heading row.")
	t.ok(not Fold.can_apply({"ok": false, "error": "x"}))
	t.eq(Fold.summary({}), "The server did not answer.")


func test_fold_is_wired() -> void:
	var fold := FileAccess.get_file_as_string("res://features/previs/fixtures/console_match_fold.gd")
	t.ok(fold.contains("\"/api/fixtures/console-match\""), "the fold posts to the route")
	t.ok(fold.contains("_enable(false)"), "nothing to apply before a file is chosen")
	var sec := FileAccess.get_file_as_string("res://features/previs/fixtures/fixtures_section.gd")
	t.ok(sec.contains("console_match_fold.gd\").new()"), "the Fixtures section shows the fold")
