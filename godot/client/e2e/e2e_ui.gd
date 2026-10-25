extends RefCounted
## WO-719 — the GUI driver for end-to-end scenarios. It acts like an operator: clicks are real mouse events pushed
## into the viewport at the control's centre, typing is real key events, drags are press → motion → release. Each
## click is hit-tested first, so a button that is hidden, disabled or covered by something else FAILS (a user could
## not press it either). Finders match a control's text or tooltip, so scenarios read like the UI reads.

var tree: SceneTree
var root: Node  ## main.gd (has `shell`)
var shots_dir := ""
var _shot_n := 0


func _init(t: SceneTree, main: Node, out_dir: String) -> void:
	tree = t
	root = main
	shots_dir = out_dir


func vp() -> Viewport:
	return root.get_viewport()


func frames(n := 2) -> void:
	for i in n:
		await tree.process_frame


func sleep(s: float) -> void:
	await tree.create_timer(s).timeout


## Poll `cond` every frame until it is truthy or `timeout_s` runs out. Returns the last value (falsy = timed out).
func wait_for(cond: Callable, timeout_s := 8.0) -> Variant:
	var until := Time.get_ticks_msec() + int(timeout_s * 1000.0)
	var v: Variant = cond.call()
	while not v and Time.get_ticks_msec() < until:
		await tree.process_frame
		v = cond.call()
	return v


# ---------------------------------------------------------------- finders

func shown(c: Node) -> bool:
	if not (c is Control) or not (c as Control).is_visible_in_tree():
		return false
	var w := c.get_viewport()
	if w is Window and not (w as Window).visible:
		return false
	var r := screen_rect(c)
	return r.size.x > 0.5 and r.size.y > 0.5 and Rect2(Vector2.ZERO, vp().get_visible_rect().size).intersects(r)


## The control's rect in root-viewport pixels (what push_input with local coords expects). Controls inside an
## embedded Window (dialogs, popups) are offset by the window's position — the root routes the click into it.
func screen_rect(c: Control) -> Rect2:
	var xf := c.get_global_transform_with_canvas()
	var r := Rect2(xf.origin, c.size * xf.get_scale())
	var v := c.get_viewport()
	while v is Window and v != tree.root:
		r.position += Vector2((v as Window).position)
		v = (v as Window).get_parent().get_viewport()
	return r


func all(cls: String, under: Node = null, only_shown := true) -> Array:
	var base: Node = under if under != null else root
	var out := []
	for n in base.find_children("*", cls, true, false):
		if not only_shown or shown(n):
			out.append(n)
	return out


static func label_of(c: Node) -> String:
	if c is Button or c is LineEdit or c is Label:
		return str(c.get("text")).strip_edges()
	return ""


## The first shown control of class `cls` whose text or tooltip equals `label` (or contains it, `exact` = false).
func find(cls: String, label: String, under: Node = null, exact := true) -> Control:
	for c in all(cls, under):
		var t := label_of(c)
		var tip := str((c as Control).tooltip_text).strip_edges()
		if tip == "" and c is LineEdit:
			tip = (c as LineEdit).placeholder_text.strip_edges()  # empty fields read by their hint
		if exact and (t == label or tip == label):
			return c
		if not exact and ((t != "" and t.contains(label)) or (tip != "" and tip.contains(label))):
			return c
	return null


## The input next to a caption Label (form rows: caption + control share a parent), e.g. field("Video mode").
func field(caption: String, cls := "Control", under: Node = null) -> Control:
	for l in all("Label", under):
		if (l as Label).text.strip_edges() != caption:
			continue
		for sib in l.get_parent().get_children():
			if sib != l and sib.is_class(cls) and shown(sib):
				return sib
			for inner in sib.find_children("*", cls, true, false):
				if inner != l and shown(inner):
					return inner
	return null


func button(label: String, under: Node = null, exact := true) -> BaseButton:
	return find("BaseButton", label, under, exact) as BaseButton


## Wait until a control appears (UI rebuilds after server round-trips), else null.
func await_control(cls: String, label: String, under: Node = null, timeout_s := 8.0, exact := true) -> Control:
	return await wait_for(func() -> Variant: return find(cls, label, under, exact), timeout_s)


func tab(name: String) -> Control:
	var tabs: TabContainer = root.shell.tabs
	var page: Control = tabs.get_node(name)
	var bar: TabBar = tabs.get_tab_bar()
	var idx := tabs.get_tab_idx_from_control(page)
	await click_at(screen_rect(bar).position + bar.get_tab_rect(idx).get_center() * bar.get_global_transform_with_canvas().get_scale())
	await frames(3)
	if tabs.current_tab != idx:
		push_error("[e2e] tab %s did not open on click" % name)
	return page


