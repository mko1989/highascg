extends RefCounted
## WO-899 (owner 31.10) — the Sources sub-tabs always fit their column: shrink the font to a floor, then trim the
## labels widest first. core/ui_fit.gd is the planner; app/fit_tabs.gd applies it to a real TabContainer.

const UiFit := preload("res://core/ui_fit.gd")
const FitTabs := preload("res://app/fit_tabs.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
var t

const TITLES := ["Media", "CGs", "Live", "Visuals", "Timelines"]


## Monospace stand-in: every character is half the font size wide (the real font is covered below).
static func _mono(text: String, size: int) -> float:
	return text.length() * size * 0.5


func _m() -> Callable:
	return _mono


func test_pad_follows_the_font_and_has_a_floor() -> void:
	t.eq(UiFit.pad_for(15), 8, "15 px → 8")
	t.eq(UiFit.pad_for(11), 6, "11 px → 6 (the floor)")
	t.eq(UiFit.pad_for(2), UiFit.MIN_PAD, "never below the floor")
	t.ok(UiFit.MIN_SIZE >= 11 and UiFit.MIN_SIZE < UiFit.NATURAL_SIZE, "readability floor 11, below the theme's 15")


func test_plenty_of_room_changes_nothing() -> void:
	var p := UiFit.plan(TITLES, 600.0, _m(), 0.0)
	t.eq(p.size, UiFit.NATURAL_SIZE, "natural size")
	t.eq(p.natural, true, "natural flag")
	t.eq(p.trimmed, false, "no trim")
	t.eq(p.titles, TITLES, "titles untouched")


func test_font_shrinks_step_by_step_before_any_trim() -> void:
	# 5+3+4+7+9 = 28 chars: width = 28 * size / 2 → 210 @15, 196 @14, 182 @13, 168 @12, 154 @11
	for want in [[215.0, 15], [200.0, 14], [185.0, 13], [170.0, 12], [156.0, 11]]:
		var p := UiFit.plan(TITLES, want[0], _m(), 0.0)
		t.eq(p.size, want[1], "room %s → %d px" % [want[0], want[1]])
		t.eq(p.trimmed, false, "still whole at %d" % want[1])
	t.eq(UiFit.plan(TITLES, 197.0, _m(), 0.0).size, 13, "197 px: 14 px needs 196 + the 2 px slack")


func test_chrome_counts_per_size() -> void:
	var chrome := func(size: int) -> float: return 5 * 2.0 * UiFit.pad_for(size)
	var p := UiFit.plan(TITLES, 240.0, _m(), chrome)
	# 15: 210 + 80 = 290 · 14: 196 + 80 · 13: 182 + 70 = 252 · 12: 168 + 70 = 238 ✓.
	t.eq(p.size, 12, "text plus the padding of that size")
	t.eq(p.trimmed, false, "")


func test_below_the_floor_the_widest_label_is_trimmed_first() -> void:
	var p := UiFit.plan(TITLES, 120.0, _m(), 0.0)  # @11: 154 px wanted, 120 given
	t.eq(p.size, UiFit.MIN_SIZE, "stays at the floor")
	t.eq(p.trimmed, true, "trimmed")
	t.eq(p.fits, true, "and now fits")
	t.eq(p.titles[1], "CGs", "short labels stay whole")
	t.eq(p.titles[2], "Live", "")
	t.ok(str(p.titles[4]).ends_with("…") and str(p.titles[4]).length() < 9, "Timelines lost its tail: %s" % p.titles[4])
	var total := 0.0
	for s in p.titles:
		total += _mono(s, 11)
	t.ok(total <= 118.0, "total %s within 120 - slack" % total)
	# widest first: Timelines (9) is never shorter than Visuals (7) by more than the one char the order allows
	t.ok(absi(str(p.titles[4]).length() - str(p.titles[3]).length()) <= 1, "widest trimmed first → the long ones end up level: %s / %s" % [p.titles[3], p.titles[4]])


func test_hopeless_width_reports_not_fitting() -> void:
	var p := UiFit.plan(TITLES, 20.0, _m(), 0.0)
	t.eq(p.fits, false, "20 px cannot hold five tabs")
	for s in p.titles:
		t.ok(str(s).length() >= 2, "a label keeps one character and the ellipsis: %s" % s)


func test_trim_to_longest_head_that_fits() -> void:
	t.eq(UiFit.trim_to("project only", 200.0, _m(), 11), "project only", "fits → untouched")
	var s := UiFit.trim_to("project only", 30.0, _m(), 11)  # 30 / 5.5 = 5 chars
	t.eq(s, "proj…", "4 chars + …: %s" % s)
	t.eq(UiFit.trim_to("abc", 1.0, _m(), 11), "a…", "never empty")


func test_real_font_five_tabs_in_the_sources_column() -> void:
	var font := ThemeBuilder.load_font()
	var measure := func(text: String, size: int) -> float:
		return font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var chrome := func(size: int) -> float: return 5 * 2.0 * UiFit.pad_for(size)
	var p280 := UiFit.plan(TITLES, 270.0, measure, chrome)  # the column is 280 wide, ~270 inside
	t.eq(p280.trimmed, false, "280 px column: whole names")
	var p200 := UiFit.plan(TITLES, 210.0, measure, chrome)  # 11 px needs 144 + 60 + slack
	t.eq(p200.size, UiFit.MIN_SIZE, "210 px: at the floor")
	t.eq(p200.trimmed, false, "210 px: the floor is enough")
	var p150 := UiFit.plan(TITLES, 150.0, measure, chrome)
	t.eq(p150.trimmed, true, "150 px: trimmed")
	t.eq(p150.fits, true, "150 px: fits")


func _tabs(width: float) -> TabContainer:
	var tc := TabContainer.new()
	tc.theme = ThemeBuilder.build()
	tc.size = Vector2(width, 120)
	for n in TITLES:
		var c := Control.new()
		c.name = n
		tc.add_child(c)
	t.root.add_child(tc)
	return tc


func test_tab_container_shows_every_tab_without_scroll_arrows() -> void:
	for w in [280.0, 230.0, 170.0]:
		var tc := _tabs(w)
		tc.size = Vector2(w, 120)
		await t.process_frame
		var fit := FitTabs.attach(tc)
		await t.process_frame
		await t.process_frame
		fit.refit()
		var bar := tc.get_tab_bar()
		t.eq(bar.get_offset_buttons_visible(), false, "%d px: no ‹ › arrows" % w)
		var right := 0.0
		for i in tc.get_tab_count():
			right = maxf(right, bar.get_tab_rect(i).end.x)
		t.ok(right <= bar.size.x, "%d px: last tab ends at %s inside %s" % [w, right, bar.size.x])
		if w == 280.0:
			t.eq(fit.last.trimmed, false, "280: whole names")
		if w == 170.0:
			t.eq(fit.last.size, UiFit.MIN_SIZE, "170: floor font")
			t.eq(tc.get_tab_tooltip(4), "Timelines", "a trimmed tab keeps its full name in the tooltip")
		tc.queue_free()


func test_rename_hide_and_grow_refit() -> void:
	var tc := _tabs(170.0)
	await t.process_frame
	var fit := FitTabs.attach(tc)
	await t.process_frame
	fit.refit()
	t.eq(fit.last.trimmed, true, "170 px: trimmed")
	tc.set_tab_hidden(3, true)
	tc.set_tab_hidden(4, true)
	fit.refit()
	t.eq(fit.last.titles.size(), 3, "hidden tabs leave the plan")
	t.eq(fit.last.trimmed, false, "three short tabs fit whole")
	tc.set_tab_hidden(3, false)
	tc.set_tab_hidden(4, false)
	tc.set_tab_title(0, "Library of everything")
	fit.refit()
	t.eq(fit.last.titles.size(), 5, "back")
	t.ok(str(tc.get_tab_title(0)).begins_with("Lib"), "a renamed tab is re-learned: %s" % tc.get_tab_title(0))
	t.eq(tc.get_tab_tooltip(0), "Library of everything", "the new full name is the tooltip")
	tc.size = Vector2(900, 120)
	await t.process_frame
	await t.process_frame
	fit.refit()
	t.eq(fit.last.trimmed, false, "a wide column gives the names back")
	t.eq(tc.get_tab_title(0), "Library of everything", "")
	t.eq(fit.last.size, UiFit.NATURAL_SIZE, "and the natural font")
	tc.queue_free()
