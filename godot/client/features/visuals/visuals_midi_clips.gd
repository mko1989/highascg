extends RefCounted
## WO-913 — visual pads (owner 31.10: "drop different visuals onto the buttons/pads to load them instantly to prv a or b";
## "the button should show the visuals main color as the backlight"). A visual from Sources ▸ Visuals dropped on a clip-grid
## pad of the Controller mode binds that pad ("clip:<note>", replacing what it drove) to the visual, with the visual's main
## colour (its thumbnail, apc40_palette.gd). Pressing the pad loads the visual into the selected layer (track select / a
## click in the layer list; none = the top one, no layers = a new one) of the bank being edited — A/B on: the one ◀ / ▶ or
## Edit A / B picked, PRV or, on purpose, the bank on air. Kept with the mapping (ui.cfg [midi]).
## WO-1070 — pad banks (owner 13.11: "banks of the different visuals on different pads"): the 40 pads hold one bank at a
## time, ▲ / ▼ ("padbank:prev|next") page through them. A bank is {name, auto, clips}; `auto` banks are the library
## fill's (visuals_midi_library.gd: the whole library by dominant colour) and are replaced by the next fill, the others
## are the operator's own. One step past the last bank is a new empty one to drop visuals on (gone again when left empty).

const Palette := preload("res://features/midi/apc40_palette.gd")
const MidiMap := preload("res://features/midi/midi_map.gd")
const UiCfg := preload("res://core/ui_cfg.gd")
const KEY := "clips"  # the pads before WO-1070: read as bank 1, never written again (a rollback finds its pads)
const BANKS_KEY := "clip_banks"
const BANK_KEY := "clip_bank"
const MAX_BANKS := 16

var midi: Node
var banks := [{"name": "", "auto": false, "clips": {}}]  ## WO-1070: [{name, auto, clips}]
var bank := 0  ## the bank on the pads
## The bank on the pads: pad note (String) → {payload: the Sources row's drag payload, color: "#rrggbb"}
var clips: Dictionary:
	get:
		return banks[bank].clips
	set(v):
		banks[bank].clips = v


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
	midi._say("%s → pad %s: press it to load it into the selected layer" % [label(num), midi._name({"kind": "note", "ch": 0, "num": num})])


## Pad `num` pressed: its visual into the edited bank's selected layer.
## Owner 12.11: "i cant change select slot/layer on the controller to set different layer with a visual from the pads" —
## the edited bank had one layer, so Sel 2–8 had nothing to pick and every pad replaced layer 1. Sel on an empty track
## arms a new slot (its index, -1 = none): the next pad ADDS its visual on top (Layers.drop target -1) and that layer
## becomes the selected one. Picking a layer (Sel, a click) or switching the edited bank disarms it.
var new_slot := -1


func fire(num: int) -> void:
	var c: Variant = clips.get(str(num))
	if not c is Dictionary:
		return
	var target: int = -1 if new_slot >= 0 else midi.tab._target()
	new_slot = -1
	midi.tab.drop_visual(c.payload, target)


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


## WO-1070: can the pads go a bank up (-1) / down (+1)? Down from the last bank only when it holds something.
func can_page(d: int) -> bool:
	if d < 0:
		return bank > 0
	return bank < banks.size() - 1 or (not clips.is_empty() and banks.size() < MAX_BANKS)


## WO-1070: the pads show the previous (-1) / next (+1) bank.
func page(d: int) -> void:
	if not can_page(d):
		return
	var to := bank + signi(d)
	if to >= banks.size():
		banks.append({"name": "", "auto": false, "clips": {}})
	show_bank(to)


func show_bank(i: int) -> void:
	var from := bank
	bank = clampi(i, 0, banks.size() - 1)
	if from != bank and from == banks.size() - 1 and from > 0 and banks[from].clips.is_empty():
		banks.remove_at(from)  # the empty bank at the end, left empty
	new_slot = -1
	bind_pads()
	save()
	midi._say.call_deferred(bank_label())  # (after the button's own "▲ → …" line)


## "Pads 2/6 · Blue – Purple"
func bank_label() -> String:
	var nm := str(banks[bank].get("name", ""))
	return "Pads %d/%d%s" % [bank + 1, banks.size(), " · " + nm if nm != "" else (" · empty: drop visuals on the pads" if clips.is_empty() else "")]


## WO-1070: every pad that holds a visual in any bank drives "clip:<note>" (a pad bound to a look until now is the bank's).
func bind_pads() -> void:
	var changed := false
	for b in banks:
		for k in b.clips:
			var msg := {"kind": "note", "ch": MidiMap.ANY, "num": int(k)}
			if MidiMap.find(midi.map, {"kind": "note", "ch": 0, "num": int(k)}).get("target", "") != "clip:%d" % int(k):
				midi.map = MidiMap.learn(midi.map, msg, "clip:%d" % int(k))
				changed = true
	if changed:
		midi._saved()


## WO-1070: the library fill's banks replace the earlier fill's; the operator's own banks stay in front. The pads go to
## the first new bank.
func set_auto_banks(auto: Array) -> void:
	banks = banks.filter(func(b: Dictionary) -> bool: return not b.get("auto", false) and not b.clips.is_empty())
	var first := banks.size()
	banks.append_array(auto.slice(0, MAX_BANKS - banks.size()))
	if banks.is_empty():
		banks = [{"name": "", "auto": false, "clips": {}}]
	bank = clampi(first, 0, banks.size() - 1)
	new_slot = -1
	bind_pads()
	save()
	if not midi.leds and midi.cfg_path != "":
		midi.leds = true
		UiCfg.save_value(midi.SECTION, "leds", true, midi.cfg_path)
		midi._leds_changed()


static func _clips_of(v: Variant) -> Dictionary:
	var out := {}
	if v is Dictionary:
		for k in v:
			if v[k] is Dictionary and v[k].get("payload") is Dictionary and is_grid(int(k)):
				out[str(int(k))] = {"payload": v[k].payload, "color": str(v[k].get("color", "#ffffff"))}
	return out


func load_from(c: ConfigFile) -> void:
	banks = []
	var bs: Variant = c.get_value(midi.SECTION, BANKS_KEY, null)
	if bs is Array:
		for b in bs:
			if b is Dictionary and banks.size() < MAX_BANKS:
				banks.append({"name": str(b.get("name", "")), "auto": b.get("auto", false) == true, "clips": _clips_of(b.get("clips"))})
	else:
		banks.append({"name": "", "auto": false, "clips": _clips_of(c.get_value(midi.SECTION, KEY, {}))})
	if banks.is_empty():
		banks.append({"name": "", "auto": false, "clips": {}})
	bank = clampi(int(c.get_value(midi.SECTION, BANK_KEY, 0)), 0, banks.size() - 1)


func save() -> void:
	if midi.cfg_path != "":
		UiCfg.save_value(midi.SECTION, BANKS_KEY, banks, midi.cfg_path)
		UiCfg.save_value(midi.SECTION, BANK_KEY, bank, midi.cfg_path)
