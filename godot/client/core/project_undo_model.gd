extends RefCounted
## WO-642 — the undo / redo history of project_undo.gd, without the autoloads: whole-document snapshots (strings),
## edits within COALESCE_MS are one step, at most MAX steps.

const MAX := 100
const COALESCE_MS := 600
const BOOKKEEPING := ["rev", "savedAt"]

var cur := ""  # the document as it stands
var _undo: Array[String] = []
var _redo: Array[String] = []
var _last_ms := -COALESCE_MS * 2


static func snapshot(p: Dictionary) -> String:
	var d := p.duplicate()  # shallow: only top-level bookkeeping is dropped
	for k in BOOKKEEPING:
		d.erase(k)
	return canon(d)


## JSON after one parse round trip: every number a float, as a restored (parsed) document has them — so a local int
## and the same value restored compare equal.
static func canon(v: Variant) -> String:
	return JSON.stringify(JSON.parse_string(JSON.stringify(v)))


## The snapshot `s` as a document, carrying `live`'s bookkeeping (the server's rev, or the save is stale).
static func document(s: String, live: Dictionary) -> Variant:
	var p: Variant = JSON.parse_string(s)
	if not p is Dictionary:
		return null
	for k in BOOKKEEPING:
		if live.has(k):
			(p as Dictionary)[k] = live[k]
	return p


func can_undo() -> bool:
	return not _undo.is_empty()


func can_redo() -> bool:
	return not _redo.is_empty()


func clear() -> void:
	_undo.clear()
	_redo.clear()


## A document that did not come from an edit (load, remote sync, restore): the new base, no step.
func rebase(s: String) -> void:
	cur = s
	_last_ms = -COALESCE_MS * 2


## An edit left the document as `s` at `now_ms` → whether a step was recorded (or merged into the last one).
func record(s: String, now_ms: int) -> bool:
	if s == cur:
		return false
	if now_ms - _last_ms > COALESCE_MS or _undo.is_empty():
		_undo.append(cur)
		if _undo.size() > MAX:
			_undo.pop_front()
	_last_ms = now_ms
	_redo.clear()
	cur = s
	return true


## → the snapshot to restore, or "" (nothing to undo).
func undo() -> String:
	if _undo.is_empty():
		return ""
	_redo.append(cur)
	cur = _undo.pop_back()
	_last_ms = -COALESCE_MS * 2  # the next edit is its own step
	return cur


func redo() -> String:
	if _redo.is_empty():
		return ""
	_undo.append(cur)
	cur = _redo.pop_back()
	_last_ms = -COALESCE_MS * 2
	return cur
