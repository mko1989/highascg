extends RefCounted
## WO-1039 — Programming presets, groups and gallery, pure (no autoloads): request bodies and labels of Studio's
## public/presets-ui.js (device presets), layer-presets-ui.js, source-tabs.js (group sources, backgrounds / logos)
## matching lib/studio-presets.js, preset-autotake.js, layer-presets.js, group-sources.js and gallery-manage.js.

const M := preload("res://features/pixelhue/programming_model.gd")

const SLOTS := 128
const AUTO := 0  # "Load to" Auto-take (PVW = 4, PGM = 2)
## preset_param.xml layer groups a relative preset stores, and the ones ticked by default.
const PARAMS := [["3-2", "Source"], ["3-3", "Position"], ["3-4", "Size"], ["3-5", "Flip"], ["3-6", "Border"], ["3-7", "Shadow"],
	["3-8", "Mask"], ["3-9", "Crop"], ["3-10", "Effects"], ["3-11", "Cut-Fill"], ["3-12", "KeyFrame"], ["3-13", "Cutout"]]
const PARAMS_DEFAULT := ["3-2", "3-3", "3-4", "3-12"]
## Layer presets store a look, not a route: the source is off by default.
const LAYER_PARTS_DEFAULT := ["pos", "size", "border", "effect", "shadow", "flip", "mask", "crop"]


# ---- device presets ----

static func first_free(presets: Array) -> int:
	var used: Array = presets.map(func(p: Dictionary) -> int: return int(p.get("serial", 0)))
	for n in range(1, SLOTS + 1):
		if not (n in used):
			return n
	return 1


static func preset_at(presets: Array, serial: int) -> Dictionary:
	for p in presets:
		if int(p.get("serial", 0)) == serial:
			return p
	return {}


## Slot menu: every used slot (overwrite) and empty slots up to 8 past the highest used / first free one.
static func slot_options(presets: Array) -> Array:
	var top := first_free(presets)
	for p in presets:
		top = maxi(top, int(p.get("serial", 0)))
	var out: Array = []
	for n in range(1, SLOTS + 1):
		var p := preset_at(presets, n)
		if not p.is_empty():
			out.append([n, "%d · %s (overwrite)" % [n, str(p.get("name", ""))]])
		elif n <= top + 8:
			out.append([n, "%d · empty" % n])
	return out


static func default_name(presets: Array, serial: int) -> String:
	var p := preset_at(presets, serial)
	return str(p.name) if not p.is_empty() else "Preset %d" % serial


## Save from PVW / PGM of the shown screens. {body, message, overwrite} — overwrite = the occupant's name ("" = free).
static func save_request(presets: Array, scene: int, serial: int, name: String, screen_ids: Array, relative := false, params: Array = [], layer_ids: Array = []) -> Dictionary:
	var n := name.strip_edges()
	if n == "":
		return {"error": "Give the preset a name."}
	if n.to_utf8_buffer().size() > 64:
		return {"error": "Preset name must contain 1–64 UTF-8 bytes."}
	if serial < 1 or serial > SLOTS:
		return {"error": "Preset slot must be 1–128."}
	if relative and params.is_empty():
		return {"error": "Choose the layer settings a relative preset stores."}
	if relative and layer_ids.is_empty():
		return {"error": "Choose the layers a relative preset stores."}
	var occupant := preset_at(presets, serial)
	var body := {"action": "preset-save", "name": n, "scene": scene, "serial": serial, "overwrite": not occupant.is_empty(), "screenIds": screen_ids.duplicate()}
	if relative:
		body.relative = true
		body.params = params.duplicate()
		body.layerIds = layer_ids.duplicate()
	var msg := "%s from %s%s." % ["Preset %d overwritten" % serial if not occupant.is_empty() else "Preset %d saved" % serial, M.scene_name(scene), " (relative)" if relative else ""]
	return {"body": body, "message": msg, "overwrite": str(occupant.get("name", "")) if not occupant.is_empty() else ""}


## Load a preset: to PVW (4) / PGM (2) with the load options, or Auto-take (load to PVW, confirm, Take).
static func load_request(preset: Dictionary, target: int, effect: bool, keyframes: bool, time_ms: int, swap: bool) -> Dictionary:
	var name := str(preset.get("name", ""))
	if target == AUTO:
		return {"body": {"action": "preset-autotake", "guid": str(preset.guid), "time": time_ms, "swap": swap}, "message": "%s: loaded to PVW, confirmed, taken." % name}
	var fx := target == M.PGM and effect
	return {"body": {"action": "preset-load", "guid": str(preset.guid), "target": target, "effect": fx, "keyframes": keyframes and fx, "time": time_ms if fx else 0, "swap": swap},
		"message": "%s loaded to %s." % [name, M.scene_name(target)]}


