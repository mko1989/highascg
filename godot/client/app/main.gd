extends Control
## WO-599 — client boot, in the web client's order (client/app.js:133-381): settings → state → project,
## then the WebSocket (handlers attached first). The WS `state` snapshot is authoritative on every
## (re)connect; `change`/`project_sync`/`scene.deck` keep the mirror current.

const NetUtil := preload("res://core/net_util.gd")
const ThemeBuilder := preload("res://app/theme_builder.gd")
const Placement := preload("res://app/window_placement.gd")
const Platform := preload("res://core/platform.gd")
const BootQuestion := preload("res://app/boot_question.gd")
const ScreenModel := preload("res://app/operator_screen_model.gd")
const Shell := preload("res://app/shell.gd")
const HardwareReconcile := preload("res://app/hardware_reconcile.gd")
const ClientPrefs := preload("res://core/client_prefs.gd")
const DeckOrder := preload("res://features/devices/decklink_order.gd")
const GpuLayout := preload("res://features/devices/gpu_layout.gd")

var shell: Shell
var hw_reconcile: HardwareReconcile  # WO-608: after each project pull (boot / reconnect)
var boot_log := PackedStringArray()


func _ready() -> void:
	theme = ThemeBuilder.build()
	get_tree().root.theme = theme  # WO-608 R3: popups / tooltips / dialogs too — Rewir is the only font
	if theme.default_font != null:
		ThemeDB.fallback_font = theme.default_font
	var bg := ColorRect.new()
	bg.color = ThemeBuilder.BG_DARK
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	shell = Shell.new()
	add_child(shell)
	shell.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	_apply_window_args()
	hw_reconcile = HardwareReconcile.new()
	hw_reconcile.shell = shell
	add_child(hw_reconcile)
	add_child(preload("res://app/cluster_follow.gd").new())  # WO-670 P3b
	shell.header_project.loaded.connect(hw_reconcile.check_assets)
	_wire_ws()
	await bootstrap()
	ClientPrefs.attach(func() -> Dictionary:  # WO-598 D: GPU rows, DeckLink order, hardware policy shared on the node
		return {"gpuLayout": GpuLayout.local(), "decklinkRearOrder": DeckOrder.local(), "hardwarePolicy": HardwareReconcile.local_policy()})
	Ws.start()
	VideoSurfaces.start()
	if Config.args.has("probe-take"):  # dev: --probe-take=<sceneId>[:program]
		var parts := str(Config.args["probe-take"]).split(":")
		var live_tab: Node = shell.tabs.get_node("Live")
		await live_tab.deck.request_take(parts[0], 0, "program" if parts.size() > 1 else "preview")
	if Config.args.has("probe-rename"):  # dev: --probe-rename=<sceneId>:<new name>
		var kv := str(Config.args["probe-rename"]).split(":", true, 1)
		if not Ws.is_open:
			await Ws.connected
		var lt2: Node = shell.tabs.get_node("Live")
		print("[client] rename ", lt2.deck.rename_look(kv[0], kv[1]))
		await ProjectSync.saved
		print("[client] saved rev ", Store.project.get("rev"))
	if Config.args.has("probe-transition"):  # dev: --probe-transition=<sceneId>:<TYPE>:<frames> (WO-600 I)
		var tp := str(Config.args["probe-transition"]).split(":")
		if not Ws.is_open:
			await Ws.connected
		var lt3: Node = shell.tabs.get_node("Live")
		print("[client] transition ", lt3.deck.set_look_transition(tp[0], {"type": tp[1], "duration": int(tp[2])}))
		await ProjectSync.saved
		print("[client] saved rev ", Store.project.get("rev"))
	if Config.args.has("probe-hw-reconcile"):  # dev: the reconcile dialog over a fake foreign-machine report
		hw_reconcile.run({"prompt": true, "severity": "hard", "sameMachine": false, "projectName": "Probe show",
			"items": [{"section": "Device graph", "message": "Connector count differs (3 in project vs 1 live).", "severity": "hard"},
				{"section": "Screen destinations", "message": "Destination count differs (2 saved vs 1 live).", "severity": "soft"}]})
	if Config.args.has("probe-lt"):  # dev: the lower-third inspector on a fake layer (WO-675 presenter picks)
		var dlg := AcceptDialog.new()
		var sec: Node = preload("res://features/live/lower_third_section.gd").new()
		dlg.add_child(sec)
		add_child(dlg)
		dlg.popup_centered(Vector2i(700, 600))
		sec.show_layer("probe", 0, {"layerNumber": 99, "source": {"type": "template", "value": "lower-thirds/lt-classic-box"}})
	if Config.args.has("probe-snapshot-load"):  # dev: the Load device snapshot dialog (its entry is WO-608's)
		shell.tabs.get_node("Devices").snapshots.open_load()
	if Config.args.has("probe-edit"):  # dev: --probe-edit=<sceneId> opens the look editor (WO-600 F)
		if not Ws.is_open:
			await Ws.connected
		shell.tabs.get_node("Live").editor.open(str(Config.args["probe-edit"]), 0)
		if Config.args.has("probe-inspect"):  # dev: --probe-inspect=<layer index> → fit canvas, mute, fader 50 % (WO-601)
			await get_tree().create_timer(1.5).timeout
			var ed2: Node = shell.tabs.get_node("Live").editor
			ed2._select(int(Config.args["probe-inspect"]))
			await get_tree().create_timer(0.8).timeout
			var ins: Node = ed2._inspector
			await ins._on_fit(1)
			(ins._w.mute as CheckBox).button_pressed = true
			(ins._w.vol as HSlider).value = 50
			print("[client] inspected layer ", ed2._sel)
		if Config.args.has("probe-effect"):  # dev: --probe-effect=<layer index>[:<seed effects JSON>] (WO-601)
			# seed (or keep) → +brightness, brightness 1.4, +levels, −brightness → restore the seed
			await get_tree().create_timer(1.5).timeout
			var pe := str(Config.args["probe-effect"]).split(":", true, 1)
			var ed3: Node = shell.tabs.get_node("Live").editor
			ed3._select(int(pe[0]))
			var seed: Array = JSON.parse_string(pe[1]) if pe.size() > 1 else (ed3._layers()[ed3._sel].get("effects", []) as Array).duplicate(true)
			ed3._apply_layer({"effects": seed.duplicate(true)})
			await get_tree().create_timer(1.0).timeout
			var fx: Node = ed3._inspector._fx
			var types: Array = fx._registry.map(func(d: Dictionary) -> String: return d.type)
			var card := func(t: String) -> Node:  # card order = effects order
				var k: int = (ed3._layers()[ed3._sel].effects as Array).map(func(e: Dictionary) -> String: return e.type).find(t)
				return fx._list.get_child(k)
			fx._add.item_selected.emit(types.find("brightness") + 1)
			await get_tree().create_timer(0.8).timeout
			(card.call("brightness").find_children("*", "SpinBox", true, false)[0] as SpinBox).value = 1.4
			await get_tree().create_timer(0.8).timeout
			fx._add.item_selected.emit(types.find("levels") + 1)
			await get_tree().create_timer(0.8).timeout
			print("[client] effects ", ed3._layers()[ed3._sel].get("effects"))
			(card.call("brightness").find_children("*", "Button", true, false).filter(func(b: Button) -> bool: return b.text == "✕")[0] as Button).pressed.emit()
			await get_tree().create_timer(1.2).timeout
			print("[client] effects after remove ", ed3._layers()[ed3._sel].get("effects"))
			ed3._apply_layer({"effects": seed})
			await get_tree().create_timer(1.2).timeout
			print("[client] effects restored ", ed3._layers()[ed3._sel].get("effects"))
		if Config.args.has("probe-pip"):  # dev: --probe-pip=<layer index> → +border, width 9, +shadow, shadow behind, −border, restore (WO-601)
			await get_tree().create_timer(1.5).timeout
			var ed4: Node = shell.tabs.get_node("Live").editor
			ed4._select(int(Config.args["probe-pip"]))
			var before: Variant = (ed4._layers()[ed4._sel] as Dictionary).get("pipOverlays", [])
			await get_tree().create_timer(1.0).timeout
			var pip: Node = ed4._inspector._pip
			var pt: Array = pip._registry.map(func(d: Dictionary) -> String: return d.type)
			var step := func(label: String) -> void:
				await get_tree().create_timer(1.5).timeout
				print("[client] pip ", label, " ", ed4._layers()[ed4._sel].get("pipOverlays"))
			pip._add.item_selected.emit(pt.find("border") + 1)
			await step.call("+border")
			(pip._cards.get_child(0).find_children("*", "SpinBox", true, false)[0] as SpinBox).value = 9
			await step.call("width 9")
			pip._add.item_selected.emit(pt.find("shadow") + 1)
			await step.call("+shadow")
			(pip._cards.get_child(1).find_children("*", "Button", true, false).filter(func(b: Button) -> bool: return b.text == "↑")[0] as Button).pressed.emit()
			await step.call("shadow behind")
			(pip._cards.get_child(1).find_children("*", "Button", true, false).filter(func(b: Button) -> bool: return b.text == "✕")[0] as Button).pressed.emit()
			await step.call("-border")
			ed4._apply_layer({"pipOverlays": before})
			await step.call("restored")
		if Config.args.has("probe-cg"):  # dev: --probe-cg → LT layer: title, Play, Play (out), Delete; timers layer: compact, Reload; both removed (WO-601)
			await get_tree().create_timer(1.5).timeout
			var ed5: Node = shell.tabs.get_node("Live").editor
			var lts: Node = ed5._inspector._lt
			var wait := func(s: float, label: String) -> void:
				await get_tree().create_timer(s).timeout
				print("[client] cg ", label, " | ", lts._status.text if is_instance_valid(lts._status) else "")
			await ed5.add_layer_from_source({"type": "template", "value": "lower-thirds/lt-classic-box", "label": "Classic Box"})
			await wait.call(2.0, "lt added")
			var le := lts.find_children("*", "LineEdit", true, false)[0] as LineEdit
			le.text = "Jan Kowalski"
			le.text_changed.emit(le.text)
			await wait.call(1.2, "title typed, cgData.name=%s" % ed5._layers()[ed5._sel].get("cgData", {}).get("name"))
			var btn := func(t: String) -> void: (lts.find_children("*", "Button", true, false).filter(func(b: Button) -> bool: return b.text == t)[0] as Button).pressed.emit()
			btn.call("▶ Play")
			await wait.call(2.5, "play")
			btn.call("▶ Play")
			await wait.call(2.5, "play again")
			btn.call("Delete")
			await wait.call(1.5, "delete")
			ed5._remove_layer()
			await wait.call(1.5, "lt layer removed")
			await ed5.add_layer_from_source({"type": "template", "value": "playback_timers.html", "label": "Timers"})
			await get_tree().create_timer(2.0).timeout
			var tps: Node = ed5._inspector._tpl
			var compact := tps.find_children("*", "CheckBox", true, false).filter(func(c: CheckBox) -> bool: return c.text == "Compact mode")[0] as CheckBox
			compact.button_pressed = true
			await get_tree().create_timer(1.5).timeout
			print("[client] cg timersConfig ", ed5._layers()[ed5._sel].source.get("timersConfig"))
			(tps.find_children("*", "Button", true, false).filter(func(b: Button) -> bool: return b.text == "Reload page")[0] as Button).pressed.emit()
			await get_tree().create_timer(1.5).timeout
			print("[client] cg reload | ", tps._status.text)
			ed5._remove_layer()
			await get_tree().create_timer(1.5).timeout
			print("[client] cg done, layers ", ed5._layers().map(func(l: Dictionary) -> int: return int(l.layerNumber)))
		if Config.args.has("probe-countdown"):  # dev: --probe-countdown → add, 1 min, Start/Pause/Reset, re-take PRV, remove layer + timer (WO-601)
			await get_tree().create_timer(1.5).timeout
			var ed6: Node = shell.tabs.get_node("Live").editor
			var cds: Node = ed6._inspector._cd
			await ed6.add_layer_from_source({"type": "template", "value": "countdown/countdown", "label": "Countdown"})
			await get_tree().create_timer(2.5).timeout
			print("[client] cd timer ", cds._timer_id, " bound ", ed6._layers()[ed6._sel].source.get("countdownTimerId"))
			(cds._w.m as SpinBox).value = 1
			(cds._w.h as SpinBox).value = 0
			await get_tree().create_timer(1.2).timeout
			print("[client] cd durationSec ", ed6._layers()[ed6._sel].get("cgData", {}).get("durationSec"))
			for b in ["Start", "Pause", "Reset"]:
				(cds.find_children("*", "Button", true, false).filter(func(x: Button) -> bool: return x.text == b)[0] as Button).pressed.emit()
				await get_tree().create_timer(1.0).timeout
				print("[client] cd ", b, " | ", cds._status.text)
			await shell.tabs.get_node("Live").deck.request_take(ed6.scene_id, 0, "preview")
			await get_tree().create_timer(2.0).timeout
			var tid: String = cds._timer_id
			ed6._remove_layer()
			var tl: Array = (Store.project.scenes as Dictionary).get("timers", [])
			for i in range(tl.size() - 1, -1, -1):
				if str(tl[i].get("id", "")) == tid:
					tl.remove_at(i)
			ProjectSync.mark_dirty()
			await get_tree().create_timer(4.0).timeout
			print("[client] cd done, layers ", ed6._layers().map(func(l: Dictionary) -> int: return int(l.layerNumber)), " timers ", tl.size())
		if Config.args.has("probe-roster"):  # dev: --probe-roster=<sheet path> → LT layer, import, pick row 2, Play, Delete, remove (WO-601)
			await get_tree().create_timer(1.5).timeout
			var ed8: Node = shell.tabs.get_node("Live").editor
			await ed8.add_layer_from_source({"type": "template", "value": "lower-thirds/lt-classic-box", "label": "Classic Box"})
			await get_tree().create_timer(2.0).timeout
			var lt8: Node = ed8._inspector._lt
			var rs: Node = lt8.find_children("*", "VBoxContainer", true, false).filter(func(n: Node) -> bool: return n.has_method("import_file"))[0]
			print("[client] roster import ", await rs.import_file(str(Config.args["probe-roster"])), " | ", rs._meta.text)
			await get_tree().create_timer(0.8).timeout
			print("[client] roster stored ", ed8._layers()[ed8._sel].source.get("lowerThirdRoster", {}).get("mapping"))
			var items: Array = (rs._table.get_root() as TreeItem).get_children()
			(items[1] as TreeItem).select(0)
			await get_tree().create_timer(0.8).timeout
			print("[client] roster picked → cgData ", ed8._layers()[ed8._sel].cgData.name, " / ", ed8._layers()[ed8._sel].cgData.title)
			lt8._act("play")
			await get_tree().create_timer(2.5).timeout
			lt8._act("clear")
			await get_tree().create_timer(1.5).timeout
			ed8._remove_layer()
			await get_tree().create_timer(1.5).timeout
			print("[client] roster done, layers ", ed8._layers().map(func(l: Dictionary) -> int: return int(l.layerNumber)))
		if Config.args.has("probe-style"):  # dev: --probe-style → layer 2 backup copy, preset from layer 1 → applied to 2, backup pasted, preset removed (WO-601)
			await get_tree().create_timer(1.5).timeout
			var ed9: Node = shell.tabs.get_node("Live").editor
			var st: Node = ed9._inspector._style
			ed9._select(1)
			await get_tree().create_timer(0.6).timeout
			var before := NetUtil.to_json(ed9._layers()[1])
			st._btn_named("Copy").pressed.emit()
			ed9._select(0)
			await get_tree().create_timer(0.6).timeout
			var pid: String = st.save_preset("probe style")
			ed9._select(1)
			await get_tree().create_timer(0.6).timeout
			st._presets.item_selected.emit(st._presets.item_count - 1)
			await get_tree().create_timer(1.5).timeout
			print("[client] style applied: L11 fill ", ed9._layers()[1].fill, " effects ", ed9._layers()[1].get("effects"), " | ", ed9._status.text)
			st._btn_named("Paste").pressed.emit()
			await get_tree().create_timer(1.5).timeout
			var list: Array = Store.project.scenes.layerPresets
			for i in range(list.size() - 1, -1, -1):
				if str(list[i].id) == pid:
					list.remove_at(i)
			ProjectSync.deck_changed()
			ProjectSync.mark_dirty()
			await get_tree().create_timer(4.0).timeout
			print("[client] style restored: L11 fill ", ed9._layers()[1].fill, " effects ", ed9._layers()[1].get("effects"), " presets ", list.size())
			print("[client] style before ", before)
			print("[client] style after  ", NetUtil.to_json(ed9._layers()[1]))
		if Config.args.has("probe-add-media"):  # dev: --probe-add-media=<media id> (drop equivalent)
			await get_tree().create_timer(1.5).timeout
			var ed: Node = shell.tabs.get_node("Live").editor
			print("[client] add layer ", await ed.add_layer_from_source({"type": "media", "value": str(Config.args["probe-add-media"])}))
	if Config.args.has("probe-media"):  # dev: --probe-media=<local media id> → inspector sets in 1.5 s, out 0:40, mute (WO-601)
		await get_tree().create_timer(2.5).timeout
		var ins2: Node = shell.tabs.get_node("Live").find_children("*", "VBoxContainer", true, false).filter(func(n: Node) -> bool: return n.has_method("show_media"))[0]
		await ins2.show_media({"id": str(Config.args["probe-media"]), "type": "MOVIE", "fps": 50, "durationMs": 60000})
		ins2._in.text = "1.5"
		ins2._in.text_submitted.emit("1.5")
		await get_tree().create_timer(0.6).timeout
		ins2._out.text = "0:40"
		ins2._out.text_submitted.emit("0:40")
		await get_tree().create_timer(0.6).timeout
		ins2._mute.button_pressed = true
		await get_tree().create_timer(0.6).timeout
		print("[client] media defaults ", ins2._defaults, " usage ", ins2._usage.size())
	if Config.args.has("probe-timers"):  # dev: --probe-timers=<main> → add, start, pause, px, fade in, opacity, fade out, remove (WO-601)
		if not Ws.is_open:
			await Ws.connected
		await get_tree().create_timer(1.5).timeout
		var lt7: Node = shell.tabs.get_node("Live")
		lt7.deck.timers_requested.emit(int(Config.args["probe-timers"]), "Main")
		await get_tree().create_timer(1.5).timeout
		var tp: Node = lt7.timers
		await tp._add_timer()
		var rec: Dictionary = tp._records[0]
		print("[client] timers added ", rec.timerId, " name ", rec.get("name"), " screens ", rec.get("screens"))
		await tp._post("/api/timers/cmd", {"timerId": rec.timerId, "cmd": "start"})
		await get_tree().create_timer(2.2).timeout
		print("[client] timers running readout ", tp._readouts[rec.timerId].text)
		await tp._post("/api/timers/cmd", {"timerId": rec.timerId, "cmd": "pause"})
		await tp._apply(tp._records[0], {"posX": 100, "posY": 50})
		await tp._visible(rec.timerId, true, 25)
		await get_tree().create_timer(1.2).timeout
		await tp._visible(rec.timerId, true, 0, 0.5)
		await tp._visible(rec.timerId, false, 25)
		await get_tree().create_timer(1.2).timeout
		print("[client] timers before remove ", tp._records[0].screens, " readout ", tp._readouts[rec.timerId].text)
		await tp._post("/api/timers/unassign", {"timerId": rec.timerId, "screenIdx": int(Config.args["probe-timers"])})
		print("[client] timers after remove ", tp._records.size())
	if Config.args.has("probe-versions"):  # dev: --probe-versions=<library path>|<new file> → upload, go back, purge (WO-601)
		var pv := str(Config.args["probe-versions"]).split("|")
		await get_tree().create_timer(2.5).timeout
		var mi: Node = shell.tabs.get_node("Live").find_children("*", "VBoxContainer", true, false).filter(func(n: Node) -> bool: return n.has_method("show_media"))[0]
		var entry := func() -> Dictionary:
			var r: Dictionary = await Api.get_json("/api/media/library/entry?path=%s" % pv[0].uri_encode())
			return r.data.entry if r.ok else {}
		await mi.show_media({"id": pv[0], "type": "MOVIE", "fps": 25, "durationMs": 2000})
		var vs: Node = mi._versions
		print("[client] versions upload ", await vs.upload(pv[1]), " | ", vs._msg.text)
		if pv.size() > 2:  # stop after the upload (byte check from the shell)
			return
		var e1: Dictionary = await entry.call()
		print("[client] versions after upload current v", e1.get("currentV"), " size ", e1.get("size"), " old ", e1.get("versions"))
		await vs._restore(1)
		var e2: Dictionary = await entry.call()
		print("[client] versions after go-back current v", e2.get("currentV"), " size ", e2.get("size"), " old ", (e2.get("versions", []) as Array).map(func(v: Dictionary) -> int: return int(v.v)))
		for v in e2.get("versions", []):
			await vs._purge(int(v.v))
		var e3: Dictionary = await entry.call()
		print("[client] versions after purge current v", e3.get("currentV"), " old ", e3.get("versions"), " rows ", vs._list.get_child_count())
	if Config.args.has("probe-border"):  # dev: --probe-border=<main> → enable, width, glow, slice, preset save/recall, mirror on/off, remove (WO-601)
		if not Ws.is_open:
			await Ws.connected
		await get_tree().create_timer(1.5).timeout
		var lt9: Node = shell.tabs.get_node("Live")
		lt9.deck.border_requested.emit(int(Config.args["probe-border"]), "Main")
		await get_tree().create_timer(1.0).timeout
		var bp: Node = lt9.border
		var step := func(label: String, patch: Dictionary, now: bool) -> void:
			await bp.send(patch, now, true)
			await get_tree().create_timer(0.9).timeout
			var gb: Variant = bp.slot()
			print("[client] border %s | %s | %s" % [label, bp._status.text, "null" if gb == null else "%s %s L%s mirror=%s slices=%d presets=%d" % [
				gb.get("enabled"), gb.get("type"), gb.get("activePgmLayer"), gb.get("mirrorBorderOnPrv"), (gb.get("slices", []) as Array).size(), (gb.get("borderPresets", []) as Array).size()]])
		await step.call("enable", {"enabled": true}, true)
		await step.call("width 12", {"params": {"width": 12}}, false)
		await step.call("glow", {"type": "glow"}, true)
		await step.call("slice", {"slices": [{"x": 0, "y": 0, "w": 0.5, "h": 1}]}, true)
		await step.call("save preset 1", {"savePreset": {"slot": 1, "name": "probe"}}, true)
		await step.call("border", {"type": "border"}, true)
		await step.call("recall 1", {"preset": 1}, true)
		await step.call("mirror on", {"mirrorBorderOnPrv": true}, true)
		await step.call("mirror off", {"mirrorBorderOnPrv": false}, true)
		await step.call("remove", {"clear": true}, true)
	if Config.args.has("probe-border-artnet"):  # dev: --probe-border-artnet=<main> → enable + listen, watch desk sync, colour rows off, remove (WO-601)
		if not Ws.is_open:
			await Ws.connected
		await get_tree().create_timer(1.0).timeout
		var lt10: Node = shell.tabs.get_node("Live")
		lt10.deck.border_requested.emit(int(Config.args["probe-border-artnet"]), "Main")
		await get_tree().create_timer(0.8).timeout
		var bpa: Node = lt10.border
		var show := func(label: String) -> void:
			var gb: Variant = bpa.slot()
			print("[client] artnet %s | %s" % [label, "null" if gb == null else "listen=%s on=%s type=%s opacity=%s color=%s width=%s" % [gb.get("artnetListenEnabled"),
				gb.get("enabled"), gb.get("type"), gb.params.get("opacity"), gb.params.get("color"), gb.params.get("width")]])
		await bpa.send({"enabled": true, "params": {"color": "#e63946", "width": 4, "opacity": 1}}, true, true)
		await bpa.send({"artnetListenEnabled": true, "artnetPatch": {"startChannel": 1, "universe": 0}}, true, true)
		show.call("ready")
		await get_tree().create_timer(3.0).timeout
		show.call("desk on")
		var m: Array = []
		for i in 18:
			m.append(i < 3 or i > 5)
		await bpa.send({"artnetChannelMap": m, "params": {"color": "#e63946"}}, true, true)
		await get_tree().create_timer(2.5).timeout
		show.call("colour rows off")
		print("[client] artnet fixture saved ", await bpa._body.find_children("*", "VBoxContainer", true, false).filter(func(n: Node) -> bool: return n.has_method("save_fixture_to"))[0].save_fixture_to("user://gb-fixture.txt"))
		await bpa.send({"clear": true}, true, true)
		show.call("removed")
	if Config.args.has("probe-ftb"):  # dev: --probe-ftb=<main>
		var lt: Node = shell.tabs.get_node("Live")
		await lt.deck.request_ftb(int(Config.args["probe-ftb"]), Store.get_value("channelMap", {}))
	if Config.args.has("probe-perf"):  # dev: render-time probe (WO-617)
		add_child(preload("res://app/perf_probe.gd").new())
	if Config.args.has("quit-after"):
		get_tree().create_timer(float(Config.args["quit-after"])).timeout.connect(_finish)


