extends RefCounted
## WO-836 Part 3c — the agent's EYES. The test driver (tools/test-agent/ui) does every input through the X server
## (xdotool on the test instance's Xvfb, like a human's hands); this class only LOOKS: it names every visible control
## by its label / tooltip / caption and says where it is on the SCREEN (X coordinates: window position + control rect,
## clipped by the scroll areas it sits in). A Haiku agent never guesses a pixel — it asks `list`, then clicks the label.
## Read-only by construction: nothing here pushes an input event or changes a control.

const UI := preload("res://e2e/e2e_ui.gd")

var ui: RefCounted
var tree: SceneTree

const KINDS := {
	"buttons": ["button", "toggle", "option"], "fields": ["field"], "tabs": ["tab"], "options": ["option"],
	"rows": ["row", "item"], "menu": ["menuitem"], "labels": ["label"], "controls": ["control"],
}


func _init(u: RefCounted) -> void:
	ui = u
	tree = u.tree


## Screen X coordinates of the client area's top-left (0,0 on the bare Xvfb the driver starts; no window manager).
func origin() -> Vector2:
	return Vector2(DisplayServer.window_get_position(0))


# ------------------------------------------------------------------ entries

func _clip(c: Control, r: Rect2) -> Rect2:
	var p := c.get_parent()
	while p != null and r.size.x > 0.0 and r.size.y > 0.0:
		if p is Window and p != tree.root:
			break  # an embedded dialog / popup is not clipped by whatever scroll area its parent node sits in
		if p is Control and ((p as Control).clip_contents or p is ScrollContainer):
			r = r.intersection(ui.screen_rect(p))
		p = p.get_parent()
	return r.intersection(Rect2(Vector2.ZERO, ui.vp().get_visible_rect().size)) if r.size.x > 0.0 else r


func _entry(kind: String, n: Node, label: String, r: Rect2, extra := {}) -> Dictionary:
	var shown_r := _clip(n as Control, r) if n is Control else r
	if shown_r.size.x < 1.0 or shown_r.size.y < 1.0:
		return {}
	var o := origin()
	var tip := str((n as Control).tooltip_text).strip_edges() if n is Control else ""
	var e := {"kind": kind, "cls": n.get_class(), "label": label, "tip": tip,
		"x": int(shown_r.position.x + o.x), "y": int(shown_r.position.y + o.y), "w": int(shown_r.size.x), "h": int(shown_r.size.y),
		"cx": int(shown_r.get_center().x + o.x), "cy": int(shown_r.get_center().y + o.y),
		"path": str(n.get_path()), "enabled": true}
	if n is BaseButton:
		e["enabled"] = not (n as BaseButton).disabled
	e.merge(extra, true)
	return e


## The text a form caption gives a field: the nearest Label before it among the siblings (up to two levels up).
func caption_of(n: Control) -> String:
	var cur: Node = n
	for _lvl in 3:
		var par := cur.get_parent()
		if par == null:
			break
		var best := ""
		for sib in par.get_children():
			if sib == cur:
				break
			if sib is Label and ui.shown(sib) and (sib as Label).text.strip_edges() != "":
				best = (sib as Label).text.strip_edges()
		if best != "":
			return best
		cur = par
	return ""


## Every descendant of `base` that is_class(cls), INTERNAL children included — Node.find_children skips them, and that
## is where a dialog keeps its OK / Cancel buttons.
static func nodes_of(base: Node, cls: String) -> Array:
	var out := []
	var stack: Array = [base]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n != base and n.is_class(cls):
			out.append(n)
		var kids := n.get_children(true)
		kids.reverse()
		stack.append_array(kids)
	return out


static func _named(base: Node, nm: String) -> Node:
	var stack: Array = [base]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		if n.name == nm:
			return n
		stack.append_array(n.get_children(true))
	return null


func _controls(base: Node) -> Array:
	return nodes_of(base, "Control")


