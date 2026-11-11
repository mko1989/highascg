extends RefCounted
## WO-816 (owner 29.10: "in godot client i can't exchange media on a layer by drag and dropping it on the layer in the
## viewer or in the list"): Sources drops on the look editor, kept out of look_editor.gd (500-line cap).
## A drop ON a layer (its box in the compose frame, its row in the layer list) exchanges that layer's media, like the
## web layer row / compose box (scene-layer-row.js, scenes-compose.js); every other source of the drag (or a drop on
## blank frame / below the rows) adds a layer (WO-600 K / WO-766). The server builds each source with the web rules
## (POST /api/scene/new-layer; `layerNumber` = the exchanged layer, so the WO-156 self-route check is for that layer).
##   ed = the look editor (tests: a fake): scene_id, main, pusher.schedule(), look(), _layers(), _select(i),
##        _apply_layer(patch) (the write every inspector field makes), _refresh_list(), show_status(text)
##   api = Api (tests: a fake) — post_json(path, body) → {ok, data, error}

const Ops := preload("res://features/live/look_layer_ops.gd")
const LP := preload("res://features/live/layer_preset_model.gd")
const S := preload("res://features/live/layer_style_model.gd")
const InspectorPanel := preload("res://app/inspector_panel.gd")
const Pixelhue := preload("res://features/live/pixelhue_match_model.gd")  # WO-1035: a dragged switcher layer
const IMAGE := "(?i)\\.(jpe?g|png|gif|bmp|webp|tiff?)$"  # web setLayerSource: a still never loops


## WO-952: the look editor's frame and list take media sources and Layer presets tab cards.
static func can_take(data: Variant) -> bool:
	return LP.is_drag(data) or not Ops.drop_sources(data).is_empty()


## A drop of either kind. A preset card applies its style (everything but the source) to the layer under the pointer —
## or, off every layer, to the selected one — without taking the right column away from the Layer presets tab.
static func drop_data(ed: Variant, api: Variant, target: int, data: Variant) -> void:
	if not LP.is_drag(data):
		await drop(ed, api, target, Ops.drop_sources(data))
		return
	var layers: Array = ed._layers()
	var i: int = target if target >= 0 else int(ed._sel)
	if i < 0 or i >= layers.size() or not (layers[i] is Dictionary):
		ed.show_status("Drop the preset on a layer (its box or its row)")
		return
	ed._select(i, false)
	ed._apply_layer(S.style_patch(data.data))
	ed.show_status("Preset “%s” applied to L%d" % [str(data.get("name", "")), int((layers[i] as Dictionary).get("layerNumber", 0))])


## `target` = the layer index the pointer is on (-1 = none): its media is exchanged with the first source.
static func drop(ed: Variant, api: Variant, target: int, sources: Array) -> void:
	for k in sources.size():  # in drag order; a refusal stops the rest
		var ok := false
		if k == 0 and target >= 0 and not Pixelhue.patch_of_source(sources[k]).is_empty():
			ok = move_to_pixelhue(ed, target, sources[k])  # WO-1035: on a layer it moves that layer, its media stays
		elif k == 0 and target >= 0:
			ok = await exchange(ed, api, target, sources[k])
		else:
			ok = await add(ed, api, sources[k])
		if not ok:
			return


## WO-1035: a PixelHue layer dropped ON a look layer puts that layer on the switcher layer's rectangle.
static func move_to_pixelhue(ed: Variant, i: int, src: Dictionary) -> bool:
	var layers: Array = ed._layers()
	if i >= layers.size() or not (layers[i] is Dictionary):
		return false
	ed._select(i)
	ed._apply_layer(Pixelhue.patch_of_source(src))
	ed.show_status("L%d moved onto %s" % [int((layers[i] as Dictionary).get("layerNumber", 0)), str(src.get("label", "the PixelHue layer"))])
	return true


## web isLayerSourceExchange: a layer that already shows something keeps its transform.
static func has_media(layer: Variant) -> bool:
	return layer is Dictionary and layer.get("source") is Dictionary and str(layer.source.get("value", "")) != ""


