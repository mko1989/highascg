extends RefCounted
## WO-1039 — the live geometry queue, pure (a port of Studio's public/program-sync.js as a state machine the panel
## drives): one request in flight, only the newest pending window per layer kept, at most one request every 40 ms,
## urgent (release / commit / numeric Enter) sends as soon as the running request finishes. A failed write stops the
## queue until retry(); reset() drops everything (a refresh that discards edits).
##
## The panel: put(change, urgent) → pump(): take(now_ms, can_send) gives the batch to POST to programming/geometry
## (empty = nothing now; wait_ms(now) says when to look again) → after the answer complete(epoch, ok, error) returns
## the changes the device accepted.

var interval_ms := 40
var epoch := 0
var pending := {}  # "screenId:id" → {change, revision}
var running := false
var failure := ""
var urgent := false
var last_sent := -1000000
var _revision := 0
var _sent: Array = []  # [{key, revision, change}] of the request in flight
var _sent_epoch := -1


static func key_of(change: Dictionary) -> String:
	return "%d:%d" % [int(change.get("screenId", 0)), int(change.get("id", 0))]


var dirty: bool:
	get:
		return not pending.is_empty()

var saving: bool:
	get:
		return running


func put(change: Dictionary, now_urgent := false) -> void:
	_revision += 1
	pending[key_of(change)] = {"change": change.duplicate(true), "revision": _revision}
	urgent = urgent or now_urgent


## Ask for the next send as soon as possible (release / Enter / drain).
func force() -> void:
	urgent = true


## ms until a batch may go (0 = now); -1 = nothing to wait for (empty, running, failed or blocked).
func wait_ms(now_ms: int, can_send := true) -> int:
	if failure != "" or running or pending.is_empty() or not can_send:
		return -1
	return 0 if urgent else maxi(0, interval_ms - (now_ms - last_sent))


## The batch to send now (and the queue marks it in flight), or [] when it must wait.
func take(now_ms: int, can_send := true) -> Array:
	if wait_ms(now_ms, can_send) != 0:
		return []
	_sent = []
	var changes: Array = []
	for k in pending:
		var item: Dictionary = pending[k]
		_sent.append({"key": k, "revision": item.revision, "change": item.change})
		changes.append(item.change.duplicate(true))
	running = true
	_sent_epoch = epoch
	urgent = false
	last_sent = now_ms
	return changes


## The answer for the batch taken under `sent_epoch`. → the accepted changes (those not superseded while in flight).
func complete(sent_epoch: int, ok: bool, error := "") -> Array:
	running = false
	var accepted: Array = []
	if sent_epoch != epoch:
		_sent = []
		return accepted
	if not ok:
		failure = error if error != "" else "The switcher did not accept the position."
		_sent = []
		return accepted
	for s in _sent:
		var now: Variant = pending.get(s.key)
		if now is Dictionary and int(now.revision) == int(s.revision):
			pending.erase(s.key)
			accepted.append(s.change)
	_sent = []
	return accepted


func retry() -> void:
	failure = ""
	urgent = true


func reset() -> void:
	epoch += 1
	pending.clear()
	failure = ""
	urgent = false


## Header line (Studio's program-save-status).
func status_text() -> String:
	if failure != "":
		return "Not saved"
	if running or not pending.is_empty():
		return "Sending…"
	return "Live · saved"