static func target_name(target: int) -> String:
	return "Auto-take" if target == AUTO else M.scene_name(target)


static func preset_title(p: Dictionary) -> String:
	return "%d. %s%s" % [int(p.get("serial", 0)), str(p.get("name", "")), " ·rel" if int(p.get("loadType", 1)) == 2 else ""]


static func preset_tooltip(p: Dictionary, target: int) -> String:
	var screens: Array = M.arr(p, "screens")
	return "%s · %s · saved from %s%s" % ["Auto-take" if target == AUTO else "Load to %s" % M.scene_name(target),
		"relative" if int(p.get("loadType", 1)) == 2 else "absolute", M.scene_name(p.get("sourceRegion", 4)),
		" · " + ", ".join(PackedStringArray(screens.map(func(s: Variant) -> String: return str(s)))) if not screens.is_empty() else ""]


static func rename_request(p: Dictionary, name: String) -> Dictionary:
	var n := name.strip_edges()
	if n == "" or n == str(p.get("name", "")):
		return {}
	return {"body": {"action": "preset-rename", "guid": str(p.guid), "name": n}, "message": "Preset renamed."}


static func delete_body(p: Dictionary) -> Dictionary:
	return {"action": "preset-delete", "guid": str(p.guid)}


## Relative save: the layers of `scene` on the shown screens, [id, label].
static func scene_layers(state: Dictionary, shown: Array, scene: int) -> Array:
	var out: Array = []
	for id in shown:
		var s := M.screen_by_id(state, id)
		for l in M.layers_of(state, id, scene):
			var src := str(l.get("sourceName", ""))
			out.append([l.id, "%s · %s · %s" % [str(s.get("name", "")), str(l.get("name", "")), src if src != "" else "Source %s" % str(l.get("sourceId", ""))]])
	return out


# ---- layer presets ----

static func part_label(info: Dictionary, key: String) -> String:
	for p in M.arr(info, "parts"):
		if p[0] == key:
			return str(p[1])
	return key


## Parts the save form offers (Cut & Fill only for a Cut & Fill layer), each with its ticked state.
static func part_choices(info: Dictionary, layer: Dictionary, chosen: Array) -> Array:
	var cf: bool = layer.get("fx") is Dictionary and layer.fx.get("cutFill") is Dictionary and layer.fx.cutFill.get("enable") == true
	var picked: Array = chosen if not chosen.is_empty() else LAYER_PARTS_DEFAULT
	var out: Array = []
	for p in M.arr(info, "parts"):
		if p[0] == "cutFill" and not cf:
			continue
		out.append([p[0], str(p[1]), p[0] in picked])
	return out


static func layer_preset_apply(layer: Dictionary, preset: Dictionary) -> Dictionary:
	return {"body": {"action": "layerpreset-apply", "screenId": int(layer.screenId), "id": int(layer.id), "presetId": int(preset.id)}, "message": "%s applied." % str(preset.get("name", ""))}


static func layer_preset_save(info: Dictionary, layer: Dictionary, name: String, color: String, parts: Array) -> Dictionary:
	var n := name.strip_edges()
	if n == "":
		n = "Layer preset %d" % (M.arr(info, "list").size() + 1)
	var cf: bool = layer.get("fx") is Dictionary and layer.fx.get("cutFill") is Dictionary and layer.fx.cutFill.get("enable") == true
	var keep: Array = parts.filter(func(k: Variant) -> bool: return str(k) != "cutFill" or cf)
	if keep.is_empty():
		return {"error": "Choose what the layer preset stores."}
	return {"body": {"action": "layerpreset-save", "screenId": int(layer.screenId), "id": int(layer.id), "name": n, "color": color, "parts": keep}, "message": "Layer preset saved."}


static func layer_preset_rename(preset: Dictionary, name: String) -> Dictionary:
	var n := name.strip_edges()
	if n == "" or n == str(preset.get("name", "")):
		return {}
	return {"body": {"action": "layerpreset-update", "presetId": int(preset.id), "name": n}, "message": "Layer preset renamed."}


static func layer_preset_delete(preset: Dictionary) -> Dictionary:
	return {"action": "layerpreset-delete", "presetId": int(preset.id)}


# ---- group sources ----