## Click the tab titled `title` on any shown TabBar except the workspace tabs (e.g. Sources → Media / Live).
func pick_tab(title: String) -> String:
	for tb in all("TabBar"):
		if tb == root.shell.tabs.get_tab_bar():
			continue
		for i in (tb as TabBar).tab_count:
			if (tb as TabBar).get_tab_title(i) == title:
				(tb as TabBar).ensure_tab_visible(i)  # what the strip's ‹ › arrows do when the tab is scrolled off
				await frames(2)
				var sc := (tb as TabBar).get_global_transform_with_canvas().get_scale()
				await click_at(screen_rect(tb).position + (tb as TabBar).get_tab_rect(i).get_center() * sc)
				await frames(2)
				return "" if (tb as TabBar).current_tab == i else "tab %s did not open" % title
	return "no %s tab" % title


# ---------------------------------------------------------------- actions

## Click a control like a user: move there, check it is what the pointer actually hovers, press, release.
## Returns "" on success, else why the click could not happen (scenarios turn that into a failed step).
func click(c: Control, double := false, button_index := MOUSE_BUTTON_LEFT) -> String:
	if c == null:
		return "control not found"
	if not shown(c):
		return "%s is not visible" % _desc(c)
	if c is BaseButton and (c as BaseButton).disabled:
		return "%s is disabled" % _desc(c)
	var why := await _hover(c)
	if why == "":
		await click_at(_at, double, button_index)
	return why


## Move the pointer onto `c`'s centre (→ _at) and hit-test it: "" or what covers it.
var _at := Vector2.ZERO
func _hover(c: Control) -> String:
	_at = screen_rect(c).get_center()
	_move(_at, 0)
	await frames(1)
	if not is_instance_valid(c):
		return "the control was freed under the pointer (a reload rebuilt it)"
	var hov := c.get_viewport().gui_get_hovered_control()
	if hov != null and hov != c and not c.is_ancestor_of(hov) and not hov.is_ancestor_of(c):
		return "%s is covered by %s" % [_desc(c), _desc(hov)]
	return ""


func click_at(p: Vector2, double := false, button_index := MOUSE_BUTTON_LEFT) -> void:
	_move(p, 0)
	await frames(1)
	for i in (2 if double else 1):
		_button(p, button_index, true, double and i == 1)
		await frames(1)
		_button(p, button_index, false, false)
		await frames(1)


## Focus a LineEdit / SpinBox field by clicking, select-all, type `text` key by key, then Enter (or Tab).
func type_into(c: Control, text: String, submit := true) -> String:
	var le: LineEdit = (c as SpinBox).get_line_edit() if c is SpinBox else c as LineEdit
	if le == null:
		return "%s is not a text field" % _desc(c)
	var why := await click(le)
	if why != "":
		return why
	_key(KEY_A, 0, true)
	_key(KEY_BACKSPACE)
	for ch in text:
		_key(KEY_NONE, ch.unicode_at(0))
		await frames(1)
	if submit:
		_key(KEY_ENTER)
	await frames(2)
	return ""


## Open an OptionButton by clicking it, then pick the item whose text is `label` from its popup.
func choose(ob: OptionButton, label: String, exact := true, while_open := Callable()) -> String:
	if ob == null:
		return "option button not found"
	var idx := -1
	for i in ob.item_count:
		var t := ob.get_item_text(i).strip_edges()
		if t == label or (not exact and t.contains(label)):
			idx = i
			break
	if idx < 0:
		return "%s has no item %s (items: %s)" % [_desc(ob), label, items(ob)]
	if not shown(ob) or ob.disabled:
		return "%s is not visible / enabled" % _desc(ob)
	var why := await _hover(ob)
	if why != "":
		return why
	# Press opens the popup (OptionButton acts on press). Releasing on the open popup would pick the row under the
	# pointer — the current one — so the release comes after the pick, like press-drag-release onto a row.
	_button(_at, MOUSE_BUTTON_LEFT, true, false)
	var pm := ob.get_popup()
	await wait_for(func() -> bool: return not is_instance_valid(pm) or pm.visible, 2.0)
	if not is_instance_valid(ob) or not is_instance_valid(pm) or not pm.visible:
		_button(_at, MOUSE_BUTTON_LEFT, false, false)
		return "%s: the popup never opened (or a reload replaced the page)" % label
	if while_open.is_valid():  # something that happens while the list is open (a reload pushed by the server…)
		await while_open.call()
		if not is_instance_valid(ob) or not is_instance_valid(pm) or not pm.visible:
			_button(_at, MOUSE_BUTTON_LEFT, false, false)
			return "%s: the open list was closed / freed by what happened while it was open" % label
	pm.index_pressed.emit(idx)  # what a click on the popup row does (the popup is a Window, not a Control)
	pm.hide()
	_button(_at, MOUSE_BUTTON_LEFT, false, false)
	await frames(2)
	if is_instance_valid(ob) and ob.selected != idx:
		ob.select(idx)
		ob.item_selected.emit(idx)
		await frames(2)
	return ""


