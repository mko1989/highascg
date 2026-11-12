extends RefCounted
## The Visuals tab's Send once it is on air: WO-914 replays it when Caspar's AMCP link comes back (moved out of
## visuals_tab.gd, 500-line limit); WO-919 F11 ends it when the server clears the show (a New project). WO-1049: both cover
## output 2 too (visuals_route.gd: the keyed overlay's own ring and PLAY).

const M := preload("res://features/visuals/visuals_model.gd")
const REPLAY_S := 3.0


## WO-914: a Caspar restart (a crash, an Apply, the supervisor's CEF retry) drops the PLAY of the shm layer while the tab
## still sends, and nothing played it again: the output stayed dark until Send was toggled. When the AMCP link comes back,
## PLAY it again after node's own restore of the looks (REPLAY_S) — the ring never stopped, Caspar takes it at once.
static func caspar_link(tab, up: bool) -> void:
	var back: bool = up and not tab._caspar_up
	tab._caspar_up = up
	if not back or tab.sending.is_empty():
		return
	if tab.is_inside_tree():
		await tab.get_tree().create_timer(REPLAY_S).timeout
	if tab.sending.is_empty() or not tab._caspar_up:
		return
	var api: Variant = tab.replay_api if tab.replay_api != null else tab._g("DevicesTarget").box_api
	var r: Dictionary = await api.post_json("/api/play", M.play_body(int(tab.sending.channel), int(tab.sending.layer), tab.ring_name))
	print("[visuals] Caspar reconnected: Send again to %d-%d — %s" % [tab.sending.channel, tab.sending.layer, "ok" if r.ok else str(r)])
	if tab.route != null:
		await tab.route.replay()


## WO-919 F11: the server took the old show off PGM / PRV (POST /api/project/new → change `show.cleared`), CLEAR included
## the shm layer this tab sent — so Send is over: no WS replay when Caspar restarts, no resume by the on-air marker. No STOP
## is posted: the channel numbers belong to the new show. True when it was sending.
static func show_cleared(tab, d: Variant) -> bool:
	if not d is Dictionary or str(d.get("path", "")) != "show.cleared" or tab.sending.is_empty():
		return false
	tab.sending = {}
	if tab.route != null:
		tab.route.end()  # before _sync_send_ui: its route.sync() must not STOP a channel of the new show
	tab._on_air_mark({})
	tab._sync_ring()
	tab._sync_send_ui("")
	return true
