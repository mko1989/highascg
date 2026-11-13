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
	while true:
		var missing := 0
		for r in rows:
			if r.thumb != "" and thumbs.texture(r.thumb) == null and not thumbs.failed.has(r.thumb):
				thumbs.request(r.thumb, r.payload)
				missing += 1
		if missing == 0 or Time.get_ticks_msec() > until:
			break
		midi._say("Pads: rendering thumbnails — %d of %d to go…" % [missing, rows.size()])
		await midi.get_tree().create_timer(0.25).timeout
		if not is_instance_valid(midi) or not is_instance_valid(panel):
			return
	var made := banks(rows, func(r: Dictionary) -> Variant:
		var tex: Texture2D = thumbs.texture(r.thumb) if r.thumb != "" else null
		return Palette.main_color(tex.get_image()) if tex != null else null)
	var own: int = midi.clips.banks.filter(func(b: Dictionary) -> bool: return not b.get("auto", false) and not b.clips.is_empty()).size()
	midi.clips.set_auto_banks(made)
	var shown: int = midi.clips.banks.size() - own
	midi._say("Pads: %d visuals by colour in %d bank%s%s — ▲ / ▼ page through them%s" % [rows.size(), made.size(), "" if made.size() == 1 else "s",
		" (after your own %d)" % own if own > 0 else "", "" if shown == made.size() else " · only %d banks fit" % shown])
