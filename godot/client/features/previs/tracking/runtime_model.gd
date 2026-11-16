extends RefCounted
## WO-1094 — the person-detection runtime on the client, pure (tests preload it): GET /api/tracking/runtime → the
## Detect page's status block (headline, detail, which buttons), the install job's progress line, and the install
## dialog's texts. The server (src/tracking/runtime-status.js) decides ready / partial / missing / broken; this only
## words it. Features: tools/tracking-detect/features.json (person, pose, seg, face, traits).

const LICENSE_TEXT := "The YOLO26 detection, pose and cut-out models are made by Ultralytics under the AGPL-3.0 licence, so HighAsCG does not ship them on its install image. Clicking Install downloads them to this machine and converts them here; they stay on this machine."
const LICENSE_LINKS := "https://github.com/ultralytics/ultralytics · https://www.gnu.org/licenses/agpl-3.0.html"
const FACE_NOTE := "Faces (presenter recognition): OpenCV Zoo models — YuNet (MIT), SFace and youtureid (Apache-2.0, trained on research-only datasets)."
const BUNDLE_NOTE := "The folder will hold the AGPL-3.0 YOLO26 model files: it is for your own machines. Install it on an offline box with Install from folder."
const DEFAULT_FEATURES := ["person", "pose", "seg"]
const KIND_VERB := {"install": "Installing", "repair": "Repairing", "remove": "Removing", "export": "Writing the bundle", "import": "Installing from the folder"}


static func running(st: Dictionary) -> bool:
	var j: Variant = st.get("job")
	return j is Dictionary and str(j.get("state", "")) == "running"


## "ready" | "partial" | "missing" | "broken" | "" (not loaded)
static func verdict(st: Dictionary) -> String:
	return str(st.get("verdict", ""))


## Detection can start: the core and person boxes work (a partial install still detects people).
static func usable(st: Dictionary) -> bool:
	return verdict(st) == "ready" or verdict(st) == "partial"


static func headline(st: Dictionary) -> String:
	if st.is_empty():
		return "Checking person detection on this machine…"
	if running(st):  # the venv is half-built while a job runs: no verdict until it ends
		return "%s person detection on this machine…" % KIND_VERB.get(str(st.job.get("kind", "")), "Working on")
	match verdict(st):
		"ready":
			var c: Dictionary = st.get("core", {})
			return "Person detection installed · %s · Python %s · %s" % ["GPU" if c.get("gpu", false) else "CPU", str(c.get("python", "?")), mb(st.get("bytes", 0))]
		"partial":
			return "Person detection installed, partly"
		"missing":
			return "Person detection is not installed on this machine."
		"broken":
			return "Person detection needs repair."
	return "Person detection: %s" % verdict(st)


## The line under the headline: why (partial / broken), the apt command, internet when an install is what is needed.
static func detail(st: Dictionary) -> String:
	if running(st):
		return ""
	var out: Array[String] = []
	var v := verdict(st)
	if (v == "partial" or v == "broken") and str(st.get("reason", "")) != "":
		out.append(str(st.reason))
	if str(st.get("apt", "")) != "":
		out.append("Needs a system package first — ask the owner to run: %s" % st.apt)
	var net: Variant = st.get("internet")
	if v != "ready" and net is Dictionary:
		if net.get("ok", false):
			out.append("Install downloads about 600 MB (needs internet).")
		else:
			out.append("No internet (%s): install from a folder made on another machine." % str(net.get("error", "")))
	return "\n".join(out)


## Per feature: "Person boxes ✓ · Body pose ✓ · Cut-outs — · Faces —"
static func features_line(st: Dictionary) -> String:
	var parts: Array[String] = []
	for f in st.get("features", []):
		if f is Dictionary and str(f.get("id", "")) != "traits":
			parts.append("%s %s" % [f.get("label", f.get("id", "")), "✓" if f.get("state", "") == "ready" else "—"])
	return " · ".join(parts)


## Which buttons the block shows (Install is also "add features" on a partial / ready install).
static func actions(st: Dictionary) -> Array:
	if running(st):
		return ["cancel"]
	var out := []
	match verdict(st):
		"missing":
			out = ["install", "import"]
		"broken":
			out = ["repair", "install", "remove"]
		"partial":
			out = ["install", "import", "repair", "export", "remove"]
		"ready":
			out = ["install", "repair", "export", "remove"]
	var j: Variant = st.get("job")
	if j is Dictionary and j.get("resumable", false):
		out.push_front("resume")
	return out


## The job's line: "Installing — Model yolo26n-pose (download + export to ONNX) · 47 %", or how it ended.
static func job_line(j: Variant) -> String:
	if not (j is Dictionary) or j.is_empty():
		return ""
	var verb: String = KIND_VERB.get(str(j.get("kind", "")), str(j.get("kind", "")))
	match str(j.get("state", "")):
		"running":
			var pc: Variant = j.get("percent")
			return "%s — %s%s" % [verb, str(j.get("label", "starting…")), " · %d %%" % int(pc) if pc != null else ""]
		"done":
			return "%s: done." % verb
		"cancelled":
			return "%s: cancelled — Resume continues where it stopped." % verb
		"interrupted":
			return "%s: interrupted (the server restarted) — Resume continues where it stopped." % verb
		"error":
			var apt := str(j.get("apt", ""))
			return "%s failed: %s%s" % [verb, str(j.get("error", "")), ("\nAsk the owner to run: " + apt) if apt != "" else ""]
	return ""


static func last_log(j: Variant) -> String:
	if not (j is Dictionary):
		return ""
	var lines: Array = j.get("log", [])
	return str(lines[lines.size() - 1]) if not lines.is_empty() else ""


## Features the install dialog offers: [id, label, default on, locked on]
static func choices(st: Dictionary) -> Array:
	var out := []
	for f in st.get("features", []):
		if f is Dictionary and str(f.get("id", "")) != "traits":
			var id := str(f.id)
			var on: bool = DEFAULT_FEATURES.has(id) or f.get("state", "") == "ready"
			out.append([id, "%s — %s" % [f.get("label", id), f.get("uses", "")], on, id == "person"])
	if out.is_empty():
		for id in ["person", "pose", "seg", "face"]:
			out.append([id, id, DEFAULT_FEATURES.has(id), id == "person"])
	return out


static func mb(bytes: Variant) -> String:
	var b := float(bytes)
	return "%.1f GB" % (b / 1e9) if b >= 1e9 else "%d MB" % roundi(b / 1e6)
