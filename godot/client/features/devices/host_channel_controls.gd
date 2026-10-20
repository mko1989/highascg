extends Node
## WO-605 slice 3c — the host-channel page's controller facade (web renderHostChannelDestinationInspector's per-role
## mounts): destinations_panel.gd owns one, injects it into destination_inspector.gd, and the page asks it for the
## controls of the selected host destination. Owner rule (2026-07-26): per-input controls live here, in the
## device-view host-channel inspector, not on the Sources tab. Relays the controllers' status / reload / removed.

signal status(text: String, ok: bool)
signal reload(dirty: bool)
signal removed()

const HostLive := preload("res://features/devices/host_live_controls.gd")
const HostInput := preload("res://features/devices/host_input_controls.gd")
const DM := preload("res://features/devices/destinations_model.gd")
const H := preload("res://features/devices/host_channels.gd")

var _live: Node
var _input: Node


func _init() -> void:
	_live = HostLive.new()
	_input = HostInput.new()
	for c in [_live, _input]:
		add_child(c)
		c.status.connect(func(text: String, ok: bool) -> void: status.emit(text, ok))
		c.reload.connect(func(dirty: bool) -> void: reload.emit(dirty))
		c.removed.connect(func() -> void: removed.emit())


## {top: [Control], bottom: [Control]} — `top` goes right under the summary table, `bottom` after "Cabled to"
## (the web's order). `src` = the extraLiveSources row the page resolved for this destination ({} when none).
func build(entry: Dictionary, payload: Dictionary, settings: Variant, src: Dictionary) -> Dictionary:
	var d: Dictionary = entry.dest
	var role := DM.host_role(d, entry.intent)
	var ch: Variant = H.coalesce([d.get("casparChannel"), H.R.d(entry.intent).get("pgmChannel")])
	var parts: Dictionary = _live.build(role, src, d, payload, settings)
	if parts.is_empty():
		parts = _input.build(role, d, ch, DM.host_entry(payload, role, ch))
	return {"top": parts.get("top", []), "bottom": parts.get("bottom", [])}
