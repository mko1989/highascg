extends RefCounted
## WO-740 — help pages: markdown_bbcode.gd (the Markdown subset → BBCode) and help_dialog.gd (pages, "?" buttons).

const MD := preload("res://app/markdown_bbcode.gd")
const HelpDialog := preload("res://app/help_dialog.gd")
const Fold := preload("res://features/previs/fold_section.gd")
const TOPICS := ["psn-output", "calibrate-heads", "calibrate-cameras", "calibrate-ptz"]
var t


func test_blocks() -> void:
	var b := MD.convert("# Title\n\nOne line\nsame paragraph.\n\n## Steps\n1. First\n   wrapped on.\n2. Second\n  - dot\n  - two\n3. Third\n- after\n\n> note\n\n---")
	var blocks := b.split(MD.GAP)
	t.eq(blocks[0], "[font_size=26][b]Title[/b][/font_size]", "h1")
	t.eq(blocks[1], "One line same paragraph.", "paragraph lines joined")
	t.eq(blocks[2], "[font_size=21][b]Steps[/b][/font_size]", "h2")
	t.eq(blocks[3], "[ol type=1]First wrapped on.\nSecond[ul]dot\ntwo[/ul]\nThird[/ol][ul]after[/ul]",
		"one list block: a wrapped line stays in its item, nesting by two spaces, numbering resumes, bullets after")
	t.eq(blocks[4], "[indent][i]note[/i][/indent]", "quote")
	t.ok(blocks[5].begins_with("[color="), "rule")
	t.eq(blocks.size(), 6, "nothing else")
	t.eq(MD.title("intro\n# Calibrate heads\n# Later"), "Calibrate heads", "first h1 is the title")


func test_inline() -> void:
	t.eq(MD.inline("**Done** and *this* or _that_"), "[b]Done[/b] and [i]this[/i] or [i]that[/i]", "bold, italic")
	t.eq(MD.inline("`236.10.10.10:56565`"), "[code]236.10.10.10:56565[/code]", "code")
	t.eq(MD.inline("see [Heads](calibrate-heads.md)."), "see [url=calibrate-heads.md]Heads[/url].", "link")
	t.eq(MD.inline("a [b] c"), "a [lb]b] c", "a literal [ never opens a tag")
	t.eq(MD.inline("pan_tilt 2 * 3 snake_case"), "pan_tilt 2 * 3 snake_case", "no italics inside words or around spaces")
	t.eq(MD.inline("`[x]`"), "[code][lb]x][/code]", "code is escaped too")


func test_table() -> void:
	var b := MD.convert("| Desk | Port |\n|---|:-:|\n| MA3 | 56565 |\n| Eos |")
	t.eq(b, "[table=2][cell padding=4,2,12,2][b]Desk[/b][/cell][cell padding=4,2,12,2][b]Port[/b][/cell]" +
		"[cell padding=4,2,12,2]MA3[/cell][cell padding=4,2,12,2]56565[/cell]" +
		"[cell padding=4,2,12,2]Eos[/cell][cell padding=4,2,12,2][/cell][/table]", "header bold, short rows padded")


func test_every_page_loads_and_links_resolve() -> void:
	for topic in TOPICS:
		var md := HelpDialog.load_md(topic)
		t.ok(md != "", "%s.md is in res://help/" % topic)
		t.ok(MD.title(md) != "", "%s has a title" % topic)
		var bb := MD.convert(md)
		var at := bb.find("[url=")
		while at >= 0:
			var target := bb.substr(at + 5, bb.find("]", at) - at - 5)
			if not target.contains("://"):
				t.ok(HelpDialog.load_md(target) != "", "%s links to %s, which exists" % [topic, target])
			at = bb.find("[url=", at + 1)
	t.eq(HelpDialog.load_md("no-such-page"), "", "missing page → empty")
	t.eq(HelpDialog.path_of("../calibrate-heads.md"), "res://help/calibrate-heads.md", "a topic never leaves res://help/")


func test_buttons() -> void:
	var b := HelpDialog.button("calibrate-heads")
	t.eq([b.text, b.tooltip_text], ["?", "Help: Calibrate heads"], "\"?\" named after the page")
	b.free()
	var f := Fold.new("Help fold %d" % Time.get_ticks_usec(), [Label.new()], "calibrate-ptz")
	var row: HBoxContainer = f.get_child(0)
	t.eq([row.get_child(0) is Button, (row.get_child(1) as Button).text], [true, "?"], "the fold title row carries the ?")
	f.free()


func test_wired_where_the_owner_needs_it() -> void:
	var wires := {
		"res://features/previs/tracking/follow_output.gd": "HelpDialog.beside(_proto, \"psn-output\")",
		"res://features/previs/fixtures/fixtures_section.gd": "[CalibrateFold.new()], \"calibrate-heads\")",
		"res://features/previs/tracking/tracking_page.gd": "\"calibrate-cameras\")",
		"res://features/previs/tracking/ptz_calibrate_fold.gd": "HelpDialog.beside(_toggle, \"calibrate-ptz\")",
	}
	for path in wires:
		t.ok(FileAccess.get_file_as_string(path).contains(wires[path]), "%s opens its help page" % path.get_file())
	var presets := FileAccess.get_file_as_string("res://export_presets.cfg")
	t.ok(presets.contains("help/*.md"), "exported clients carry the help pages")