static func items(ob: OptionButton) -> Array:
	var out := []
	for i in ob.item_count:
		out.append(ob.get_item_text(i))
	return out


## Drag `from` onto `to` with the left button held (Godot starts a GUI drag past its threshold).
func drag(from: Control, to: Control) -> String:
	if from == null or not shown(from):
		return "drag source %s is not visible" % _desc(from)
	return await drag_from(screen_rect(from).get_center(), to)


## A Tree row whose first-column text equals (or contains) `text`, searched depth-first; expands nothing.
static func tree_item(tree: Tree, text: String, exact := false) -> TreeItem:
	var stack: Array = [tree.get_root()] if tree.get_root() != null else []
	while not stack.is_empty():
		var it: TreeItem = stack.pop_back()
		var t := it.get_text(0).strip_edges()
		if it != tree.get_root() and (t == text or (not exact and t.contains(text))):
			return it
		var kids := it.get_children()
		kids.reverse()
		stack.append_array(kids)
	return null


## Where a Tree row sits, in root-viewport pixels (scrolls it into view first).
func tree_item_point(tree: Tree, it: TreeItem) -> Vector2:
	tree.scroll_to_item(it)
	var area := tree.get_item_area_rect(it, 0)
	var r := screen_rect(tree)
	var sc := tree.get_global_transform_with_canvas().get_scale()
	return r.position + (area.position - tree.get_scroll() + area.size * 0.5) * sc


## Drag from a point (e.g. a Tree row) onto a control.
func drag_from(a: Vector2, to: Control) -> String:
	if to == null or not shown(to):
		return "drop target %s is not visible" % _desc(to)
	var b := screen_rect(to).get_center()
	_move(a, 0)
	await frames(1)
	_button(a, MOUSE_BUTTON_LEFT, true, false)
	await frames(1)
	for i in range(1, 13):
		_move(a.lerp(b, i / 12.0), MOUSE_BUTTON_MASK_LEFT)
		await frames(1)
	await frames(2)
	var dragging := vp().gui_is_dragging()
	_button(b, MOUSE_BUTTON_LEFT, false, false)
	await frames(3)
	return "" if dragging else "no drag started from %s (nothing draggable under the press?)" % a


func shot(label: String) -> String:
	if shots_dir == "":
		return ""
	await RenderingServer.frame_post_draw
	_shot_n += 1
	var path := "%s/%02d_%s.png" % [shots_dir, _shot_n, label.to_snake_case().replace("/", "_").left(48)]
	var img := vp().get_texture().get_image()
	if img != null:
		img.save_png(path)
	return path


# ---------------------------------------------------------------- raw input

var _last := Vector2.ZERO


func _move(p: Vector2, mask: int) -> void:
	var m := InputEventMouseMotion.new()
	m.position = p
	m.global_position = p
	m.relative = p - _last  # the viewport starts a GUI drag on accumulated `relative`, not on position
	m.screen_relative = m.relative
	m.button_mask = mask
	_last = p
	Input.warp_mouse(p)  # WO-762: drop positions read the real pointer (the hidden Xvfb one), not the pushed event
	vp().push_input(m, true)


func _button(p: Vector2, idx: int, pressed: bool, double: bool) -> void:
	var e := InputEventMouseButton.new()
	e.position = p
	e.global_position = p
	e.button_index = idx
	e.pressed = pressed
	e.double_click = double
	e.button_mask = (1 << (idx - 1)) if pressed else 0
	vp().push_input(e, true)


func _key(code: Key, unicode := 0, ctrl := false) -> void:
	for pressed in [true, false]:
		var e := InputEventKey.new()
		e.keycode = code
		e.physical_keycode = code
		e.unicode = unicode
		e.ctrl_pressed = ctrl
		e.pressed = pressed
		vp().push_input(e, true)


static func _desc(c: Node) -> String:
	if c == null:
		return "<null>"
	var t := label_of(c)
	if t == "" and c is Control:
		t = str((c as Control).tooltip_text)
	return "%s%s" % [c.get_class(), " \"%s\"" % t.left(40) if t != "" else " (%s)" % c.name]
