extends "res://e2e/e2e_scenario.gd"
## WO-719 — start a show from nothing: New project → confirm → name it → save. Checks the GUI AND the stored project.

const SHOW := "E2E Show"


func _project(d: Variant) -> Dictionary:
	return d.get("project", d) if d is Dictionary else {}


func run() -> void:
	await step("New project asks for confirmation", func() -> String:
		var why: String = await ui.click(ui.button("New project"))
		if why != "":
			return why
		return expect(await ui.await_control("BaseButton", "Start fresh", null, 3.0) != null, "no 'Start fresh' confirmation")
	)
	await step("Start fresh empties the show", func() -> String:
		var why: String = await ui.click(ui.button("Start fresh"))
		if why != "":
			return why
		why = await await_api("/api/project", func(d: Variant) -> bool:
			var p := _project(d)
			return p.get("scenes", {}).get("scenes", [1]).is_empty(), "server project still has looks")
		if why != "":
			return why
		return expect(await ui.wait_for(func() -> bool: return (Store.project.get("scenes", {}).get("scenes", [1]) as Array).is_empty(), 5.0),
			"client deck still shows looks after New project")
	)
	await step("Type a show name", func() -> String:
		var why: String = await ui.type_into(ui.find("LineEdit", "Project name —", null, false), SHOW)
		if why != "":
			return why
		return await await_api("/api/project", func(d: Variant) -> bool: return str(_project(d).get("name")) == SHOW,
			"project name never reached the server", 10.0)
	)
	await step("Save stores it in the project list", func() -> String:
		var why: String = await ui.click(ui.button("Save project to the server (right-click: save to a file)"))
		if why != "":
			return why
		return await await_api("/api/project/list", func(d: Variant) -> bool:
			return JSON.stringify(d).contains(SHOW), "saved show missing from /api/project/list")
	)
