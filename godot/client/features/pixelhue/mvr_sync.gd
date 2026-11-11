extends RefCounted
## WO-1039 MVR — the autosave queue of PixelHue Studio's public/mvr-sync.js as a pure state machine (no timers, no
## autoloads): the panel feeds it the clock (ms) and does the one awaited write itself.
##   schedule(now)  — an edit happened: send after DELAY_MS (typing/keys coalesce; a drag end uses delay 0)
##   is_due(now)    — the panel's _process asks; then it calls begin()
##   begin(pending, can_send) → epoch (≥ 0: send `pending` now) or -1 (nothing / already running / failed / blocked)
##   finish(epoch, error) → true when the answer still belongs to the current state (not reset since)
##   follow_up(pending, can_send) → true when newer edits arrived meanwhile: schedule(now, 0)
##   retry() / reset() — Retry save; a new layout adopted (answers of older requests are ignored)
## One request in flight; a failure stops the queue until retry().

const DELAY_MS := 100

var due := -1
var running := false
var failure := ""
var generation := 0


func schedule(now: int, delay: int = DELAY_MS) -> void:
	due = -1
	if failure != "":
		return
	due = now + delay


func is_due(now: int) -> bool:
	return due >= 0 and now >= due


func begin(pending: Array, can_send: bool) -> int:
	due = -1
	if running or failure != "" or not can_send or pending.is_empty():
		return -1
	running = true
	return generation


func finish(epoch: int, error: String) -> bool:
	running = false
	var current := epoch == generation
	if current and error != "":
		failure = error
	return current


func follow_up(pending: bool, can_send: bool) -> bool:
	return failure == "" and pending and can_send


func retry() -> void:
	failure = ""


func reset() -> void:
	generation += 1
	due = -1
	failure = ""


func has_error() -> bool:
	return failure != ""