static func group_line(state: Dictionary, g: Dictionary) -> String:
	var h := str(g.get("orient", "H")) == "H"
	return "%s · %s %s %s%s" % ["Side by side" if h else "Top / bottom", _src_name(state, g.get("a")), "|" if h else "/", _src_name(state, g.get("b")), " · on screen" if g.get("onDevice") == true else ""]


static func _src_name(state: Dictionary, s: Variant) -> String:
	if not (s is Dictionary):
		return "missing source"
	var src := M.source_for(state, M.source_key(s.get("type", 0), s.get("id", 0)))
	return str(src.name) if not src.is_empty() else "missing source"


## Group menu entries: every source "<mapping> · <name>".
static func group_options(state: Dictionary) -> Array:
	var out: Array = []
	for s in M.arr(state, "sources"):
		var mapping := str(s.get("mapping", "")) if s.get("mapping") != null else ""
		out.append([M.source_key(s.type, s.id), "%s · %s" % [mapping, str(s.get("name", ""))] if mapping != "" else str(s.get("name", ""))])
	return out


static func group_save(screen_id: Variant, orient: String, name: String, a_key: String, b_key: String) -> Dictionary:
	if a_key == b_key:
		return {"error": "Choose two different sources."}
	var a := M.parse_key(a_key)
	var b := M.parse_key(b_key)
	return {"body": {"action": "groupsource-save", "screenId": int(screen_id) if screen_id != null else 0, "orientation": orient, "name": name.strip_edges(),
		"sources": [{"type": a.type, "id": a.id}, {"type": b.type, "id": b.id}]}, "message": "Group saved as a source. Drag it onto PGM or PVW."}


static func group_delete(screen_id: Variant, g: Dictionary) -> Dictionary:
	return {"action": "groupsource-delete", "screenId": int(screen_id) if screen_id != null else 0, "id": str(g.get("id", ""))}


# ---- gallery (backgrounds = 1, logos = 2) ----

static func pictures(gallery: Dictionary, type: int) -> Array:
	return M.arr(gallery, "pictures").filter(func(p: Dictionary) -> bool: return int(p.get("type", 0)) == type)


static func supports(gallery: Dictionary, kind: String) -> bool:
	return gallery.get("support") is Dictionary and gallery.support.get(kind) is Dictionary


static func picture_line(p: Dictionary) -> String:
	return "%s × %s%s" % [str(p.get("width", "?")), str(p.get("height", "?")), " · in use" if p.get("used") == true else ""]


static func gallery_help(gallery: Dictionary, type: int) -> String:
	var cap := ""
	if gallery.get("capacity") is Dictionary:
		cap = " · %s/%s MB used" % [str(gallery.capacity.get("usedCapacity", "?")), str(gallery.capacity.get("totalCapacity", "?"))]
	if type == 1:
		return "Drag onto PGM or PVW to set that screen's background" + cap
	var lim: Dictionary = gallery.support.logo if supports(gallery, "logo") else {}
	return "Drag onto PGM or PVW to place the logo (max %s × %s)%s" % [str(lim.get("maxWidth", 512)), str(lim.get("maxHeight", 512)), cap]


static func capture_name(gallery: Dictionary) -> String:
	var names: Array = pictures(gallery, 1).map(func(p: Dictionary) -> String: return str(p.get("name", "")))
	var n := 1
	while ("PGM %d" % n) in names:
		n += 1
	return "PGM %d" % n


static func gallery_rename(p: Dictionary, name: String) -> Dictionary:
	var n := name.strip_edges()
	if n == "" or n == str(p.get("name", "")):
		return {}
	return {"action": "rename", "id": int(p.id), "name": n}


static func gallery_delete(p: Dictionary) -> Dictionary:
	return {"action": "delete", "ids": [int(p.id)]}


static func gallery_capture(screen: Dictionary, name: String) -> Dictionary:
	if name.strip_edges() == "":
		return {}
	return {"action": "capture", "source": "pgm", "id": int(screen.id), "name": name.strip_edges()}


## Gallery thumbnail bytes (JPEG / PNG / BMP from the device web root) → Image, or null.
static func decode_picture(b: PackedByteArray) -> Image:
	var img := Image.new()
	var err := ERR_FILE_UNRECOGNIZED
	if b.size() > 3 and b[0] == 0xFF and b[1] == 0xD8:
		err = img.load_jpg_from_buffer(b)
	elif b.size() > 8 and b[0] == 0x89 and b[1] == 0x50:
		err = img.load_png_from_buffer(b)
	elif b.size() > 2 and b[0] == 0x42 and b[1] == 0x4D:
		err = img.load_bmp_from_buffer(b)
	return img if err == OK and not img.is_empty() else null