## Every named, visible thing on screen under `base` (default: the whole scene tree), in reading order.
func entries(base: Node = null, with_labels := true) -> Array:
	var b: Node = base if base != null else tree.root
	var out := []
	for n in _controls(b):
		if not ui.shown(n):
			continue
		var c := n as Control
		if c.get_parent() is SpinBox:
			continue  # the spin's own line edit: the SpinBox entry stands for it
		if c is SpinBox or c is LineEdit or c is TextEdit:
			var cap := caption_of(c)
			var ph := ""
			var txt := ""
			if c is SpinBox:
				txt = str((c as SpinBox).value)
			elif c is LineEdit:
				ph = (c as LineEdit).placeholder_text
				txt = (c as LineEdit).text
			else:
				ph = (c as TextEdit).placeholder_text
				txt = (c as TextEdit).text.left(80)
			var lab := ph if ph != "" else (cap if cap != "" else c.tooltip_text)
			var ed := true
			if c is LineEdit:
				ed = (c as LineEdit).editable
			_push(out, _entry("field", c, lab, ui.screen_rect(c), {"caption": cap, "placeholder": ph, "text": txt, "editable": ed}))
		elif c is OptionButton:
			var ob := c as OptionButton
			_push(out, _entry("option", c, ob.text.strip_edges() if ob.text != "" else c.tooltip_text, ui.screen_rect(c),
				{"caption": caption_of(c), "items": UI.items(ob), "selected": ob.selected, "enabled": not ob.disabled}))
		elif c is BaseButton:
			var bb := c as BaseButton
			var t := UI.label_of(c)
			var tg := bb.toggle_mode or c is CheckBox or c is CheckButton
			_push(out, _entry("toggle" if tg else "button", c, t if t != "" else bb.tooltip_text.strip_edges(), ui.screen_rect(c),
				{"pressed": bb.button_pressed} if tg else {}))
		elif c is TabBar:
			_push_all(out, _tabs(c as TabBar))
		elif c is Tree:
			_push_all(out, _rows(c as Tree))
		elif c is ItemList:
			_push_all(out, _items(c as ItemList))
		elif c is Label or c is RichTextLabel:
			var lt := (c as Label).text.strip_edges() if c is Label else (c as RichTextLabel).get_parsed_text().strip_edges()
			if with_labels and lt != "":
				_push(out, _entry("label", c, lt.left(120), ui.screen_rect(c)))
			elif c.tooltip_text != "" and c.mouse_filter != Control.MOUSE_FILTER_IGNORE:
				_push(out, _entry("control", c, "", ui.screen_rect(c)))
		elif c.tooltip_text.strip_edges() != "" and c.mouse_filter != Control.MOUSE_FILTER_IGNORE:
			_push(out, _entry("control", c, "", ui.screen_rect(c)))
	for pm in nodes_of(tree.root, "PopupMenu"):
		if (pm as PopupMenu).visible and (base == null or base.is_ancestor_of(pm) or base == pm):
			_push_all(out, _menu_items(pm as PopupMenu))
	out.sort_custom(func(a: Dictionary, z: Dictionary) -> bool:
		return a.cy < z.cy or (a.cy == z.cy and a.cx < z.cx))
	return out


## Rows of an open popup / right-click menu. PopupMenu has no item-rect API, so `at` is an ESTIMATE (rows share the
## height, separators count 0.4); the driver nudges the real pointer until the popup says that row is focused.
func _menu_items(pm: PopupMenu) -> Array:
	var out := []
	var o := origin()
	var weights: Array[float] = []
	var total := 0.0
	for i in pm.item_count:
		var wgt := 0.4 if pm.is_item_separator(i) else 1.0
		weights.append(wgt)
		total += wgt
	var acc := 0.0
	for i in pm.item_count:
		var cy: float = float(pm.position.y) + float(pm.size.y) * (acc + weights[i] * 0.5) / maxf(total, 1.0)
		acc += weights[i]
		var txt := pm.get_item_text(i).strip_edges()
		if pm.is_item_separator(i) or txt == "":
			continue
		var r := Rect2(Vector2(pm.position) + Vector2(0, cy - float(pm.position.y) - 8.0), Vector2(pm.size.x, 16))
		var e := _entry("menuitem", pm, txt, r, {"idx": i, "enabled": not pm.is_item_disabled(i), "checked": pm.is_item_checked(i),
			"row_h": float(pm.size.y) / maxf(total, 1.0), "popup_x": int(pm.position.x + o.x), "popup_w": pm.size.x})
		if not e.is_empty():
			e["cx"] = int(pm.position.x + o.x + pm.size.x * 0.5)
			e["cy"] = int(cy + o.y)
			out.append(e)
	return out


func _push(out: Array, e: Dictionary) -> void:
	if not e.is_empty():
		out.append(e)


func _push_all(out: Array, es: Array) -> void:
	for e in es:
		_push(out, e)


func _tabs(tb: TabBar) -> Array:
	var out := []
	var sc := tb.get_global_transform_with_canvas().get_scale()
	var base: Rect2 = ui.screen_rect(tb)
	for i in tb.tab_count:
		if tb.is_tab_hidden(i):
			continue
		var lr := tb.get_tab_rect(i)
		var r := Rect2(base.position + lr.position * sc, lr.size * sc)
		out.append(_entry("tab", tb, tb.get_tab_title(i), r, {"idx": i, "selected": tb.current_tab == i, "enabled": not tb.is_tab_disabled(i),
			"tip": tb.get_tab_tooltip(i)}))
	return out


