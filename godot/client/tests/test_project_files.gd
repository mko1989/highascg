extends RefCounted
## WO-1009 — core/project_files.gd helpers (the header Files window, previs MVR Import… and Models share them).

const PF := preload("res://core/project_files.gd")
var t


func test_accepts_only_show_documents() -> void:
	t.eq(["a.mvr", "B.GLB", "rider.pdf", "patch.xls", "patch.xlsx"].map(func(p: String) -> bool: return PF.accepts(p)), [true, true, true, true, true])
	t.eq(["clip.mp4", "x.gltf", "notes.txt", "noext"].map(func(p: String) -> bool: return PF.accepts(p)), [false, false, false, false])
	t.ok(PF.filters()[0].contains("*.xlsx"), "the file dialog filter lists them")


func test_url_and_sizes() -> void:
	t.eq(PF.url("rider (2).pdf"), "/api/project-files/rider%20%282%29.pdf", "names are URI-encoded")
	t.eq(PF.url("scéna.mvr"), "/api/project-files/sc%C3%A9na.mvr")
	t.eq([PF.size_text(500), PF.size_text(2048), PF.size_text(5 * 1048576)], ["500 B", "2 KB", "5.0 MB"])


## WO-1009 Sources "media only" off: the media tree also lists documents; a document row is never a media row.
func test_media_docs_rows() -> void:
	var Docs := preload("res://features/live/media_docs.gd")
	var d: Node = Docs.new()
	var media := [{"id": "projects/narvil/clip.mp4"}]
	d.rows = [{"id": "projects/narvil/rider.pdf", "kind": "pdf", "size": 2048, "doc": true}]
	t.eq(d.merged(media).size(), 1, "media only (the default): no documents")
	d.shown = true
	t.eq(d.merged(media).size(), 2, "media only off: documents join the tree")
	var tree := Tree.new()
	tree.columns = 2  # name · info, as the media tree
	var root := tree.create_item()
	var it := tree.create_item(root)
	t.ok(not d.decorate(it, media[0]), "a clip keeps its media setup")
	t.ok(d.decorate(it, d.rows[0]), "a document is set up here")
	var m: Dictionary = it.get_metadata(0)
	t.ok(m.has("doc") and not m.has("value") and not m.has("row"), "never dragged, never a media selection")
	t.eq(it.get_text(1), "PDF · 2 KB")
	t.eq(PF.doc_url("projects/narvil/rider (2).pdf"), "/api/media-docs/file?id=projects%2Fnarvil%2Frider%20%282%29.pdf")
	tree.free()
	d.free()