## What an exchange writes on `layer`: the new source only — fill, rotation, crop, trim, start, loop, audio route stay
## (web todos19.07.26: "exchanging an existing layer's content keeps its transform"). A still image stops looping, a
## live_audio source starts invisible (web row drop); an EMPTY layer takes the server's content-fit fill when the
## server knew the media size (web applyNativeFillForSource), else keeps its own.
static func exchange_patch(layer: Dictionary, built: Dictionary, size_known: bool) -> Dictionary:
	var src: Dictionary = built.source
	var p := {"source": src}
	if RegEx.create_from_string(IMAGE).search(str(src.get("value", ""))) != null:
		p["loop"] = false
	if str(src.get("type", "")) == "live_audio":
		p["opacity"] = 0.0
	if not has_media(layer) and size_known and built.get("fill") is Dictionary:
		p["fill"] = built.fill
	return p


static func exchange(ed: Variant, api: Variant, i: int, src: Dictionary) -> bool:
	var layers: Array = ed._layers()
	if i >= layers.size() or not (layers[i] is Dictionary):
		return await add(ed, api, src)
	var layer: Dictionary = layers[i]
	var n := int(layer.get("layerNumber", 0))
	var res: Dictionary = await api.post_json("/api/scene/new-layer", {"sceneId": ed.scene_id, "mainIdx": ed.main, "source": src, "layerNumber": n})
	if not res.ok or not (res.data is Dictionary) or not ((res.data as Dictionary).get("layer") is Dictionary):
		ed.show_status("Exchange refused: %s" % Store.fail_text(res))
		return false
	i = (ed._layers() as Array).find(layer)  # a project reload while the server answered → the layer is gone
	if i < 0:
		ed.show_status("Exchange dropped: the look changed")
		return false
	var was := Ops.layer_name(layer.source) if has_media(layer) else ""
	ed._select(i)
	reveal(ed)
	ed._apply_layer(exchange_patch(layer, res.data.layer, res.data.get("contentResolution") is Dictionary))
	ed._refresh_list()
	var now := Ops.layer_name(res.data.layer.source)
	ed.show_status("L%d: %s → %s" % [n, was, now] if was != "" else "L%d: %s added" % [n, now])
	return true


## WO-600 K: the server builds the layer (next free number, web rules) → append + push.
static func add(ed: Variant, api: Variant, src: Dictionary) -> bool:
	var res: Dictionary = await api.post_json("/api/scene/new-layer", {"sceneId": ed.scene_id, "mainIdx": ed.main, "source": src})
	if not res.ok or not (res.data is Dictionary) or not ((res.data as Dictionary).get("layer") is Dictionary):
		ed.show_status("Add layer refused: %s" % Store.fail_text(res))
		return false
	var lk: Dictionary = ed.look()
	if not (lk.get("layers") is Array):
		lk["layers"] = []
	(res.data.layer as Dictionary).merge(Pixelhue.patch_of_source(src), true)  # WO-1035: an empty layer on the switcher layer
	if res.data.layer.get("source") is Dictionary:
		(res.data.layer.source as Dictionary).erase("pixelhueFill")
	(lk.layers as Array).append(res.data.layer)
	ed._refresh_list()
	ed._select((lk.layers as Array).size() - 1)
	reveal(ed)
	ed.pusher.schedule(ed.scene_id, ed.main)
	return true


## WO-965 (owner 05.11: "droping a media into looks editor should auto open the layers inspector"): `_select` presents
## the layer page, but over a `keep_on_select` tab (Layer presets, WO-952 — kept for layer clicks) the column stayed
## there and the page loaded unseen. A media drop is a new layer, not a click: bring the Inspector tab forward.
static func reveal(ed: Variant) -> void:
	var ip: Node = InspectorPanel.current
	if ed is Node and ip != null and is_instance_valid(ip) and ip.showing(ed.get("_page")):
		ip.show_tab(0)
