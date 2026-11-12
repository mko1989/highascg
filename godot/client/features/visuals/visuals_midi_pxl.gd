extends RefCounted
## WO-1050 — the "pxl:<layerId>" MIDI targets of visuals_midi.gd: a PixelHue switcher layer's opacity, one slider each in
## the Visuals Inspector page's PixelHue block (visuals_pixelhue.gd). Kept out of visuals_midi.gd (500-line limit).

const MidiMap := preload("res://features/midi/midi_map.gd")


## The slider of `target` ("pxl:<layerId>"); null while the switcher does not list that layer (or no PixelHue is set).
static func control_of(page: Object, target: String) -> Control:
	var block: Variant = page.get("pixelhue") if page != null else null
	return block.slider_of(int(target.get_slice(":", 1))) if block != null else null


## Every PixelHue target Learn / Unmap can click now.
static func targets(page: Object) -> Array:
	var block: Variant = page.get("pixelhue") if page != null else null
	return [] if block == null else block.ids().map(func(id: int) -> String: return "pxl:%d" % id)


## The virtual controller's short name: "PH Layer 2".
static func label(target: String) -> String:
	var id := target.get_slice(":", 1)
	return "PH " + str(MidiMap.pxl_names.get(id, id))


## visuals_midi.gd tick: the block's waiting moves go out, its list is re-read now and then.
static func tick(page: Object) -> void:
	var block: Variant = page.get("pixelhue") if page != null else null
	if block != null:
		block.tick(Time.get_ticks_msec())
