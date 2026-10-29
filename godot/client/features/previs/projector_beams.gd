extends RefCounted
## Projector beams in the 3D views: the lines from each projector to the picture it throws (stage_builder "projection").
## One switch, like haze (ui.cfg [previs] projector_beams, default on). The toolbar checkbox sets it; every
## StageBuilder shows or hides its beams in place (visibility, no rebuild).

signal changed(on: bool)

const UI_CFG := "user://ui.cfg"

static var _shared: RefCounted

var on := true


static func shared() -> RefCounted:
	if _shared == null:
		_shared = new()
		var cfg := ConfigFile.new()
		cfg.load(UI_CFG)
		_shared.on = cfg.get_value("previs", "projector_beams", true) == true
	return _shared


func set_on(v: bool) -> void:
	on = v
	var cfg := ConfigFile.new()
	cfg.load(UI_CFG)
	cfg.set_value("previs", "projector_beams", on)
	cfg.save(UI_CFG)
	changed.emit(on)


## The toolbar checkbox: "Projector beams", checked = the beams are drawn.
static func checkbox() -> CheckBox:
	var c := CheckBox.new()
	c.text = "Projector beams"
	c.tooltip_text = "The lines from each projector to the picture it throws, in the 3D views."
	c.button_pressed = shared().on
	c.toggled.connect(func(v: bool) -> void: shared().set_on(v))
	return c
