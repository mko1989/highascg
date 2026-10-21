extends RefCounted
## WO-608 slice 1 — the Defaults, Companion and Media / USB panes (web settings-modal-templates.js, hydrate /
## buildSettingsPayload in settings-modal-logic.js, editor-defaults.js). Built on settings_form.gd rows.

const Placement := preload("res://app/window_placement.gd")
const ScreenPicker := preload("res://app/operator_screen_picker.gd")
const Form := preload("res://features/settings/settings_form.gd")
const AboutModel := preload("res://features/settings/about_model.gd")
const T := preload("res://features/live/transitions.gd")

const FITS := [["native", "Native (1:1 px)"], ["fill-canvas", "Fit canvas"], ["horizontal", "Fill width"],
	["vertical", "Fill height"], ["stretch", "Stretch"]]


static func defaults(f: Form, fps: Callable) -> void:
	f.heading("Layer position")
	f.option("Coordinate origin (0,0)", "editorDefaults.coordinateOrigin",
		[["topLeft", "Top-left — canvas and layer box"], ["center", "Center — screen and layer box"]], "topLeft")
	f.note("Center mode: X/Y in the look editor, timeline inspector and position keyframes are offsets from the screen "
		+ "center. Playout and saved projects still use top-left fill.")
	f.heading("Scene — dropping media onto a look")
	f.check("Loop media on new layers", "editorDefaults.scene.loop", false)
	f.option("Start playback", "editorDefaults.scene.startBehaviour",
		[["beginning", "Start from beginning (trim in)"], ["relativeToPrevious", "Continue from previous play on this layer"]],
		"beginning")
	f.option("Content sizing", "editorDefaults.scene.contentFit", FITS, "native")
	f.heading("Timeline — new clips")
	f.check("Loop always", "editorDefaults.timeline.loopAlways", false)
	f.option("Content sizing", "editorDefaults.timeline.contentFit", FITS, "native")
	f.heading("Default transition (new looks)")
	var types := []
	for t in T.TYPES:
		types.append([t, T.LABELS.get(t, t)])
	f.option("Type", "editorDefaults.transition.type", types, "MIX")
	f.number("Duration (frames)", "editorDefaults.transition.duration", 0, 600, 12,
		func(v: Variant) -> int: return T.resolve_duration(v if v != null else T.AUTO_SENTINEL, fps.call()))
	var tweens := []
	for t in T.TWEENS:
		tweens.append([t, t])
	f.option("Tween", "editorDefaults.transition.tween", tweens, "linear")
	f.note("Also used for the timeline Take bar default. Existing looks and clips are not changed.")
	f.heading("Compose preview")
	var mode := f.option("Preview source", "composePreview.mode", [["canvas", "Canvas thumbnails"],
		["ffmpeg_jpeg", "Caspar JPEG — ffmpeg writes file"], ["stream", "Live stream (hardware encoded)"]], "canvas")
	f.note("What the browser remote client and Companion previews use; this client shows its own previews.")
	var g := f.group()
	f.target = g
	f.note("JPEG mode embeds a low-cost ffmpeg consumer in Caspar config. Apply Caspar config after changing FPS or resolution.")
	f.number("Update rate (fps)", "composePreview.fps", 1, 30, 25)
	f.option("Resolution (relative to channel)", "composePreview.resolutionScale",
		[["half", "Half width × height (default)"], ["75", "75%"], ["full", "Full channel size"]], "half")
	f.number("JPEG quality (lower = better)", "composePreview.jpegQuality", 2, 20, 10)
	f.check("Companion preview variables (Stream Deck button images)", "composePreview.companionThumbEnabled", false)
	f.target = f
	var sync := func() -> void: g.visible = str(Settings.get_setting("composePreview.mode", "")) == "ffmpeg_jpeg"
	mode.item_selected.connect(func(_i: int) -> void: sync.call())
	f.on_hydrate(sync)
	f.note("Screen labels and the streaming channel are configured in the Devices tab.")
	f.heading("Input — mouse and touchpad")
	f.check("Invert touchpad scroll", "ui.invertTouchpadScroll", false)
	f.note("Reverses two-finger touchpad scrolling in the browser client's zoom / pan controls.")
	f.heading("Start-up")  # WO-645
	f.option("When the box starts", "startup.mode", [["ask", "Ask on every screen — Start operator here / Run headless"],
		["gui", "Start CasparCG and the operator GUI"], ["headless", "Start CasparCG headless (web UI only)"]], "ask")
	f.note("Ask: the desktop comes up with a small window on every screen and CasparCG waits for the choice. The other "
		+ "two start everything by themselves. Takes effect at the next boot. Right-click the desktop → Operator GUI "
		+ "opens this client later.")
	f.heading("This screen")  # WO-599 T4: kept in this screen's ui.cfg, not shared with other clients
	f.local_option("UI scale", Placement.SCALES, Placement.saved_scale(), Placement.apply_scale)
	f.note("Auto draws 1× at 1080p and 2× at 4K. Kept on this screen only.")
	var picker := ScreenPicker.new()
	f.add_child(picker)
	var choose := Button.new()
	choose.text = "Choose operator screen…"
	choose.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	f._row("Operator screen", choose)
	var said := f.note("Shows a button on every screen; the one you press becomes the operator screen (same as "
		+ "cabling the operator GUI in the Devices tab). Esc cancels.")
	choose.pressed.connect(func() -> void:
		choose.disabled = true
		picker.open())
	picker.finished.connect(func(r: Dictionary) -> void:
		choose.disabled = false
		said.text = ("Operator screen: %s." % r.name) if r.ok else ("Nothing changed — %s." % r.get("error", "")))


