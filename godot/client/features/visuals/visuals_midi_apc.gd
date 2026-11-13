extends Node
## WO-909 — the APC40 profile of the Visuals' MIDI controller (visuals_midi.gd): the work area's "Controller" mode draws the
## unit (features/midi/apc40_surface.gd) with what each fader, knob, pad and button does right now — the live names (layer
## 2 = "Particles", pad 3 = the look's name), values, pickup ticks and lights — and flashes whatever is touched. Clicking a
## control starts Learn for it. The auto mapping: the 8 device knobs ("dev:N") follow the selected layer — a shader layer's
## key controls (the Shader mode's sliders, in its order and names), any other layer the camera and burst page — and the
## track select buttons ("select:N") pick that layer, so the knobs re-label themselves as the selection or the shader
## changes. A knob that lands on a new parameter waits for pickup like any fader (midi_pickup.gd). WO-913: a visual dropped on
## a clip-grid pad makes it a visual pad (visuals_midi_clips.gd), drawn in the visual's colour.
## WO-1054: knobs 5–8 are always X / Y / Size / Rotate of the selected layer (the page's Position block, visuals_position.gd);
## knobs 1–4 hold 4 entries of the old page at a time — ◀ Device / Device ▶ ("devpage:prev|next") page through a shader's
## further key controls; the page goes back to the first when the selection changes.

const MidiMap := preload("res://features/midi/midi_map.gd")
const Pickup := preload("res://features/midi/midi_pickup.gd")
const L := preload("res://features/midi/apc40_layout.gd")
const Surface := preload("res://features/midi/apc40_surface.gd")
const Layers := preload("res://features/visuals/visuals_layers.gd")
const Catalog := preload("res://features/visuals/visuals_catalog.gd")
const Pxl := preload("res://features/visuals/visuals_midi_pxl.gd")
const FALLBACK := ["param:cam_yaw", "param:cam_pitch", "param:cam_zoom", "param:burst"]
const HINT := "Controller: what every APC40 control does now, and a virtual one — drag a fader, drag a knob up / down (or the wheel), click a button or pad to press it · right-click anything to Learn it · drop a visual on a pad · ▲ ▼ = pad banks · ◀ ▶ = edit bank A / B"

var midi: Node
var surface: Surface
var _page := []  # the device knob page: [{label, control}] — refreshed at most every 0.1 s
var _page_at := -1000
var dev_page := 0  ## WO-1054: which 4 entries knobs 1–4 hold (0 = the first)
var _page_sel := -2  # the selection the page index belongs to
var _pages := 1  # how many pages of 4 the selected layer has
var _bank_btn := {}  # WO-1070: "prev" / "next" → the hidden Button that "padbank:…" presses
var _page_btn := {}  # WO-1054: "prev" / "next" → the hidden Button that "devpage:…" presses


func _init(m: Node) -> void:
	midi = m
	surface = Surface.new()
	surface.info_cb = info
	surface.picked.connect(_learn)
	surface.clicked.connect(_click)
	surface.turned.connect(turn)
	surface.can_drop_cb = func(c: Dictionary, data: Variant) -> bool: return midi.clips.is_grid(int(c.num)) and c.shape == "pad" and Catalog.parse(data) != null
	surface.dropped.connect(func(c: Dictionary, data: Variant) -> void: midi.clips.drop(int(c.num), data))
	for d in ["prev", "next"]:  # WO-1054: real buttons, so MIDI presses them the way it presses any button target
		var b := Button.new()
		b.visible = false
		b.pressed.connect(turn_page.bind(-1 if d == "prev" else 1))
		add_child(b)
		_page_btn[d] = b
		var pb := Button.new()  # WO-1070: ▲ / ▼ — the pads' previous / next bank
		pb.visible = false
		pb.pressed.connect(func() -> void: midi.clips.page(-1 if d == "prev" else 1))
		add_child(pb)
		_bank_btn[d] = pb


## WO-1054: knobs 1–4 to the previous (-1) or next (+1) page of 4 (clamped).
func turn_page(d: int) -> void:
	page()
	dev_page = clampi(dev_page + d, 0, _pages - 1)
	_page_at = -1000


