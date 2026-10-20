extends RefCounted
## WO-608 R2 / WO-603 slice 6 — the Inspector column: one page at a time; releasing a page that covered another
## still-selected page shows that page again (a look layer comes back when a second media file is ctrl-clicked, so
## its playlist drop zone is reachable for the multi-drag); a page its owner released never comes back.

const InspectorPanel := preload("res://app/inspector_panel.gd")
var t


func _panel() -> Array:
	var p: Control = InspectorPanel.new()
	p._ready()
	var layer := Control.new()
	var media := Control.new()
	return [p, layer, media]


func test_release_shows_the_covered_page() -> void:
	var a := _panel()
	var p: Control = a[0]
	p.present(a[1])
	p.present(a[2])
	t.ok(p.showing(a[2]) and not p.showing(a[1]), "the media page covers the layer page")
	p.release(a[2])
	t.ok(p.showing(a[1]), "the layer page is back")
	t.ok(not p._empty.visible, "not 'Select an item'")
	p.free()


func test_a_released_page_stays_gone() -> void:
	var a := _panel()
	var p: Control = a[0]
	p.present(a[1])
	p.present(a[2])
	p.release(a[1])  # the look editor closed while the media page was up
	p.release(a[2])
	t.ok(not p.showing(a[1]), "the closed editor's page is not resurrected")
	t.ok(p._empty.visible, "empty state")
	p.present(a[1])
	t.ok(p.showing(a[1]), "presenting again clears the released mark")
	p.free()


func test_releasing_a_hidden_page_changes_nothing() -> void:
	var a := _panel()
	var p: Control = a[0]
	p.present(a[1])
	p.present(a[2])
	p.release(a[1])
	t.ok(p.showing(a[2]), "the shown page stays")
	p.free()
