extends RefCounted
## WO-843 — one load-modify-save write into ui.cfg. The file is shared by many keys (haze, previs folds, the per-origin API
## password, …): a ConfigFile loaded earlier and saved later writes every key back as it was then, so each write
## re-reads the file right before it saves (the timeline splitter used to hold its copy from the tab's build onward).

const PATH := "user://ui.cfg"


static func save_value(section: String, key: String, value: Variant, path := PATH) -> void:
	var cfg := ConfigFile.new()
	cfg.load(path)
	cfg.set_value(section, key, value)
	cfg.save(path)