func _rows(t: Tree) -> Array:
	var out := []
	if t.get_root() == null:
		return out
	var sc := t.get_global_transform_with_canvas().get_scale()
	var base: Rect2 = ui.screen_rect(t)
	var stack: Array = []
	if t.hide_root:
		var kids := t.get_root().get_children()
		kids.reverse()
		stack.append_array(kids)
	else:
		stack.append(t.get_root())
	var n := 0
	while not stack.is_empty() and n < 4000:
		n += 1
		var it: TreeItem = stack.pop_back()
		var area := t.get_item_area_rect(it, 0)
		var r := Rect2(base.position + (area.position - t.get_scroll()) * sc, area.size * sc)
		var texts := PackedStringArray()
		for col in t.columns:
			var s := it.get_text(col).strip_edges()
			if s != "":
				texts.append(s)
		if not texts.is_empty():
			var c0 := it.get_text(0).strip_edges()
			var vis := _clip(t, r)
			# column headers sit on top of the rows: a row under them is not visible
			var head := 0.0
			if t.column_titles_visible:
				head = t.get_theme_font("title_button_font").get_height(t.get_theme_font_size("title_button_font_size")) + 8.0
			if vis.size.y > 4.0 and vis.get_center().y > base.position.y + head:
				out.append(_entry("row", t, c0 if c0 != "" else texts[0], r, {"cols": Array(texts), "collapsed": it.collapsed,
					"depth": _depth(it), "tip": it.get_tooltip_text(0)}))
		if not it.collapsed:
			var ch := it.get_children()
			ch.reverse()
			stack.append_array(ch)
	return out


static func _depth(it: TreeItem) -> int:
	var d := 0
	var p := it.get_parent()
	while p != null:
		d += 1
		p = p.get_parent()
	return d


func _items(il: ItemList) -> Array:
	var out := []
	var base: Rect2 = ui.screen_rect(il)
	for i in il.item_count:
		var lr := il.get_item_rect(i, true)
		var r := Rect2(base.position + lr.position, lr.size)
		var txt := il.get_item_text(i).strip_edges()
		if txt != "":
			out.append(_entry("item", il, txt, r, {"idx": i, "selected": il.is_selected(i), "enabled": not il.is_item_disabled(i)}))
	return out


# ------------------------------------------------------------------ matching

static func names_of(e: Dictionary) -> Array:
	var out := []
	for k in ["label", "tip", "caption", "placeholder"]:
		var s := str(e.get(k, "")).strip_edges()
		if s != "" and not out.has(s):
			out.append(s)
	return out


## "Filter..." (typed by an agent) is "Filter…" in the UI; compare them as the same.
static func _norm(s: String) -> String:
	return s.strip_edges().replace("...", "…").replace("\u00a0", " ")


static func matches(e: Dictionary, label: String, contains: bool) -> bool:
	var want := _norm(label)
	for s in names_of(e):
		var n := _norm(s)
		if n == want or (contains and n.to_lower().contains(want.to_lower())):
			return true
	return false


## The labels nearest to `label` (for the "no visible Button labelled …" error): substring either way, then shared words.
static func closest(es: Array, label: String, n := 5) -> Array:
	var want := label.to_lower()
	var words := want.split(" ", false)
	var scored := []
	for e in es:
		for s in names_of(e):
			var l := (s as String).to_lower()
			var sc := 0
			if l.contains(want) or (l != "" and want.contains(l)):
				sc = 100
			else:
				for w in words:
					if w.length() > 1 and l.contains(w):
						sc += 10
			if sc > 0:
				scored.append([sc, s])
	scored.sort_custom(func(a: Array, z: Array) -> bool: return a[0] > z[0])
	var out := []
	for sr in scored:
		if not out.has(sr[1]):
			out.append(sr[1])
		if out.size() >= n:
			break
	return out


func kind_ok(e: Dictionary, kind: String) -> bool:
	if kind == "" or kind == "any" or kind == "all":
		return true
	if KINDS.has(kind):
		return (KINDS[kind] as Array).has(e.kind)
	return e.kind == kind


## Resolve `--under X`: a workspace tab / TabContainer page called X, a control whose tooltip is X, the section a
## heading Label X heads (its parent), a node named X, or a node path.
func resolve_under(name: String) -> Node:
	if name == "":
		return null
	if name.begins_with("/"):
		return tree.root.get_node_or_null(name)
	for tc in nodes_of(tree.root, "TabContainer"):
		for i in (tc as TabContainer).get_tab_count():
			if (tc as TabContainer).get_tab_title(i) == name:
				return (tc as TabContainer).get_tab_control(i)
	for c in _controls(tree.root):
		if not ui.shown(c):
			continue
		if (c as Control).tooltip_text.strip_edges() == name and not (c is BaseButton):
			return c
	for c in nodes_of(tree.root, "Label"):
		if ui.shown(c) and (c as Label).text.strip_edges() == name and c.get_parent() != null:
			return c.get_parent()
	return _named(tree.root, name)


