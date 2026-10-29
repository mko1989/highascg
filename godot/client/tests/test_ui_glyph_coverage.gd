extends RefCounted
## WO-826 — every non-ASCII character the client's scripts draw must be in Rewir or the bundled DejaVu symbol subset.
## The Web export has no system fonts, so a glyph in neither renders as a box there (desktop hides this by falling
## back to the OS fonts). KNOWN_GAPS are media / emoji symbols neither font has; shrink the list, never grow it
## without a reason in WO-826.

const ThemeBuilder := preload("res://app/theme_builder.gd")
const KNOWN_GAPS := "⏭⏮⏱⏸⛶⧉＋🎚📁🔊"
var t


func _used_chars(dir: String, out: Dictionary) -> void:
	for f in DirAccess.get_files_at(dir):
		if f.ends_with(".gd"):
			for c in FileAccess.get_file_as_string(dir.path_join(f)):
				if c.unicode_at(0) > 0x7e:
					out[c] = dir.path_join(f)
	for d in DirAccess.get_directories_at(dir):
		if d != "tests" and d != "e2e" and not d.begins_with("."):
			_used_chars(dir.path_join(d), out)


func test_theme_font_has_the_symbol_fallback() -> void:
	var f: FontFile = ThemeBuilder.load_font()
	t.ok(f != null, "Rewir loads")
	t.eq(f.fallbacks.size(), 1, "one fallback: the DejaVu symbol subset")
	var bare := FontFile.new()  # has_char searches the fallbacks too: Rewir alone
	bare.data = FileAccess.get_file_as_bytes(ThemeBuilder.FONT_PATH)
	t.ok(not bare.has_char("▾".unicode_at(0)), "Rewir itself has no ▾ (the reason for the fallback)")
	t.ok(f.fallbacks[0].has_char("▾".unicode_at(0)), "the fallback has ▾")


func test_every_drawn_glyph_is_covered() -> void:
	var f: FontFile = ThemeBuilder.load_font()
	var fb: Font = f.fallbacks[0]
	var used := {}
	_used_chars("res://", used)
	var missing: Array = []
	for c in used:
		var cp: int = c.unicode_at(0)
		if not f.has_char(cp) and not fb.has_char(cp) and not KNOWN_GAPS.contains(c):
			missing.append("%s U+%04X (%s)" % [c, cp, used[c]])
	t.ok(used.size() > 50, "scanned the client (%d non-ASCII characters)" % used.size())
	t.eq(missing, [], "glyphs drawn as boxes on Web")
	for c in KNOWN_GAPS:
		t.ok(not fb.has_char(c.unicode_at(0)), "%s is still a gap (else drop it from KNOWN_GAPS)" % c)