## The device knob page now: knobs 1–4 = 4 of the selected shader layer's key sliders (page `dev_page`), else the camera /
## burst sliders; knobs 5–8 = the selected layer's X / Y / Size / Rotate (WO-1054).
func page() -> Array:
	var now := Time.get_ticks_msec()
	if now - _page_at < 100:
		return _page
	_page_at = now
	var tab: Node = midi.tab
	if tab.sel != _page_sel:  # a new selection starts at its first page
		_page_sel = tab.sel
		dev_page = 0
	var sm: Variant = tab.work._modes.get("shader", {}).get("control") if tab.work != null else null
	var out := []
	if sm != null:
		sm.refresh()  # (cheap when the shader is unchanged; loads a newly selected one)
		var l: Dictionary = tab.slice.layers[tab.sel] if tab.sel >= 0 and tab.sel < tab.slice.layers.size() else {}
		if l.get("scene") == "shader":
			for k in sm.key_controls():
				out.append({"label": str(k.label), "control": k.control})
	if out.is_empty():
		for t in FALLBACK:
			out.append({"label": label(t), "control": tab.page.control(t)})
	_pages = maxi(1, ceili(out.size() / 4.0))
	dev_page = clampi(dev_page, 0, _pages - 1)
	out = out.slice(dev_page * 4, dev_page * 4 + 4)
	while out.size() < 4:
		out.append({"label": "—", "control": null})
	_page = out + tab.page.place.entries()
	return _page


## WO-1054: is there a page in the direction of "devpage:prev" / "devpage:next"?
func can_page(target: String) -> bool:
	if target.begins_with("padbank:"):  # WO-1070
		return midi.clips.can_page(-1 if target.ends_with("prev") else 1)
	page()
	return dev_page > 0 if target.ends_with("prev") else dev_page < _pages - 1


## "dev:N" / "select:N" → the control (null = not there now).
func control_of(target: String) -> Control:
	var n := int(target.get_slice(":", 1)) - 1
	if target.begins_with("dev:"):
		var p := page()
		return p[n].control if n >= 0 and n < p.size() and is_instance_valid(p[n].control) else null
	if target.begins_with("pos:"):  # WO-1054
		return midi.tab.page.place.control(target) if midi.tab.page.place.visible else null
	if target.begins_with("devpage:"):
		return _page_btn.get(target.get_slice(":", 1))
	if target.begins_with("padbank:"):  # WO-1070: there while the pads have a bank that way
		return _bank_btn.get(target.get_slice(":", 1)) if can_page(target) else null
	var rows: Array = midi.tab.page.layer_list.rows
	if target.begins_with("select:") and n >= rows.size() and n < 8:
		return surface  # WO-1047: an empty track's Sel arms a new layer (visuals_midi_clips.gd new_slot)
	return rows[n].panel if n >= 0 and n < rows.size() else null


## Track select N: layer N becomes the selected one (the device knobs follow it).
func select(target: String) -> void:
	var n := int(target.get_slice(":", 1)) - 1
	var list: Node = midi.tab.page.layer_list
	midi.clips.new_slot = n if n >= list.rows.size() and n < 8 else -1
	if n >= 0 and n < list.rows.size():
		list.select(n)
		list.selected.emit(n)
		_page_at = -1000


## What a target is called right now: the layer's, look's or parameter's own name.
func label(target: String) -> String:
	var tab: Node = midi.tab
	var kind := target.get_slice(":", 0)
	var n := int(target.get_slice(":", 1)) - 1
	var layers: Array = tab.slice.get("layers", [])
	var lay := Layers.short(layers[n]) if n >= 0 and n < layers.size() else ""
	match kind:
		"layer":
			return "%d %s" % [n + 1, lay] if lay != "" else "Layer %d" % (n + 1)
		"mute":
			return "Mute %s" % (lay if lay != "" else str(n + 1))
		"select":
			return "Sel %s" % (lay if lay != "" else str(n + 1))
		"look":
			var looks: Array = tab.show_ctl.looks
			return str(looks[n].name) if n >= 0 and n < looks.size() else "Look %d" % (n + 1)
		"dev":
			var p := page()
			return str(p[n].label) if n >= 0 and n < p.size() else "—"
		"param":
			return MidiMap.target_label(target).replace("Camera ", "Cam ")
		"xfade":
			return "A ↔ B"
		"take":
			return "A/B AUTO"
		"cut":
			return "A/B CUT"
		"edit":
			return "Edit " + ("A" if n == 0 else "B")
		"clear":
			return "Clear layer"
		"fade":
			return "Fade time"
		"clip":
			return midi.clips.label(n + 1)
		"pxl":  # WO-1050
			return Pxl.label(target)
		"pos":  # WO-1054
			return MidiMap.POS_LABELS.get(target.get_slice(":", 1), target)
		"devpage":  # WO-1054: ◀ Device / Device ▶ — "Keys 1/3"
			page()
			return ("◀ Keys %d/%d" if target.ends_with("prev") else "Keys %d/%d ▶") % [dev_page + 1, _pages]
		"padbank":  # WO-1070: ▲ / ▼ — "▲ 2/6"
			return ("▲ %d/%d" if target.ends_with("prev") else "▼ %d/%d") % [midi.clips.bank + 1, midi.clips.banks.size()]
	return MidiMap.target_label(target)