func bootstrap() -> void:
	_log("server %s" % Config.origin)
	var ok: bool = await Settings.load_from_server()
	_log("settings %s" % ("ok" if ok else "FAILED"))
	var st: Dictionary = await Api.get_json("/api/state")
	if st.ok:
		Store.set_state(st.data)
	_log("state %s" % ("ok" if st.ok else st.error))
	var pr: Dictionary = await Api.get_json("/api/project")
	if pr.ok:
		Store.set_project(pr.data)
		hw_reconcile.after_pull()
	_log("project %s (%d looks)" % ["ok" if pr.ok else pr.error, look_count()])


func _wire_ws() -> void:
	Ws.on("state", func(d: Variant) -> void: Store.set_state(d))
	Ws.on("change", _on_change)
	Ws.on("timeline.playback", func(pb: Variant) -> void: Store.apply_change("timeline.playback", pb))  # web app-ws-handlers
	Ws.on("project_sync", func(d: Variant) -> void:
		if ProjectSync.accept_remote_sync():  # skip exactly one echo of our own save (WO-329B)
			Store.set_project(d))
	Ws.on("connect", _on_ws_connect)
	Ws.on("disconnect", func(_d: Variant) -> void: _log("ws disconnected"))


var _ws_connects := 0


## Like client/lib/server-project-sync.js resyncFromServer: after a RE-connect the server may hold
## edits made while we were offline → re-pull settings + project (state arrives as a WS snapshot).
func _on_ws_connect(_d: Variant) -> void:
	_ws_connects += 1
	_log("ws connected" if _ws_connects == 1 else "ws reconnected — resync")
	if _ws_connects > 1:
		await Settings.load_from_server()
		var pr: Dictionary = await Api.get_json("/api/project")
		if pr.ok:
			Store.set_project(pr.data)
			hw_reconcile.after_pull()


