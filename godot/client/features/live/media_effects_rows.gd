extends RefCounted

## WO-603 slice 9 (moved out of media_panel.gd for the 500-line limit, WO-1029): the EFFECTS group of the Media tree.
static func build(tree: Tree, fx_registry: Dictionary, root: TreeItem, f: String) -> void:
	var _fx := fx_registry
	var fx: Array = _fx.get("effects", []) if _fx.get("effects") is Array else []
	var cats: Array = _fx.get("categories", []) if _fx.get("categories") is Array else []
	var group: TreeItem = null
	for cat in cats:
		var head: TreeItem = null
		for e in fx:
			if not (e is Dictionary) or str(e.get("category", "")) != str(cat.get("id", "")):
				continue
			var label := str(e.get("label", e.get("type", "")))
			if f != "" and not label.to_lower().contains(f) and not str(e.get("category", "")).to_lower().contains(f):
				continue
			if group == null:
				group = tree.create_item(root)
				group.set_text(0, "EFFECTS")
				group.collapsed = f == ""
			if head == null:
				head = tree.create_item(group)
				head.set_text(0, str(cat.get("label", cat.get("id", ""))))
			var it := tree.create_item(head)
			it.set_text(0, label)
			it.set_tooltip_text(0, "Mixer effect — drop on a timeline clip")
			it.set_metadata(0, {"type": "effect", "value": str(e.type), "label": label})
