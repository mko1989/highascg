extends RefCounted
## WO-606 — Shader FX editor helpers (same body as the web collectForm).

const M := preload("res://features/live/shader_fx_model.gd")
var t


func test_collect_and_labels() -> void:
	t.eq(M.list_label({"id": "sh-a", "name": "Galaxy", "audio": true}), "Galaxy ♪")
	t.eq(M.list_label({"id": "sh-a"}), "sh-a")
	t.eq(M.channel_index(null), 0)
	t.eq(M.channel_index("audio"), 5)
	t.eq(M.channel_index("bogus"), 0)
	var b := M.collect("", " My FX ", "// c", {"image": "void mainImage(){}", "bufferA": "  "}, {"image": ["A", "", "audio", ""]}, true, false)
	t.eq(b.name, "My FX")
	t.eq(b.has("id"), false, "a new shader has no id")
	t.eq(b.passes.keys(), ["image"], "empty passes dropped")
	t.eq(b.passes.image.channels, ["A", null, "audio", null])
	t.eq(b.audio, {"enabled": true})
	t.eq(b.opts, {"alpha": false})
	t.eq(M.collect("sh-x", "n", "", {}, {}, false, true).id, "sh-x")
	t.eq(M.sources_body("c", {"image": "x"}), {"common": "c", "passes": {"image": {"source": "x"}}})
	t.eq(M.import_note({"name": "Toy"}), "Imported \"Toy\" — review and save")
	t.eq(M.import_note({"name": "Toy", "skipped": ["Sound"]}), "Imported \"Toy\" — review and save — not imported: Sound")
	t.eq(M.highlighter(Color.RED, Color.RED, Color.RED, Color.RED, Color.RED, Color.RED).has_keyword_color("vec3"), true)