static func companion(f: Form, status: Label, check: Button) -> void:
	f.heading("Bitfocus Companion")
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.add_child(check)
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(status)
	f.add_child(row)
	f.text("Companion host", "companion.host", "127.0.0.1")
	f.number("Companion port (HTTP press)", "companion.port", 1, 65535, 8000)
	f.check("Satellite preview (button images)", "companion.satelliteEnabled", true)
	f.text("Satellite host", "companion.satelliteHost", "same as Companion host")
	f.number("Satellite port", "companion.satellitePort", 1, 65535, 16622)
	f.number("Preview bitmap size (px)", "companion.previewBitmapSize", 32, 512, 72)
	f.number("Page picker grid size", "companion.pickerGridSize", 1, 16, 8)
	f.note("Timeline companion_press flags use HTTP for triggers. Button previews use Companion Satellite ADD-SUB — in "
		+ "Companion enable both the Satellite server (port 16622) and the Button Subscriptions API.")


static func media(f: Form) -> void:
	f.heading("Project media folder")
	f.option("Store media/projects/<slug>/ on", "projectScopedMedia.location", [
		["internal", "System media root (~/highascg/media/projects/)"],
		["exfat", "exFAT stick (~/highascg/media/exfat/projects/)"],
		["bridge", "Bridge partition (~/highascg/media/bridge/projects/)"]], "internal")
	f.note("Default upload and ingest target for the active project. The full media library remains browsable.")
	f.heading("USB media import")
	f.text("CasparCG media path", "local_media_path", "/home/casparcg/highascg/media")
	f.check("Default uploads to the active project folder (media/projects/<slug>/)", "projectScopedMedia.enabled", true)
	f.check("Enable USB import", "usbIngest.enabled", true)
	f.text("Default subfolder template", "usbIngest.defaultSubfolder", "usb/{label}/{date}")
	f.option("When file already exists", "usbIngest.overwritePolicy",
		[["rename", "Rename"], ["skip", "Skip"], ["overwrite", "Overwrite"]], "rename")
	f.check("Verify SHA1 after copy", "usbIngest.verifyHash", false)


## WO-616 attribution / AGPL §5(d) — Settings → About; rows from about_model.gd (GET /api/about).
static func about(f: Form, a: Dictionary, error := "") -> void:
	for c in f.get_children():
		f.remove_child(c)
		c.queue_free()
	f.target = f
	for r in AboutModel.rows(a, error):
		if r[0] == "heading":
			f.heading(r[1])
		else:
			f.note(r[1])


## Web settings-modal-diagnostics.js — support bundle (GET /api/support/bundle) + the logs window.
static func diagnostics(f: Form, bundle: Button, logs: Button, status: Label) -> void:
	f.heading("Diagnostics & support")
	f.note("A ZIP with redacted config, Caspar XML, project summary, system inventory, GPU / xrandr layout and recent "
		+ "HighAsCG + Caspar log tails (highascg-support_<hostname>_<timestamp>.zip). Use after a failure or before "
		+ "contacting support.")
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	row.add_child(bundle)
	row.add_child(logs)
	f.add_child(row)
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	f.add_child(status)
	f.note("The logs window also opens from the connection eyes (top right).")


## Web Settings → Nuclear, password part (settings-modal-logic.js). GET /api/settings redacts the password and its hash;
## the field stays empty ("[REDACTED]" is never shown or sent back); only typed text is posted, hashed server-side.
static func nuclear(f: Form) -> void:
	f.heading("Danger zone")
	f.note("These actions can interrupt output immediately.")
	var req := f.check("Require password for nuclear actions", "ui.nuclearRequirePassword", false)
	var g := f.group()
	f.target = g
	var pw := LineEdit.new()
	pw.secret = true
	pw.custom_minimum_size.x = 320
	pw.placeholder_text = "type to set or change (Enter)"
	var commit := func() -> void:
		if pw.text.strip_edges() != "":
			Settings.patch({"ui": {"nuclearPassword": pw.text.strip_edges()}})
			pw.text = ""
	pw.text_submitted.connect(func(_t: String) -> void: commit.call())
	pw.focus_exited.connect(commit)
	f._row("Nuclear password", pw)
	f.note("Asked for by reboot / shut down / Caspar stop, updates, Tailscale, DeckLink and the dock while required.")
	f.target = f
	var sync := func() -> void:
		g.visible = req.button_pressed
	req.toggled.connect(func(_on: bool) -> void: sync.call())
	f.on_hydrate(sync)
