extends RefCounted
## WO-963 — a mixer-effect slider survives the server's stale deck-scene echo: the section keeps its own state while
## a slider is held (and briefly after an edit), shows another layer at once, and param_field reports slider grabs.

const Section := preload("res://features/live/effects_section.gd")
const F := preload("res://features/live/param_field.gd")
const REG := [{"type": "brightness", "label": "Brightness", "defaults": {"value": 1.0},
	"schema": [{"key": "value", "label": "Brightness", "type": "float", "min": 0.0, "max": 2.0, "step": 0.01, "default": 1.0, "slider": true}]}]
var t


func _section(effects: Array) -> Node:
	var s := Section.new()
	s._ready()  # built outside the tree: the cards exist without waiting for the frame
	s.set_registry(REG)
	s.show_effects(effects, Vector2i(1280, 720), "look/1/10")
	return s


func _fx(v: float) -> Array:
	return [{"type": "brightness", "params": {"value": v}}]


func _slider(s: Node) -> HSlider:
	var found: Array = s.find_children("*", "HSlider", true, false)
	return found[0] if not found.is_empty() else null


func test_stale_echo_does_not_rebuild_while_held() -> void:
	var s := _section(_fx(1.0))
	s._set_param(0, "value", 0.11)
	t.ok(s.is_holding(), "an edit holds the section")
	var before: int = s._list.get_child_count()
	var card: Node = s._list.get_child(0) if before > 0 else null
	s.show_effects(_fx(0.04), Vector2i(1280, 720), "look/1/10")  # stale echo of the same layer
	t.eq(s._effects[0].params.value, 0.11, "the stale echo did not overwrite our value")
	t.ok(s._list.get_child(0) == card if before > 0 else true, "the cards were not rebuilt")
	s.show_effects(_fx(0.04), Vector2i.ZERO, "")  # a content-resolution refresh (no key) is the same layer
	t.eq(s._effects[0].params.value, 0.11, "an unkeyed refresh is held too")
	s.free()


func test_other_layer_always_shows() -> void:
	var s := _section(_fx(1.0))
	s._set_param(0, "value", 0.5)
	s.show_effects(_fx(0.9), Vector2i(1280, 720), "look/1/20")
	t.eq(s._effects[0].params.value, 0.9, "another layer replaces the held state")
	s.free()


func test_held_slider_blocks_until_released() -> void:
	var s := _section(_fx(1.0))
	s._on_drag(true)
	s._hold_until = 0
	t.ok(s.is_holding(), "a grabbed slider holds with no time left")
	s.show_effects(_fx(0.3), Vector2i(1280, 720), "look/1/10")
	t.eq(s._effects[0].params.value, 1.0, "no rebuild while grabbed")
	s._on_drag(false)
	s._hold_until = 0
	s.show_effects(_fx(0.3), Vector2i(1280, 720), "look/1/10")
	t.eq(s._effects[0].params.value, 0.3, "after the hold the document is followed again")
	s.free()


func test_param_field_reports_slider_grabs() -> void:
	var log := []
	var row := F.control(REG[0].schema[0], 1.0, func(_v: Variant) -> void: pass, 0, func(on: bool) -> void: log.append(on))
	var sl: HSlider = row.get_child(0)
	sl.drag_started.emit()
	sl.drag_ended.emit(true)
	t.eq(log, [true, false], "grab then release reported")
	var plain := F.control(REG[0].schema[0], 1.0, func(_v: Variant) -> void: pass)  # old call shape still works
	t.ok(plain is HBoxContainer, "API unchanged without on_drag")
	row.free()
	plain.free()
