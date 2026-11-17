extends RefCounted
## WO-1070 — the whole visuals library on the APC40's pads, by dominant colour (owner 13.11: "map the whole library to
## the pad buttons on the akai based on dominant color"). Every row of Sources ▸ Visuals (the scenes, the box's shader
## library, the ROMs) becomes a pad: the ones with a colour in hue order (red → orange → … → pink), then the grey ones
## (white pads), then the ones without a thumbnail (games; a colour of their name) — 40 to a bank, top row first, each
## bank named after its colours ("Blue – Purple"). The colour is the thumbnail's dominant one (apc40_palette.gd
## main_color), so a missing thumbnail is rendered first (visuals_thumbs.gd, the Sources tab's cache).
## banks() is pure; fill() is the menu action (visuals_midi.gd ⋯ ▸ "Pads: the whole library, by colour").

const Palette := preload("res://features/midi/apc40_palette.gd")
const Clips := preload("res://features/visuals/visuals_midi_clips.gd")
const PER_BANK := 40
const WAIT_S := 120.0  # the longest the fill waits for thumbnails (a first run renders ~200 shaders)
const COLOUR_CACHE_MAX := 2000

## WO-1106 B29: one fill at a time (a second menu click started a second ~200-row pass): when the running one started,
## -1 = none. A fill whose await never came back (its list freed) stops blocking after FILL_STALE_MS.
static var _filling_ms := -1
const FILL_STALE_MS := 180000  # WAIT_S and a minute
static var _colours := {}  # WO-1106 B29: "thumb path#texture id" → its dominant Color (a new texture = a new key)


## Pad `i` of a bank (0 = top left, row by row) → its note (the top row is 32–39, the bottom one 0–7).
static func note_of(i: int) -> int:
	return (4 - int(i / 8.0)) * 8 + i % 8


## `rows` (visuals_catalog.gd rows) → the auto banks. `color_of.call(row)` = the row's dominant colour, or null when it
## has no thumbnail.
static func banks(rows: Array, color_of: Callable) -> Array:
	var coloured := []
	var grey := []
	var plain := []
	for r in rows:
		var c: Variant = color_of.call(r)
		if not c is Color:
			plain.append({"row": r, "color": Palette.of_name(str(r.name)), "kind": "plain"})
		elif (c as Color).s < 0.15:
			grey.append({"row": r, "color": Color.WHITE, "kind": "grey"})
		else:
			coloured.append({"row": r, "color": c, "kind": "hue"})
	coloured.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var ha := _hue_key(a.color)
		var hb := _hue_key(b.color)
		return ha < hb if ha != hb else str(a.row.name).naturalnocasecmp_to(str(b.row.name)) < 0)
	var out := []
	var all := coloured + grey + plain
	for at in range(0, all.size(), PER_BANK):
		var part := all.slice(at, at + PER_BANK)
		var clips := {}
		var names := []
		for i in part.size():
			var e: Dictionary = part[i]
			var p: Dictionary = (e.row.payload as Dictionary).duplicate(true)
			clips[str(note_of(i))] = {"payload": p, "color": "#" + (e.color as Color).to_html(false)}
			var nm: String = Palette.hue_name(e.color) if e.kind == "hue" else ("White" if e.kind == "grey" else "No thumbnail")
			if names.is_empty() or names.back() != nm:
				names.append(nm)
		var label: String = names[0] if names.size() == 1 else "%s – %s" % [names[0], names.back()]
		out.append({"name": label, "auto": true, "clips": clips})
	return out


## Hue with the wheel cut where "Red" starts (a pinkish red at 0.97 sorts with the reds, not after the pinks).
static func _hue_key(c: Color) -> float:
	return fposmod(c.h + (1.0 - Palette.HUE_ENDS.back()), 1.0)


## The menu action: read the library, render the thumbnails it lacks, put the banks on the pads. `midi` = visuals_midi.gd.
static func fill(midi: Node) -> void:
	if _filling_ms >= 0 and Time.get_ticks_msec() - _filling_ms < FILL_STALE_MS:
		midi._say("Pads: the library is being put on the pads already…")
		return
	_filling_ms = Time.get_ticks_msec()
	await _fill(midi)
	_filling_ms = -1


## A thumbnail's dominant colour, computed once per thumbnail texture (WO-1106 B29: every fill read back ~200 images).
static func colour_of(path: String, tex: Texture2D) -> Color:
	var key := "%s#%d" % [path, tex.get_instance_id()]
	if not _colours.has(key):
		if _colours.size() >= COLOUR_CACHE_MAX:
			_colours.clear()
		_colours[key] = Palette.main_color(tex.get_image())
	return _colours[key]


static func _fill(midi: Node) -> void:
	var panel: Node = midi.get_tree().get_first_node_in_group("visuals_list") if midi.is_inside_tree() else null
	if panel == null:
		midi._say("Pads: the visuals list is not there — open Sources ▸ Visuals once, then try again")
		return
	midi._say("Pads: reading the library…")
	var rows: Array = await panel.library_rows()
	if not is_instance_valid(midi) or not is_instance_valid(panel):
		return
	if rows.is_empty():
		midi._say("Pads: no visuals — the shader library is on the box (is it reachable?)")
		return
	var thumbs: Node = panel.thumbs
	var until := Time.get_ticks_msec() + int(WAIT_S * 1000.0)
	# WO-1106 B29: one pass finds the missing thumbnails (keyed, each asked for once); later ticks look at those only.
	var waiting := {}  # thumb key → its payload
	var seen := {}
	for r in rows:
		if r.thumb == "" or seen.has(r.thumb):
			continue
		seen[r.thumb] = true
		if not thumbs.failed.has(r.thumb) and thumbs.texture(r.thumb) == null:
			waiting[r.thumb] = r.payload
			thumbs.request(r.thumb, r.payload)
	while not waiting.is_empty() and Time.get_ticks_msec() <= until:
		midi._say("Pads: rendering thumbnails — %d of %d to go…" % [waiting.size(), rows.size()])
		await midi.get_tree().create_timer(0.25).timeout
		if not is_instance_valid(midi) or not is_instance_valid(panel):
			return
		for k in waiting.keys():
			if thumbs.is_cached(k) or thumbs.failed.has(k):
				waiting.erase(k)
			elif not thumbs.is_pending(k):  # the list dropped its queue (a rebuild): ask again
				thumbs.request(k, waiting[k])
	var made := banks(rows, func(r: Dictionary) -> Variant:
		var tex: Texture2D = thumbs.texture(r.thumb) if r.thumb != "" else null
		return colour_of(str(r.thumb), tex) if tex != null else null)
	var own: int = midi.clips.banks.filter(func(b: Dictionary) -> bool: return not b.get("auto", false) and not b.clips.is_empty()).size()
	midi.clips.set_auto_banks(made)
	var shown: int = midi.clips.banks.size() - own
	midi._say("Pads: %d visuals by colour in %d bank%s%s — ▲ / ▼ page through them%s" % [rows.size(), made.size(), "" if made.size() == 1 else "s",
		" (after your own %d)" % own if own > 0 else "", "" if shown == made.size() else " · only %d banks fit" % shown])
