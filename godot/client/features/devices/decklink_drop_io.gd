extends RefCounted
## WO-605 slice 12 — decklink_drop_flow.gd's `io` over the Api / Settings autoloads; the drop target hands in what its
## status / dirty / reload / hint / tab calls do (unset = ignored).

var on_status := Callable()  # (text, ok)
var on_dirty := Callable()
var on_reload := Callable()
var on_hint := Callable()  # (text)
var on_tab := Callable()  # (name)


func get_json(path: String) -> Dictionary:
	return await Api.get_json(path)


func post_json(path: String, body: Variant) -> Dictionary:
	return await Api.post_json(path, body)


func load_settings() -> Dictionary:
	await Settings.load_from_server()
	return Settings.settings


func status(text: String, kind: String) -> void:
	_call(on_status, [text, kind != "error"])


func dirty() -> void:
	_call(on_dirty, [])


func reload() -> void:
	_call(on_reload, [])


func hint(text: String) -> void:
	_call(on_hint, [text])


func tab(name: String) -> void:
	_call(on_tab, [name])


static func _call(c: Callable, args: Array) -> void:
	if c.is_valid():
		c.callv(args)
