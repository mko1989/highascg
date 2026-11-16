extends RefCounted
## WO-1094 — the person-detection runtime block (runtime_model.gd), the Model list without face / pose files
## (detect_model.is_aux_model) and the About line (about_model.gd). The block (runtime_section.gd) uses the Api autoload,
## which `-s` test scripts lack — it is checked on glass (WO-1094 doc).

const R := preload("res://features/previs/tracking/runtime_model.gd")
const D := preload("res://features/previs/tracking/detect_model.gd")
const About := preload("res://features/settings/about_model.gd")
var t


func _st(verdict: String, extra := {}) -> Dictionary:
	var s := {"verdict": verdict, "reason": "", "core": {"python": "3.14.4", "system_python": "3.14.4", "gpu": false},
		"bytes": 530000000, "features": [
			{"id": "person", "label": "Person boxes", "uses": "pins", "state": "ready"},
			{"id": "pose", "label": "Body pose", "uses": "dummies", "state": "ready"},
			{"id": "seg", "label": "Cut-outs", "uses": "cards", "state": "missing"},
			{"id": "face", "label": "Faces", "uses": "presenters", "state": "missing"},
			{"id": "traits", "label": "Looks", "uses": "avatars", "state": "ready"}]}
	s.merge(extra, true)
	return s


func test_missing_says_not_installed_and_offers_install() -> void:
	var s := _st("missing", {"internet": {"ok": true, "error": ""}})
	t.eq(R.headline(s), "Person detection is not installed on this machine.", "first-run headline")
	t.eq(R.actions(s), ["install", "import"], "install online or from a folder")
	t.ok(R.detail(s).contains("needs internet"), "says install needs internet")
	t.eq(R.usable(s), false, "detection cannot start")


func test_offline_points_at_folder() -> void:
	var s := _st("missing", {"internet": {"ok": false, "error": "cannot reach pypi.org (ENOTFOUND)"}})
	t.ok(R.detail(s).contains("No internet (cannot reach pypi.org (ENOTFOUND))"), "names the reason")
	t.ok(R.detail(s).contains("install from a folder"), "points at the folder install")


func test_broken_shows_reason_and_repair_first() -> void:
	var s := _st("broken", {"reason": "venv built for Python 3.12, the system has 3.14 — Repair rebuilds it"})
	t.eq(R.headline(s), "Person detection needs repair.", "headline")
	t.ok(R.detail(s).begins_with("venv built for Python 3.12"), "reason shown")
	t.eq(R.actions(s)[0], "repair", "Repair is the first button")


func test_apt_command_shown() -> void:
	var s := _st("missing", {"apt": "sudo apt install python3"})
	t.ok(R.detail(s).contains("sudo apt install python3"), "the exact apt command")


func test_ready_headline_and_features() -> void:
	var s := _st("ready")
	t.eq(R.headline(s), "Person detection installed · CPU · Python 3.14.4 · 530 MB", "ready headline")
	t.eq(R.features_line(s), "Person boxes ✓ · Body pose ✓ · Cut-outs — · Faces —", "per feature, no traits")
	t.eq(R.usable(s), true, "usable")
	t.eq(R.usable(_st("partial")), true, "a partial install still detects people")
	t.eq(R.actions(s), ["install", "repair", "export", "remove"], "manage")


func test_job_lines() -> void:
	var run := {"kind": "install", "state": "running", "label": "Model yolo26n-pose (download + export to ONNX)", "percent": 47, "log": ["a", "b"]}
	var s := _st("missing", {"job": run})
	t.eq(R.running(s), true, "running")
	t.eq(R.actions(s), ["cancel"], "only Cancel while running")
	t.eq(R.headline(_st("broken", {"job": run})), "Installing person detection on this machine…", "no verdict on a half-built venv")
	t.eq(R.detail(_st("broken", {"reason": "numpy will not import", "job": run})), "", "no repair advice while installing")
	t.eq(R.job_line(run), "Installing — Model yolo26n-pose (download + export to ONNX) · 47 %", "progress line")
	t.eq(R.last_log(run), "b", "log tail")
	t.eq(R.job_line({"kind": "install", "state": "running", "label": "x", "percent": null}), "Installing — x", "no percent before the plan")
	var err := {"kind": "install", "state": "error", "error": "no internet: cannot reach pypi.org", "apt": "", "resumable": true}
	t.eq(R.job_line(err), "Installing failed: no internet: cannot reach pypi.org", "error line")
	t.eq(R.actions(_st("missing", {"job": err}))[0], "resume", "a failed job can be resumed")
	t.ok(R.job_line({"kind": "repair", "state": "interrupted"}).contains("server restarted"), "interrupted")
	t.ok(R.job_line({"kind": "install", "state": "error", "error": "x", "apt": "sudo apt install curl"}).contains("sudo apt install curl"), "apt on failure")


func test_choices_default_person_pose_seg_face_off() -> void:
	var c := R.choices(_st("missing"))
	t.eq(c.size(), 4, "traits is not a choice")
	t.eq([c[0][0], c[0][2], c[0][3]], ["person", true, true], "person on and locked")
	t.eq([c[2][0], c[2][2]], ["seg", true], "cut-outs on by default")
	t.eq([c[3][0], c[3][2]], ["face", false], "faces off by default (own models + licence)")
	t.eq(R.choices({}).size(), 4, "defaults before the status arrives")


func test_licence_text_two_sentences_with_links() -> void:
	t.eq(R.LICENSE_TEXT.count(". "), 1, "two sentences")
	t.ok(R.LICENSE_TEXT.contains("AGPL-3.0"), "names the licence")
	t.ok(R.LICENSE_LINKS.contains("https://github.com/ultralytics/ultralytics") and R.LICENSE_LINKS.contains("agpl-3.0.html"), "links")
	t.ok(R.BUNDLE_NOTE.contains("your own machines"), "bundle note")


func test_aux_models_out_of_model_list() -> void:
	t.eq(D.is_aux_model("face_recognition_sface_2021dec.onnx"), true, "face")
	t.eq(D.is_aux_model("person_reid_youtu_2021nov.onnx"), true, "re-id")
	t.eq(D.is_aux_model("yolo26n-pose.onnx"), true, "pose has its own list")
	t.eq(D.is_aux_model("yolo26n-seg.onnx"), false, "seg is a detector")
	t.eq(D.is_aux_model("yolo26s.onnx"), false, "detector")


func test_about_line_next_to_notices() -> void:
	var rows := About.rows({"name": "HighAsCG", "detection": "Person detection on this machine: not installed.", "credits": []})
	var i := rows.find(["note", "Person detection on this machine: not installed."])
	t.ok(i > 0, "the line is there")
	t.eq(rows[i + 1], ["heading", "Credits"], "right before Credits, after the notices")
	t.eq(About.rows({"name": "x", "credits": []}).size(), 6, "no line without the field")

