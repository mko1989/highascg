extends RefCounted
## WO-837 — the timeline's vertical layout, pure. The layer list is grouped into sections: the "all screens" layers
## first (no `screenIdx`), then one section per screen in `tl.screens` (a divider row, then that screen's layers).
## `tl.layers` keeps its order (Caspar layer 210 + index, z-order); the display only groups it, a layer keeps its
## relative order inside its section. Without any screen section the rows are the layers in order, as before.
## Below the last layer row sits the control lane (timeline_lane.gd): directly under the layers while everything fits,
## pinned to the bottom of the canvas once the layers need to scroll.
## Y values: "content y" = 0 just under the ruler, "screen y" = canvas y (content y + RULER_H - scroll_y).

const TM := preload("res://features/timeline/timeline_math.gd")
const S := preload("res://features/timeline/timeline_send_to.gd")

const ALL := -1  # the section of a layer without screenIdx
const DIVIDER_H := 24
const LANE_ROW_H := 32
const LANE_PAD := 4
const MIN_LAYERS_VIEW := 60.0  # the layer area never shrinks below this, however tall the lane grows
const SCROLLBAR_W := 8.0
const BTN_W := 20.0  # a divider's "+" / "x" cells, right-aligned in the header column


## The section of a layer: its screenIdx, or ALL.
static func layer_screen(layer: Variant) -> int:
	if layer is Dictionary:
		var s: Variant = layer.get("screenIdx")
		if (s is int or s is float) and float(s) >= 0.0:
			return int(s)
	return ALL


## Screen sections, in the order they were added (tl.screens), then any screen a layer uses that the list misses.
static func screens(tl: Dictionary) -> Array:
	var out := []
	if tl.get("screens") is Array:
		for s in tl.screens:
			if (s is int or s is float) and float(s) >= 0.0 and not int(s) in out:
				out.append(int(s))
	for l in tl.get("layers", []):
		var s := layer_screen(l)
		if s >= 0 and not s in out:
			out.append(s)
	return out


## Rows top to bottom: {kind: "divider"|"layer", li (-1 for a divider), screen, y, h}. An "All screens" divider heads
## the first section as soon as a screen section exists, so a layer can be dragged / added back to it.
static func rows(tl: Dictionary) -> Array:
	TM.ensure_heights(tl)
	var ls: Array = tl.get("layers", [])
	var scr := screens(tl)
	var out := []
	var y := 0
	for sec in [ALL] + scr:
		if sec != ALL or not scr.is_empty():
			out.append({"kind": "divider", "li": -1, "screen": sec, "y": y, "h": DIVIDER_H})
			y += DIVIDER_H
		for li in ls.size():
			if layer_screen(ls[li]) == sec:
				var h := int(tl.layerHeights[li])
				out.append({"kind": "layer", "li": li, "screen": sec, "y": y, "h": h})
				y += h
	return out


static func content_h(tl: Dictionary) -> int:
	var r := rows(tl)
	return 0 if r.is_empty() else int(r[-1].y) + int(r[-1].h)


static func section_empty(tl: Dictionary, screen: int) -> bool:
	for l in tl.get("layers", []):
		if layer_screen(l) == screen:
			return false
	return true


static func row_of_layer(tl: Dictionary, li: int) -> Dictionary:
	for r in rows(tl):
		if r.kind == "layer" and r.li == li:
			return r
	return {}


## Screen y of the top of layer `li`'s row (past the last row for an index that does not exist).
static func top(tl: Dictionary, li: int, scroll_y: float) -> float:
	var r := row_of_layer(tl, li)
	return TM.RULER_H - scroll_y + (float(r.y) if not r.is_empty() else float(content_h(tl)))


static func row_at(tl: Dictionary, y: float, scroll_y: float) -> Dictionary:
	var cy := y - TM.RULER_H + scroll_y
	for r in rows(tl):
		if cy >= float(r.y) and cy < float(r.y) + float(r.h):
			return r
	return {}


## The layer under screen y: its index; -1 on a divider (or above the rows); n below the last row (the "new layer" slot).
static func layer_at(tl: Dictionary, y: float, scroll_y: float) -> int:
	var r := row_at(tl, y, scroll_y)
	if not r.is_empty():
		return int(r.li)
	return (tl.get("layers", []) as Array).size() if y - TM.RULER_H + scroll_y >= content_h(tl) else -1


