extends RefCounted
## WO-1018 — the Devices tab's separate scroll areas (destinations column, mapping nodes, rear panels + servers). Pure
## helpers plus the wheel step; the tab hands the wheel here before the GUI so a Panel under the pointer cannot eat it.

const STEP := 64.0  # px per wheel notch


## A point is clipped when it lies outside the visible rect of any scroll area that holds it (a port scrolled out of
## view: its cable hides and its dot takes no click). `rects` = the scroll areas' global rects that are ancestors.
static func clipped(point: Vector2, rects: Array) -> bool:
	for r in rects:
		if r is Rect2 and not (r as Rect2).has_point(point):
			return true
	return false


## The global rects of every ScrollContainer above `c` (nearest first).
static func scroll_rects(c: Control) -> Array:
	var out := []
	var n: Node = c.get_parent()
	while n != null:
		if n is ScrollContainer:
			out.append((n as ScrollContainer).get_global_rect())
		n = n.get_parent()
	return out


## True when the control's centre is scrolled out of any ancestor scroll area.
static func control_clipped(c: Control) -> bool:
	return clipped(c.get_global_rect().get_center(), scroll_rects(c))


## Wheel button → scroll delta in px (0 for any other button).
static func wheel_delta(button: int, factor: float) -> float:
	var f := maxf(factor, 1.0)
	if button == MOUSE_BUTTON_WHEEL_DOWN:
		return STEP * f
	if button == MOUSE_BUTTON_WHEEL_UP:
		return -STEP * f
	return 0.0


## The scroll offset after `delta`, kept inside [0, max_scroll].
static func scrolled(current: float, delta: float, max_scroll: float) -> float:
	return clampf(current + delta, 0.0, maxf(max_scroll, 0.0))


## The first of `areas` (ScrollContainers) whose rect holds `pos` and that has somewhere to scroll; null otherwise.
static func area_at(areas: Array, pos: Vector2) -> ScrollContainer:
	for a in areas:
		var sc := a as ScrollContainer
		if sc != null and sc.is_visible_in_tree() and sc.get_global_rect().has_point(pos):
			return sc if sc.get_v_scroll_bar().max_value > sc.get_v_scroll_bar().page + 0.5 else null
	return null


## Handle a wheel event over `areas`: scrolls that one area only and says whether it consumed the event.
static func wheel(areas: Array, event: InputEvent) -> bool:
	var mb := event as InputEventMouseButton
	if mb == null or not mb.pressed or wheel_delta(mb.button_index, mb.factor) == 0.0:
		return false
	var sc := area_at(areas, mb.global_position)
	if sc == null:
		return false
	var bar := sc.get_v_scroll_bar()
	sc.scroll_vertical = int(scrolled(sc.scroll_vertical, wheel_delta(mb.button_index, mb.factor), bar.max_value - bar.page))
	return true
