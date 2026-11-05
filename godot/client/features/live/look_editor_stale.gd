extends RefCounted
## WO-918 F12 — when an open look editor no longer has anything to edit: another project was loaded (New project / Load:
## a different slug), the look is gone, or the destination whose bus it edits was removed (main index ≥ the screen count).
## A background edit or a remote sync of the SAME project never closes it.

const DeckModel := preload("res://features/live/deck_model.gd")


static func stale(opened_slug: String, project: Dictionary, scene_id: String, main_idx: int, screen_count: int) -> bool:
	if str(project.get("slug", "")) != opened_slug:
		return true
	if main_idx < 0 or main_idx >= screen_count:
		return true
	var root: Variant = project.get("scenes")
	if not (root is Dictionary) or not ((root as Dictionary).get("scenes") is Array):
		return true
	for s in (root as Dictionary).scenes:
		if s is Dictionary and str((s as Dictionary).get("id", "")) == scene_id:
			return false
	return true


## WO-960: the slug the editor compares against. Opened while the client did not know the show's slug (a project
## re-pull — e.g. after a screen add — drops it until the next save answers, project_sync.adopt_slug), the first slug
## learned is the same show, not another one; a real switch still closes it (its looks are gone).
static func opened_slug(opened: String, now: String) -> String:
	return opened if opened != "" else now


## Closes the look editor `ed` when it went stale; true when it did.
static func close_if_stale(ed: Node) -> bool:
	var cm: Variant = Store.get_value("channelMap", {})
	var slug := opened_slug(str(ed.slug), str(Store.project.get("slug", "")))
	if not stale(slug, Store.project, ed.scene_id, ed.main, DeckModel.screen_count(cm if cm is Dictionary else {})):
		ed.slug = slug
		return false
	ed.close_editor()
	return true
