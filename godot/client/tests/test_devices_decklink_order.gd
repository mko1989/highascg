extends RefCounted
## WO-605 slice 9a — decklink_order.gd against the web's DeckLink rear order: orderDecklinkConnectors, the rear-panel
## markers' default order (buildCasparRearMarkerLayoutItems) and the inspector rear-order editor
## (device-view-inspector-decklink-rear-order.js) run under Node on the DOM shim with a fake localStorage:
## tests/golden/devices_decklink_order.json. Editor steps: the rows (Slot N / label / id), Save, Export (file name +
## text), Load (array / {decklinkRearOrder} / {connectorIds} / other / invalid JSON / no file), Reset (confirm).
## Where nothing is saved the web lists / saves / exports the unsorted order while its panel shows the default; here
## the editor follows the panel (decklink_order.gd header), so those rows are the web's rows in display() order.

const DO := preload("res://features/devices/decklink_order.gd")
var t
var _g: Dictionary


func _golden() -> Dictionary:
	if _g.is_empty():
		_g = JSON.parse_string(FileAccess.get_file_as_string("res://tests/golden/devices_decklink_order.json"))
	return _g


static func _item(id: String) -> Dictionary:
	return {"id": id}


func test_order() -> void:
	for c in _golden().order:
		var items: Array = c.merged.map(_item)
		t.eq(DO.ids(DO.order(items, c.saved.map(func(x: Variant) -> String: return DO._js(x)))), c.ids, c.name)


func test_display() -> void:
	for c in _golden().display:
		var got := DO.ids(DO.display(c.items, c.persisted))
		var want: Array = []
		for id in c.ids:  # the web draws a twice-picked port twice; here once
			if not want.has(id):
				want.append(id)
		t.eq(got, want, c.name)


## [Slot N, label, id] for the rows the editor shows.
static func _rows(items: Array) -> Array:
	var out := []
	for i in items.size():
		var c: Dictionary = items[i]
		out.append(["Slot %d" % (i + 1), str(c.label) if str(c.get("label", "")) != "" else str(c.id), str(c.id)])
	return out


static func _reorder(web_rows: Array, merged: Array) -> Array:
	var by := {}
	for c in merged:
		by[str(c.id)] = c
	return _rows(DO.display(web_rows.map(func(r: Array) -> Dictionary: return by[r[2]]), false))


func test_editor_replay() -> void:
	var merged := DO.merged(_golden().payload)
	t.eq(DO.ids(merged), ["dlsdi_1", "dlsdi_2", "dlsdi_3", "dlsdi_4", "dlo_x"], "merged: io then out, Caspar host only, deduped")
	for c in _golden().editor:
		var saved: Variant = c.init
		var rows := _rows(DO.current(merged, saved if saved is Array else []))
		t.eq(rows, c.rows if saved != null else _reorder(c.rows, merged), c.name + ": rows")
		for a in c.acts:
			var st: Dictionary = a.step
			var what := "%s: %s" % [c.name, JSON.stringify(st)]
			var shown := DO.ids(DO.current(merged, saved if saved is Array else []))
			var calls := []
			match str(st.button):
				"Save":
					saved = shown
					calls.append(["LOAD"])
				"Export":
					calls.append(["DOWNLOAD", DO.EXPORT_NAME, DO.export_text(shown)])
				"Load":
					if st.file != null:
						var p := DO.parse_file(st.file, merged)
						if p.ok:
							saved = p.ids
							calls.append(["LOAD"])
						else:
							calls.append(["ALERT", p.error])
				"Reset order":
					calls.append(["CONFIRM", DO.RESET_CONFIRM])
					if st.confirm:
						saved = null
						calls.append(["LOAD"])
			var web: Array = a.calls
			if c.init == null and str(st.button) in ["Save", "Export"] and _golden().editor[0] == c:
				# web Save / Export of the unsorted order; here the shown (default) order
				var want := DO.ids(DO.display(order_items(merged), false))
				t.eq(shown, want, what + ": shown = the default order")
				continue
			t.eq(calls.size(), web.size(), what + ": request count")
			for i in mini(calls.size(), web.size()):
				if calls[i][0] == "ALERT":
					t.eq(calls[i][1].begins_with("Invalid DeckLink order file: "), web[i][1].begins_with("Invalid DeckLink order file: "), what + ": alert")
				else:
					t.eq(calls[i], web[i], what + ": call %d" % i)
			t.eq(saved, a.saved, what + ": saved order")
			if saved != null:
				t.eq(_rows(DO.current(merged, saved)), a.rows, what + ": rows after")


static func order_items(merged: Array) -> Array:
	return DO.order(merged, [])


func test_move_swap() -> void:
	var l := ["a", "b", "c", "d"]
	t.eq(DO.move(l, 0, 1, true), ["b", "a", "c", "d"], "drag one down (lower half) moves it — the web's list no-ops")
	t.eq(DO.move(l, 0, 1, false), ["a", "b", "c", "d"], "upper half of the next row = where it is")
	t.eq(DO.move(l, 3, 0, false), ["d", "a", "b", "c"], "to the top")
	t.eq(DO.move(l, 1, 3, true), ["a", "c", "d", "b"], "to the end")
	t.eq(DO.swap(l, "a", "d"), ["d", "b", "c", "a"], "rear-panel drop swaps")
	t.eq(DO.swap(l, "a", "x"), l, "unknown id: unchanged")
	t.eq(DO.parse_file("[1, 2.5, null]", [_item("1")]).ids, ["1"], "numbers become ids like String(x)")
