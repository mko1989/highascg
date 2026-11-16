extends VBoxContainer
## WO-1093 — Settings → System → Hardware (was the lower half of the System pane; web settings-modal-mount-hardware.js,
## WO-189): GET /api/system/hardware sections (processor, memory, disks, GPU, DeckLink, audio, network, OS). Read when
## the fold opens — the request takes ~4 s on the box (lsblk / nvidia-smi / ALSA probes).

const K := preload("res://features/settings/pane_kit.gd")
const M := preload("res://features/settings/system_model.gd")

var _hw: VBoxContainer


func _ready() -> void:
	add_theme_constant_override("separation", 8)
	K.heading(self, "Hardware")
	K.button(self, "Refresh hardware", refresh)
	_hw = VBoxContainer.new()
	_hw.add_theme_constant_override("separation", 6)
	add_child(_hw)
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree() and _hw.get_child_count() == 0:
			refresh())


func refresh() -> void:
	if _hw.get_child_count() == 0:
		K.note(_hw, "Loading hardware…")
	var hw: Dictionary = await Api.get_json("/api/system/hardware")
	for c in _hw.get_children():
		c.queue_free()
	if hw.ok and hw.data is Dictionary:
		for sec in M.hardware_sections(hw.data):
			K.heading(_hw, sec[0]).add_theme_font_size_override("font_size", 15)
			K.fill_grid(K.grid(_hw), sec[1])
	else:
		K.note(_hw, "Hardware summary unavailable: %s" % str(hw.error))
