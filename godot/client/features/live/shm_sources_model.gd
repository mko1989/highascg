extends RefCounted
## WO-744 (WO-738 step 3): Live-tab rows for the shm rings other processes write on the server box (GET /api/shm/sources:
## the Godot VJ writer of WO-743, later a window grabber). A row drags {type: "shm", value: "shm://<name>"} onto a look;
## the server plays it as PLAY <ch>-<layer> SHM NAME <name> (needs the WO-742 Caspar shm producer).
## Detachable: this file and its marked lines in live_sources_panel.gd (WO-744 "How to remove").


## The API's sources → Live rows (live_sources_model.gd row shape: value, label, type, resolution, fps).
static func rows(data: Variant) -> Array:
	var out := []
	var list: Variant = (data as Dictionary).get("sources") if data is Dictionary else null
	if not (list is Array):
		return out
	for s in list:
		if not (s is Dictionary) or str(s.get("value", "")) == "":
			continue
		var w := int(s.get("width", 0))
		var h := int(s.get("height", 0))
		out.append({"type": "shm", "value": str(s.value), "label": str(s.get("name", s.value)),
			"resolution": "%d×%d" % [w, h] if w > 0 and h > 0 else "",
			"fps": s.get("fps"), "routeType": "shm",
			"shmSignal": s.get("signal") == true, "shmWriter": str(s.get("writer", ""))})
	return out


## Appended to the row's "resolution · fps" line: the writer process.
static func meta_suffix(s: Dictionary) -> String:
	return " · %s" % s.shmWriter if s.get("type") == "shm" and str(s.get("shmWriter", "")) != "" else ""


## The row's warning line: the writer stopped publishing (a layer playing it holds the last frame).
static func warning(s: Dictionary) -> String:
	return "No frames from the writer" if s.get("type") == "shm" and s.get("shmSignal") != true else ""
