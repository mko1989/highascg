extends RefCounted
## WO-607 T1 — which meshes of a server GLB model are LED screens. The web kept these tags in browser localStorage
## (previs-state.js `tags`); the Godot client keeps them in the project's client-owned `previs` slice
## (`previs.modelScreens[<model id>] = [mesh names]`), which the server preserves across web autosaves
## (src/engine/project-client-slices.js). No entry → the name rule (`screen` / `led`) decides, as before.


## Saved names for `model_id`, or null when this model was never tagged in the project.
static func saved(project: Dictionary, model_id: String) -> Variant:
	var pv: Variant = project.get("previs")
	var ms: Variant = (pv as Dictionary).get("modelScreens") if pv is Dictionary else null
	var v: Variant = (ms as Dictionary).get(model_id) if ms is Dictionary else null
	return (v as Array).map(func(x: Variant) -> String: return str(x)) if v is Array else null


static func is_screen(mesh_name: String, saved_names: Variant) -> bool:
	if saved_names is Array:
		return (saved_names as Array).has(mesh_name)
	var n := mesh_name.to_lower()
	return n.contains("screen") or n.contains("led")


## Writes the sorted names into project.previs.modelScreens (mutates `project`).
static func store(project: Dictionary, model_id: String, names: Array) -> void:
	var pv: Dictionary = project.get("previs") if project.get("previs") is Dictionary else {}
	var ms: Dictionary = pv.get("modelScreens") if pv.get("modelScreens") is Dictionary else {}
	var sorted := names.map(func(x: Variant) -> String: return str(x))
	sorted.sort()
	ms[model_id] = sorted
	pv["modelScreens"] = ms
	project["previs"] = pv
