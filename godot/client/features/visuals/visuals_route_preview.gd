extends RefCounted
## WO-1053 — picked layers back in the Visuals tab's views. A position routed to its own ring (`L<n>`) or a group leaves the
## deck's `out` and the mixer's `out_vp` (WO-1051), so the PRV view (the off-air deck's `out`) and the PGM / canvas view
## (`out_vp`) lost it. Each view now draws that bank's (PRV: the deck's `solo[key]`) or mix's (PGM: `solo_out[key]`) key
## composites ON TOP of its own picture: one TextureRect per key, a child of the view with the same letterboxing, premultiplied
## blending (CanvasItemMaterial BLEND_MODE_PREMULT_ALPHA — the composites are premultiplied, transparent around the layers)
## and no extra render pass (the composites already render for the rings).
## Rule: ordered by each key's LOWEST stack position, the lowest drawn first. That is what air shows when the looks stack
## the picked sources over `visuals` in that order: Caspar composites the look layers, not the Visuals stack, so a picked
## layer that sits under main layers in the Visuals stack previews on top of them — honest about Caspar.

const META := "wo1053_route_overlay"
static var _mat: CanvasItemMaterial


## The keys of `route` ({position: key}) by their lowest position, lowest first (the draw order on top of the view).
static func order(route: Dictionary) -> Array:
	var low := {}
	for n in route:
		var k: String = route[n]
		low[k] = mini(int(low.get(k, n)), int(n))
	var ks := low.keys()
	ks.sort_custom(func(a: String, b: String) -> bool: return low[a] < low[b])
	return ks


## The overlay rects on `view` (in draw order).
static func overlays(view: Control) -> Array:
	return view.get_children().filter(func(c: Node) -> bool: return c.has_meta(META))


## `view` (a TextureRect showing a composite) gets `texs` drawn over its picture in that order, under its other children
## (the PRV / PGM tags). Rebuilt only when the list changed: cheap enough to call every frame.
static func show(view: TextureRect, texs: Array) -> void:
	if view == null:
		return
	var have := overlays(view)
	if have.map(func(c: TextureRect) -> Texture2D: return c.texture) == texs:
		return
	for c in have:
		view.remove_child(c)
		c.queue_free()
	if _mat == null:
		_mat = CanvasItemMaterial.new()
		_mat.blend_mode = CanvasItemMaterial.BLEND_MODE_PREMULT_ALPHA
	for i in texs.size():
		var r := TextureRect.new()
		r.set_meta(META, true)
		r.texture = texs[i]
		r.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		r.stretch_mode = view.stretch_mode
		r.material = _mat
		r.mouse_filter = Control.MOUSE_FILTER_IGNORE
		r.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		view.add_child(r)
		view.move_child(r, i)  # under the tags
