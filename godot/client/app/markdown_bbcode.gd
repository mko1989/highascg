extends RefCounted
## WO-740 — the small Markdown subset the help pages use, as RichTextLabel BBCode (pure, unit-tested):
## `#`/`##`/`###` headings, paragraphs, `-`/`*` bullets and `1.` steps (two-space nesting; an indented line
## continues its item), `> ` notes,
## `**bold**`, `*italic*` / `_italic_`, `` `code` ``, `[text](target)` links (meta = target: another help page or a
## URL), `|` tables with a `---` separator row, and `---` rules. Anything else stays plain text, escaped.

const H_SIZES := [26, 21, 17]
const GAP := "\n[font_size=6] [/font_size]\n"  # a little air between blocks


## The page title: the first `# ` heading ("" when none).
static func title(md: String) -> String:
	for line in md.split("\n"):
		if line.begins_with("# "):
			return line.substr(2).strip_edges()
	return ""


static func convert(md: String) -> String:
	var out := PackedStringArray()
	var lines := md.replace("\r", "").split("\n")
	var i := 0
	var para := PackedStringArray()
	while i < lines.size():
		var line: String = lines[i]
		var t := line.strip_edges()
		if t == "":
			_flush(out, para)
			i += 1
			continue
		if t.begins_with("|") and i + 1 < lines.size() and _is_sep(lines[i + 1]):
			_flush(out, para)
			var rows: Array = [_cells(t)]
			i += 2
			while i < lines.size() and lines[i].strip_edges().begins_with("|"):
				rows.append(_cells(lines[i].strip_edges()))
				i += 1
			out.append(_table(rows))
			continue
		if _item(line).size() > 0:
			_flush(out, para)
			var items: Array = []
			while i < lines.size() and lines[i].strip_edges() != "":
				var it := _item(lines[i])
				if it.size() > 0:
					items.append(it)
				elif lines[i].begins_with(" ") and not items.is_empty():
					items[-1][2] += " " + lines[i].strip_edges()  # a wrapped line continues its item
				else:
					break
				i += 1
			out.append(_list(items))
			continue
		var h := _heading(t)
		if h >= 0:
			_flush(out, para)
			var text := t.substr(h + 2).strip_edges()
			out.append("[font_size=%d][b]%s[/b][/font_size]" % [H_SIZES[mini(h, 2)], inline(text)])
		elif t == "---" or t == "***":
			_flush(out, para)
			out.append("[color=#ffffff40]────────────────────────[/color]")
		elif t.begins_with("> "):
			_flush(out, para)
			out.append("[indent][i]%s[/i][/indent]" % inline(t.substr(2)))
		else:
			para.append(inline(t))
		i += 1
	_flush(out, para)
	return GAP.join(out)


## Inline marks on one line of text (escaped first, so a literal "[" never opens a tag).
static func inline(s: String) -> String:
	var out := ""
	var i := 0
	while i < s.length():
		var c := s[i]
		if c == "`":
			var j := s.find("`", i + 1)
			if j > i:
				out += "[code]%s[/code]" % _esc(s.substr(i + 1, j - i - 1))
				i = j + 1
				continue
		if c == "[":
			var close := s.find("](", i)
			var end := s.find(")", close + 2) if close > i else -1
			if close > i and end > close:
				var target := s.substr(close + 2, end - close - 2)
				out += "[url=%s]%s[/url]" % [target, inline(s.substr(i + 1, close - i - 1))]
				i = end + 1
				continue
		if s.substr(i, 2) == "**":
			var j := s.find("**", i + 2)
			if j > i + 1:
				out += "[b]%s[/b]" % inline(s.substr(i + 2, j - i - 2))
				i = j + 2
				continue
		if (c == "*" or c == "_") and i + 1 < s.length() and s[i + 1] != " " and (i == 0 or not _word(s[i - 1])):
			var j := s.find(c, i + 1)
			if j > i + 1 and (j + 1 >= s.length() or not _word(s[j + 1])):
				out += "[i]%s[/i]" % inline(s.substr(i + 1, j - i - 1))
				i = j + 1
				continue
		out += _esc(c)
		i += 1
	return out


static func _esc(s: String) -> String:
	return s.replace("[", "[lb]")


static func _word(c: String) -> bool:
	return c.to_lower() != c.to_upper() or c.is_valid_int()


static func _flush(out: PackedStringArray, para: PackedStringArray) -> void:
	if not para.is_empty():
		out.append(" ".join(para))
		para.clear()


static func _heading(t: String) -> int:
	for h in [2, 1, 0]:
		if t.begins_with("#".repeat(h + 1) + " "):
			return h
	return -1


## A list line → [depth (two spaces each), ordered, text], else [].
static func _item(line: String) -> Array:
	var t := line.strip_edges()
	var depth := (line.length() - line.lstrip(" ").length()) / 2
	if t.begins_with("- ") or t.begins_with("* "):
		return [depth, false, t.substr(2).strip_edges()]
	var dot := t.find(". ")
	if dot > 0 and dot <= 3 and t.substr(0, dot).is_valid_int():
		return [depth, true, t.substr(dot + 2).strip_edges()]
	return []


## RichTextLabel's own lists: a hanging indent for wrapped lines, numbering by the label.
static func _list(items: Array) -> String:
	var s := ""
	var open: Array = []  # ordered? per open level
	for it in items:
		var depth: int = mini(it[0], open.size())
		while open.size() > depth + 1 or (open.size() == depth + 1 and open[-1] != it[1]):
			s += "[/ol]" if open.pop_back() else "[/ul]"
		if open.size() == depth + 1:
			s += "\n"
		while open.size() < depth + 1:
			s += "[ol type=1]" if it[1] else "[ul]"
			open.append(it[1])
		s += inline(it[2])
	while not open.is_empty():
		s += "[/ol]" if open.pop_back() else "[/ul]"
	return s


static func _is_sep(line: String) -> bool:
	var t := line.strip_edges()
	return t.begins_with("|") and t.replace("|", "").replace("-", "").replace(":", "").strip_edges() == ""


static func _cells(t: String) -> Array:
	var inner := t.trim_prefix("|").trim_suffix("|")
	return Array(inner.split("|")).map(func(c: String) -> String: return c.strip_edges())


static func _table(rows: Array) -> String:
	var cols: int = rows[0].size()
	var s := "[table=%d]" % cols
	for r in rows.size():
		for c in cols:
			var cell: String = rows[r][c] if c < rows[r].size() else ""
			var text := inline(cell)
			s += "[cell padding=4,2,12,2]%s[/cell]" % ("[b]%s[/b]" % text if r == 0 else text)
	return s + "[/table]"
