extends HBoxContainer
## WO-1029 — the header side of the remote client's handover (RULES.md "Linked servers" 6, rule 5): the persistent amber
## "on ‹new› — handed over from ‹old› hh:mm" until dismissed, and the offer when the box is silent from here but its linked
## servers do not confirm it is gone ("‹box› is not answering from here — continue on ‹other›?", one click or Enter).
## Empty (and invisible) on the on-box client and whenever nothing happened. app/handover_watch.gd decides.

const ThemeBuilder := preload("res://app/theme_builder.gd")

var watch: Node
var _cue: Label
var _dismiss: Button
var _offer: Label
var _go: Button
var _later: Button


func _init(w: Node = null) -> void:
	watch = w


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	_cue = Label.new()
	_cue.add_theme_color_override("font_color", ThemeBuilder.WARN)
	_cue.add_theme_font_size_override("font_size", 12)
	add_child(_cue)
	_dismiss = _button("×", "Dismiss this cue")
	_dismiss.pressed.connect(func() -> void: watch.dismiss_cue())
	_offer = Label.new()
	_offer.add_theme_color_override("font_color", ThemeBuilder.WARN)
	_offer.add_theme_font_size_override("font_size", 12)
	_offer.clip_text = true
	_offer.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
	_offer.custom_minimum_size.x = 120
	add_child(_offer)
	_go = _button("Continue", "Move this client to the other server (Enter)")
	_go.pressed.connect(func() -> void: watch.accept_offer())
	_later = _button("Not now", "Stay and keep trying this server")
	_later.pressed.connect(func() -> void: watch.snooze_offer())
	if watch != null:
		watch.changed.connect(_refresh)
	_refresh()


func _button(text: String, tip: String) -> Button:
	var b := Button.new()
	b.text = text
	b.tooltip_text = tip
	b.focus_mode = Control.FOCUS_NONE
	add_child(b)
	return b


func _refresh() -> void:
	var text: String = watch.cue() if watch != null else ""
	var waiting: bool = watch != null and bool(watch.decision.waiting)
	if waiting:
		text = (text + " · " if text != "" else "") + str(watch.decision.cue)
	_cue.text = text
	_cue.tooltip_text = text
	_cue.visible = text != ""
	_dismiss.visible = text != "" and not waiting
	var offer: bool = watch != null and watch.offer_visible()
	_offer.visible = offer
	_go.visible = offer
	_later.visible = offer
	if offer:
		_offer.text = str(watch.decision.cue)
		_offer.tooltip_text = _offer.text
	visible = _cue.visible or offer