## The surface's view of one control (apc40_surface.gd info_cb).
func info(c: Dictionary) -> Dictionary:
	var b := MidiMap.find(midi.map, L.msg_of(c))
	if b.is_empty():
		return {"label": "", "value": -1.0, "lit": 0, "waiting": false, "hw": -1.0, "line": ""}
	var t: String = b.target
	var ctl: Control = midi.control_of(t)
	var rng := MidiMap.is_range(t)
	var value := (ctl as Range).ratio if rng and ctl is Range else -1.0
	var st: Variant = midi.pick.get(MidiMap.key(b))
	var waiting: bool = st is Dictionary and Pickup.waiting(st)
	var line := "%s → %s" % [c.name, MidiMap.target_label(t) if t.begins_with("dev:") or t.begins_with("layer:") else label(t)]
	if t.begins_with("clip:"):
		line = "%s → %s: press = into the selected layer of the edited bank (drop another visual to replace it)" % [c.name, label(t)]
	elif t.begins_with("dev:") or t.begins_with("layer:") or t.begins_with("look:"):
		line += ": " + label(t)
	if t.begins_with("padbank:"):  # WO-1070
		line = "%s → %s · %s" % [c.name, MidiMap.target_label(t), midi.clips.bank_label()]
	elif ctl == null:
		line += " (not there now)"
	elif value >= 0.0:
		line += " · %d %%" % roundi(value * 100.0)
	if waiting:
		line += " · waiting: bring the control to the app value (amber tick = where it is)"
	return {"label": label(t), "value": value, "lit": 0 if rng else (midi.led_state(t) if ctl != null else 0), "waiting": waiting,
		"hw": float(st.hw) if st is Dictionary else -1.0, "line": line,
		"color": midi.clips.color(int(c.num)) if t.begins_with("clip:") and ctl != null else null}


## WO-913: a click on a mapped button or pad presses it (as the hardware would); on an unmapped control (or a knob / fader whose
## target is not there now — a mapped one is dragged instead, WO-946) it Learns.
func _click(c: Dictionary) -> void:
	var b := MidiMap.find(midi.map, L.msg_of(c))
	if b.is_empty() or MidiMap.is_range(b.target) or c.kind != "note":
		_learn(c)
		return
	midi.handle_msg({"kind": "note", "ch": maxi(0, int(c.ch)), "num": int(c.num), "val": 127})


## WO-946: a fader / knob moved with the mouse — the message the unit would send, marked virtual: it drives the same target
## (and Learns in Learn mode), but sets the value as it is (no pickup — the drawing already sits at the app value) and leaves
## the hardware's pickup state alone, so the real fader waits for the new value like after any other edit.
func turn(c: Dictionary, ratio: float) -> void:
	var v := clampf(ratio, 0.0, 1.0)
	midi.handle_msg({"kind": "cc", "ch": maxi(0, int(c.ch)), "num": int(c.num), "val": roundi(v * 127.0), "ratio": v, "virtual": true})


## A right-click (or a click on an unmapped control, or one whose target is not there now): Learn for it — the next click in the Inspector picks what it drives.
func _learn(c: Dictionary) -> void:
	midi._set_mode("learn")
	midi._captured(L.msg_of(c))
