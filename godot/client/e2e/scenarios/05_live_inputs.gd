extends "res://e2e/e2e_scenario.gd"
## WO-719 — live inputs from the Devices tab's "Add live input": an NDI source typed by name and a CG-template-free
## webpage. Each must land in the server's extraLiveSources and show up in Sources → Live for use in looks.

const NDI_NAME := "E2E-HOST (E2E Camera)"
const WEB_URL := "https://example.com/e2e"


static func _sources(d: Variant) -> Array:
	return d.get("extraLiveSources", []) if d is Dictionary else []


func _open_dialog(kind_label: String) -> String:
	var why: String = await ui.click(ui.button("Add DeckLink, NDI, USB video, live audio, or webpage"))
	if why != "":
		return why
	var ok_btn: Control = await ui.await_control("BaseButton", "Add live source", null, 4.0)
	if ok_btn == null:
		return "Add live input dialog did not open"
	var kind: OptionButton = ui.all("OptionButton", ok_btn.get_viewport()).filter(func(o: OptionButton) -> bool:
		return "NDI" in ui.items(o))[0]
	return await ui.choose(kind, kind_label)


## The dialog closes itself 1.5 s after a successful add (live_input_dialog.gd _close_later).
func _await_closed() -> String:
	var gone: Variant = await ui.wait_for(func() -> bool: return ui.button("Add live source") == null, 5.0)
	return expect(bool(gone), "Add live input dialog stayed open after a successful add")


func run() -> void:
	await step("Add an NDI input by name", func() -> String:
		await ui.tab("Devices")
		var why := await _open_dialog("NDI")
		if why == "":
			why = await ui.type_into(ui.find("LineEdit", "Exact NDI source name"), NDI_NAME, false)
		if why == "":
			why = await ui.click(ui.button("Add live source"))
		if why != "":
			return why
		why = await await_api("/api/device-view", func(d: Variant) -> bool:
			return JSON.stringify(_sources(d)).contains(NDI_NAME), "NDI source not in extraLiveSources")
		if why != "":
			return why
		return await _await_closed()
	)
	await step("Add a webpage input", func() -> String:
		var why := await _open_dialog("Web Browser (CG template)")
		if why == "":
			why = await ui.type_into(ui.find("LineEdit", "https://..."), WEB_URL, false)
		if why == "":
			why = await ui.click(ui.button("Add live source"))
		if why != "":
			return why
		why = await await_api("/api/device-view", func(d: Variant) -> bool:
			return JSON.stringify(_sources(d)).contains("example.com/e2e"), "webpage not in extraLiveSources")
		if why != "":
			return why
		return await _await_closed()
	)
	await step("Both show in Sources → Live", func() -> String:
		var why: String = await ui.pick_tab("Live")
		if why != "":
			return why
		var found: Variant = await ui.wait_for(func() -> bool:
			return ui.find("Label", NDI_NAME, null, false) != null and ui.find("Label", "example.com/e2e", null, false) != null, 6.0)
		return expect(bool(found), "the NDI / webpage rows are missing from Sources → Live")
	)
