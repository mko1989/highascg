extends RefCounted
## WO-913 — visual pads (owner 31.10: "drop different visuals onto the buttons/pads to load them instantly to prv a or b";
## "the button should show the visuals main color as the backlight"). A visual from Sources ▸ Visuals dropped on a clip-grid
## pad of the Controller mode binds that pad ("clip:<note>", replacing what it drove) to the visual, with the visual's main
## colour (its thumbnail, apc40_palette.gd). Pressing the pad loads the visual into the PRV bank (A/B on: editing moves to
## the bank off the canvas first, as a look does) — into the layer of the pad's column, the APC's track = layer convention
## of its faders, mutes and selects; a column past the bank's layers adds one on top. Kept with the mapping (ui.cfg [midi]).

const Palette := preload("res://features/midi/apc40_palette.gd")
const MidiMap := preload("res://features/midi/midi_map.gd")
const UiCfg := preload("res://core/ui_cfg.gd")
const KEY := "clips"

var midi: Node
var clips := {}  ## pad note (String) → {payload: the Sources row's drag payload, color: "#rrggbb"}


func _init(m: Node) -> void:
	midi = m


## A clip-grid pad (notes 0–39; the scene launch column is not one).
static func is_grid(num: int) -> bool:
	return num >= 0 and num <= 39


## The drag payload → a clip: its colour from the payload's thumbnail colour, else a hue of its name.
static func clip_of(payload: Dictionary) -> Dictionary:
	var p := payload.duplicate(true)
	var col: Variant = p.get("color")
	p.erase("color")
	var c := Color.html(col) if col is String and Color.html_is_valid(col) else Palette.of_name(str(p.get("label", p.get("shader", p.get("game", "")))))
	return {"payload": p, "color": "#" + c.to_html(false)}


## `payload` dropped on pad `num`: the pad drives it from now on.
func drop(num: int, payload: Dictionary) -> void:
	if not is_grid(num):
		return
	clips[str(num)] = clip_of(payload)
	midi.map = MidiMap.learn(midi.map, {"kind": "note", "ch": MidiMap.ANY, "num": num}, "clip:%d" % num)
	midi._saved()
	save()
	if not midi.leds and midi.cfg_path != "":  # the colour is the pad's backlight: the host lights the pads from here
		midi.leds = true
		UiCfg.save_value(midi.SECTION, "leds", true, midi.cfg_path)
		midi._leds_changed()
	midi._say("%s → pad %s: press it to load it into PRV (layer %d)" % [label(num), midi._name({"kind": "note", "ch": 0, "num": num}), num % 8 + 1])


## Pad `num` pressed: its visual into the PRV bank, the column's layer.
func fire(num: int) -> void:
	var c: Variant = clips.get(str(num))
	if not c is Dictionary:
		return
	var tab: Node = midi.tab
	tab.dj.to_prv()
	var col := num % 8
	tab.drop_visual(c.payload, col if col < tab.slice.get("layers", []).size() else -1)


func has(num: int) -> bool:
	return clips.has(str(num))


func color(num: int) -> Color:
	var c: Variant = clips.get(str(num))
	return Color.html(c.color) if c is Dictionary else Color.BLACK


## The pad's velocity (its palette colour), -1 = not a visual pad.
func velocity(target: String) -> int:
	if not target.begins_with("clip:") or not has(int(target.get_slice(":", 1))):
		return -1
	return Palette.nearest(color(int(target.get_slice(":", 1))))


func label(num: int) -> String:
	var c: Variant = clips.get(str(num))
	return str(c.payload.get("label", "")) if c is Dictionary else ""


func load_from(c: ConfigFile) -> void:
	var v: Variant = c.get_value(midi.SECTION, KEY, {})
	clips = {}
	if v is Dictionary:
		for k in v:
			if v[k] is Dictionary and v[k].get("payload") is Dictionary and is_grid(int(k)):
				clips[str(int(k))] = {"payload": v[k].payload, "color": str(v[k].get("color", "#ffffff"))}


func save() -> void:
	if midi.cfg_path != "":
		UiCfg.save_value(midi.SECTION, KEY, clips, midi.cfg_path)
