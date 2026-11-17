extends RefCounted
## Owner 17.11.26: opening the LTC fold in the Audio tab widened the window and pushed the Inspector and the header's
## connection eyes off the screen. The fold's layout helper (features/audio/ltc_fold_fit.gd) keeps it narrow: pickers
## and text fields clip, the header clips, and LTC out / LTC in sit in a flow (its minimum = the wider form, not both).

const Fit := preload("res://features/audio/ltc_fold_fit.gd")
const LONG := "plughw:CARD=SomeVeryLongUsbAudioInterfaceName,DEV=0 (not connected) — Scarlett 18i20 USB Audio, 18 channels"
const LABEL_W := 280.0
var t


## One settings-form-like column: a heading, a label + picker row, a label + text row, a status label.
func _form(heading: String) -> VBoxContainer:
	var f := VBoxContainer.new()
	f.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var h := Label.new()
	h.text = heading + " " + LONG
	f.add_child(h)
	var row := HBoxContainer.new()
	var l := Label.new()
	l.text = "Device"
	l.custom_minimum_size.x = LABEL_W
	row.add_child(l)
	var ob := OptionButton.new()
	ob.add_item("None")
	ob.add_item(LONG)
	row.add_child(ob)
	f.add_child(row)
	var row2 := HBoxContainer.new()
	var le := LineEdit.new()
	le.text = LONG
	le.custom_minimum_size.x = 320  # settings_form.gd text()
	row2.add_child(le)
	f.add_child(row2)
	return f


func test_fit_caps_pickers_fields_and_headings() -> void:
	var raw := _form("LTC out")  # a fresh copy: outside the tree a measured Control keeps its cached minimum size
	var before := raw.get_combined_minimum_size().x
	raw.free()
	var f := _form("LTC out")
	t.ok(before > LABEL_W + 400.0, "unfitted, the long device name widens the form (%d px)" % before)
	Fit.fit(f)
	var after := f.get_combined_minimum_size().x
	t.ok(after <= LABEL_W + Fit.PICKER_MIN + 40.0, "fitted, the form asks for the label + the picker minimum only (%d px)" % after)
	var ob: OptionButton = f.get_child(1).get_child(1)
	t.eq(ob.fit_to_longest_item, false, "the picker does not size to its longest item")
	t.eq(ob.clip_text, true, "the picker clips its text")
	t.eq((f.get_child(0) as Label).clip_text, true, "a heading / status line clips")
	t.eq((f.get_child(1).get_child(0) as Label).clip_text, false, "a fixed-width row label is left alone")
	f.free()


func test_body_flow_min_is_the_wider_form_not_both() -> void:
	var b := Fit.body()
	var out := _form("LTC out")
	var inn := _form("LTC in")
	b.add_child(out)
	b.add_child(inn)
	Fit.fit(b)
	var one := maxf(out.get_combined_minimum_size().x, inn.get_combined_minimum_size().x)
	var both := out.get_combined_minimum_size().x + inn.get_combined_minimum_size().x
	var bm := b.get_combined_minimum_size().x
	t.ok(bm < both, "the flow does not demand both forms side by side (%d < %d)" % [bm, both])
	t.ok(bm <= one + 1.0, "its minimum is the wider form (%d ≤ %d)" % [bm, one])
	b.free()


func test_head_clips_a_long_status_line() -> void:
	var raw := Button.new()
	raw.text = "▾ LTC — " + LONG + " · " + LONG
	var before := raw.get_combined_minimum_size().x
	raw.free()
	var h := Button.new()
	Fit.head(h)  # as ltc_fold.gd: the helper first, the status text later (_show)
	h.text = "▾ LTC — " + LONG + " · " + LONG
	var after := h.get_combined_minimum_size().x
	t.ok(after < before / 4.0, "the header no longer asks for its text width (%d → %d)" % [before, after])
	h.free()