## Find entries by label. → {ok, matches[], error?}. `scoped` = {under, kind, contains, enabled_first}.
func find(label: String, opts := {}) -> Dictionary:
	var base: Node = null
	var under := str(opts.get("under", ""))
	if under != "":
		base = resolve_under(under)
		if base == null:
			return {"ok": false, "error": "no container labelled '%s' (a tab title, a section heading, a tooltip or a node name)" % under}
	var kind := str(opts.get("kind", ""))
	var contains := bool(opts.get("contains", false))
	var all_e := entries(base)
	var hits := []
	for e in all_e:
		if kind_ok(e, kind) and matches(e, label, contains):
			hits.append(e)
	if hits.is_empty():
		var pool := all_e.filter(func(e: Dictionary) -> bool: return kind_ok(e, kind))
		var cl := closest(pool, label)
		var what := kind if kind not in ["", "any", "all"] else "control"
		return {"ok": false, "error": "no visible %s labelled '%s'%s%s" % [what.capitalize() if what != "control" else "control", label,
			" under '%s'" % under if under != "" else "", " — closest: " + ", ".join(cl.map(func(s: String) -> String: return "'%s'" % s)) if not cl.is_empty()
			else " — nothing similar on screen (run `ui list` to see what is there)"]}
	# enabled controls first, then reading order
	# pressable things first (enabled, not a plain caption), then the rest; reading order inside each group
	var rank := func(e: Dictionary) -> int: return (0 if e.enabled else 2) + (1 if e.kind == "label" else 0)
	var ordered := []
	for r in 4:
		for e in hits:
			if rank.call(e) == r:
				ordered.append(e)
	return {"ok": true, "matches": ordered}


# ------------------------------------------------------------------ state

func focus_desc() -> Dictionary:
	var f: Control = ui.vp().gui_get_focus_owner()
	if f == null:
		return {}
	return {"cls": f.get_class(), "label": UI.label_of(f) if UI.label_of(f) != "" else caption_of(f), "path": str(f.get_path()),
		"text": (f as LineEdit).text if f is LineEdit else ""}


func windows() -> Array:
	var out := []
	for w in nodes_of(tree.root, "Window"):
		var win := w as Window
		if not win.visible:
			continue
		var d := {"cls": win.get_class(), "title": win.title, "x": int(win.position.x + origin().x), "y": int(win.position.y + origin().y),
			"w": win.size.x, "h": win.size.y}
		if win is AcceptDialog:
			d["text"] = (win as AcceptDialog).dialog_text
			d["buttons"] = nodes_of(win, "Button").filter(func(b: Node) -> bool: return ui.shown(b)).map(
				func(b: Node) -> String: return UI.label_of(b))
		if win is PopupMenu:
			d["items"] = popup_items(win as PopupMenu)
		out.append(d)
	return out


func popup_items(pm: PopupMenu) -> Array:
	var out := []
	for i in pm.item_count:
		out.append({"idx": i, "text": pm.get_item_text(i), "separator": pm.is_item_separator(i), "disabled": pm.is_item_disabled(i),
			"checked": pm.is_item_checked(i)})
	return out


## The open popup list(s) with the row under the pointer and an ESTIMATE of each row's screen centre (PopupMenu has
## no item-rect API); the driver aims at the estimate and corrects with `focused` until it hovers the wanted row.
func popups() -> Array:
	var out := []
	var o := origin()
	for w in nodes_of(tree.root, "PopupMenu"):
		var pm := w as PopupMenu
		if not pm.visible:
			continue
		var n := maxi(pm.item_count, 1)
		out.append({"x": int(pm.position.x + o.x), "y": int(pm.position.y + o.y), "w": pm.size.x, "h": pm.size.y,
			"row_h": float(pm.size.y) / n, "focused": pm.get_focused_item(), "items": popup_items(pm)})
	return out


## Is `path` what the pointer is over right now (after the driver moved the real X pointer there)? → "" or what covers it.
func covered_by(path: String) -> String:
	var n := tree.root.get_node_or_null(path)
	if n == null or not (n is Control):
		return ""
	var hov := (n as Control).get_viewport().gui_get_hovered_control()
	if hov == null:
		return "nothing is under the pointer (is the window focused / the pointer inside it?)"
	if hov == n or n.is_ancestor_of(hov) or hov.is_ancestor_of(n):
		return ""
	return "%s is covered by %s" % [UI._desc(n), UI._desc(hov)]