## The height divider under screen y: [upper layer, lower layer] when the border between two layer rows is within
## hit_px, else []. Dividers between a section's last layer and the next section's header are not height dividers.
static func hit_divider(tl: Dictionary, y: float, scroll_y: float, hit_px := 5.0) -> Array:
	if y < TM.RULER_H:
		return []
	var rs := rows(tl)
	for i in rs.size() - 1:
		if rs[i].kind == "layer" and rs[i + 1].kind == "layer":
			if absf(y - (TM.RULER_H - scroll_y + float(rs[i].y) + float(rs[i].h))) <= hit_px:
				return [int(rs[i].li), int(rs[i + 1].li)]
	return []


## Where a Sources drop at screen y lands: {li, screen}. A layer row → that layer; a divider, or below the last
## row → li = n (a new layer) in that divider's / the last row's section.
static func drop_target(tl: Dictionary, y: float, scroll_y: float) -> Dictionary:
	var n := (tl.get("layers", []) as Array).size()
	var r := row_at(tl, y, scroll_y)
	if not r.is_empty():
		return {"li": n if r.kind == "divider" else int(r.li), "screen": int(r.screen)}
	var rs := rows(tl)
	return {"li": n, "screen": int(rs[-1].screen) if not rs.is_empty() else ALL}


## "+" / "x" cells of a divider row by header x: "add", "remove" (not on the All screens divider) or "".
static func divider_button(x: float, screen: int) -> String:
	if x >= TM.HEADER_W - 2 * BTN_W - 4 and x < TM.HEADER_W - BTN_W - 4:
		return "add"
	if screen != ALL and x >= TM.HEADER_W - BTN_W - 4 and x < TM.HEADER_W - 4:
		return "remove"
	return ""


static func lane_h(lane_rows: int) -> int:
	return 2 * LANE_PAD + maxi(1, lane_rows) * LANE_ROW_H


## {lane_top, lane_h, layers_bottom, max_scroll, pinned} for a canvas `view_h` tall: the lane under the layers while
## they fit; else pinned to the canvas bottom with the layers scrolling above it.
static func viewport(tl: Dictionary, view_h: float, lane_rows: int) -> Dictionary:
	var avail := view_h - TM.RULER_H
	var content := float(content_h(tl))
	var lh := float(lane_h(lane_rows))
	if content + lh <= avail:
		return {"lane_top": TM.RULER_H + content, "lane_h": lh, "layers_bottom": TM.RULER_H + content, "max_scroll": 0.0, "pinned": false}
	var layers_h := maxf(MIN_LAYERS_VIEW, avail - lh)
	return {"lane_top": TM.RULER_H + layers_h, "lane_h": lh, "layers_bottom": TM.RULER_H + layers_h,
		"max_scroll": maxf(0.0, content - layers_h), "pinned": true}


static func clamp_scroll(tl: Dictionary, view_h: float, lane_rows: int, scroll_y: float) -> float:
	return clampf(scroll_y, 0.0, float(viewport(tl, view_h, lane_rows).max_scroll))


## The vertical scrollbar thumb as [top, height] in screen y (empty when nothing scrolls).
static func thumb(vp: Dictionary, content: float, scroll_y: float) -> Array:
	if float(vp.max_scroll) <= 0.0:
		return []
	var track := float(vp.layers_bottom) - TM.RULER_H
	var h := maxf(24.0, track * track / maxf(content, 1.0))
	return [TM.RULER_H + (track - h) * scroll_y / float(vp.max_scroll), h]


## Inverse of thumb(): the scroll for a thumb whose top is at screen y `thumb_top`.
static func scroll_for_thumb(vp: Dictionary, content: float, thumb_top: float) -> float:
	var t := thumb(vp, content, 0.0)
	if t.is_empty():
		return 0.0
	var span := float(vp.layers_bottom) - TM.RULER_H - float(t[1])
	return clampf((thumb_top - TM.RULER_H) / maxf(span, 1.0), 0.0, 1.0) * float(vp.max_scroll)


## Screens (0 … count-1) that have no section yet.
static func available_screens(tl: Dictionary, count: int) -> Array:
	var have := screens(tl)
	var out := []
	for i in count:
		if not i in have:
			out.append(i)
	return out


## screen → label: the destination's name from the channel map (the Dest list's), "Screen N" when it has none.
static func screen_names(cm: Dictionary, count: int) -> Dictionary:
	var out := {}
	for o in S.screen_options(cm):
		if o[1] != null:
			out[int(o[1])] = str(o[0])
	for i in count:
		if not out.has(i):
			out[i] = "Screen %d" % (i + 1)
	return out


static func screen_label(names: Dictionary, screen: int) -> String:
	return "All screens" if screen == ALL else str(names.get(screen, "Screen %d" % (screen + 1)))