func _on_change(d: Variant) -> void:
	if not (d is Dictionary) or not (d as Dictionary).has("path"):
		return
	var path := str(d["path"])
	Store.apply_change(path, d.get("value"))
	if path == "scene.live" and Store.note_scene_live_seq(d.get("seq")):
		_log("scene.live seq gap — re-pulling state")
		var st: Dictionary = await Api.get_json("/api/state")
		if st.ok:
			Store.set_state(st.data)
	if path == "scene.deck" and d.get("value") is Dictionary:
		var snaps: Variant = (d["value"] as Dictionary).get("sceneSnapshots")
		if snaps is Array:
			Store.upsert_deck_scenes(snaps)


func look_count() -> int:
	var sc: Variant = Store.project.get("scenes")
	return ((sc as Dictionary).get("scenes", []) as Array).size() if sc is Dictionary else 0


func look_names() -> Array:
	var sc: Variant = Store.project.get("scenes")
	var out := []
	if sc is Dictionary:
		for s in (sc as Dictionary).get("scenes", []):
			out.append(str((s as Dictionary).get("name", "")))
	return out


## WO-599 T4: --screen wins; otherwise the server's operator monitor (GET /api/system/operator-display). The UI scale
## follows that screen's size (4K → 2×) unless ui.cfg [window] ui_scale or --ui-scale sets it.
func _apply_window_args() -> void:
	var w := get_window()
	var fresh := false
	if Config.args.has("screen"):
		w.current_screen = int(Config.args["screen"])
	elif Platform.is_local_origin(Config.origin):  # WO-686: off-box the box's operator monitor is not one of ours
		var res: Dictionary = await Api.get_json("/api/system/operator-display")
		var screens := []
		for i in DisplayServer.get_screen_count():
			screens.append(Rect2i(DisplayServer.screen_get_position(i), DisplayServer.screen_get_size(i)))
		var outs: Dictionary = await Api.get_json("/api/system/operator-screen")  # live places, by output name
		var rect: Variant = Placement.live_rect(res.data.get("rect") if res.ok and res.data is Dictionary else null, outs.data.get("outputs") if outs.ok and outs.data is Dictionary else null)
		var i := Placement.pick_screen(rect, screens)
		if i >= 0 and i != w.current_screen:
			w.current_screen = i
			_log("operator monitor: screen %d" % i)
		elif res.ok and ScreenModel.should_auto_open(rect, null, screens.size()):
			fresh = true
	var override := float(Config.args.get("ui-scale", Placement.saved_scale()))
	Placement.fit(w, Platform.is_local_origin(Config.origin), override)
	if Config.args.has("fullscreen"):
		w.mode = Window.MODE_EXCLUSIVE_FULLSCREEN
	_screen_question(fresh)


## WO-638 / WO-645: the start-up questions (app/boot_question.gd).
func _screen_question(fresh: bool) -> void:
	var q := BootQuestion.new()
	add_child(q)
	q.said.connect(_log)
	q.ask(fresh)


func _log(line: String) -> void:
	boot_log.append(line)
	print("[client] ", line)
	if shell != null:
		shell.set_status_line(line)


func _finish() -> void:
	if Config.args.has("screenshot"):
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png(str(Config.args["screenshot"]))
	print("[client] SUMMARY ", JSON.stringify({
		"ws_open": Ws.is_open, "ws_messages": Ws.messages_received, "looks": look_count(),
		"state_keys": Store.state.size(), "settings_loaded": Settings.is_loaded,
		"video_native": VideoSurfaces.is_native(), "look_names": look_names(),
		"video_lease_ok": VideoSurfaces.leasing, "saves_ok": ProjectSync.saves_ok, "deck_syncs": ProjectSync.deck_syncs_sent, "project_rev": Store.project.get("rev"), "surfaces_announced": VideoSurfaces.descriptors.size(), "held_roles": VideoSurfaces.holders.roles(),
	}))
	get_tree().quit()
