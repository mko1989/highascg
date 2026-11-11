extends RefCounted
## WO-1039 — the PixelHue tab's one door to the switcher: the owner's PixelHue Studio engine, run inside the HighAsCG
## server (src/pixelhue/studio-bridge.js, vendored src/pixelhue/vendor/pixelhue-studio), under /api/pixelhue/studio/.
## A resource is Studio's API path without "/api/": "programming", "programming/geometry", "inputs", "screens", …
## Reads are GET, writes are POST (Studio's PUT); the server adds Studio's session.
## Every call answers {ok, data, error}: `data` is Studio's JSON, `error` the sentence Studio (or the server) gave.

const BASE := "/api/pixelhue/studio/"


## `api` = the Api autoload (tests: a fake with get_json / post_json).
static func read(api: Variant, resource: String, query := "") -> Dictionary:
	return shape(await api.get_json(BASE + resource + ("?" + query if query != "" else "")))


## A write waits as long as Studio itself does: a layer create or a self-test can take over a minute on the switcher
## (the server's bridge allows 90 s), far past the client's ordinary request timeout.
const WRITE_TIMEOUT_S := 95.0


static func write(api: Variant, resource: String, body: Dictionary) -> Dictionary:
	return shape(await api.post_json(BASE + resource, body, WRITE_TIMEOUT_S))


## Api's answer → {ok, data, error}. Studio's errors are `{ "error": "…" }` with a 4xx/5xx status.
static func shape(r: Dictionary) -> Dictionary:
	var data: Variant = r.get("data")
	if r.get("ok") == true and data is Dictionary and not (data as Dictionary).has("error"):
		return {"ok": true, "data": data, "error": ""}
	var why := ""
	if data is Dictionary and str((data as Dictionary).get("error", "")) != "":
		why = str(data.error)
	elif str(r.get("error", "")) != "":
		why = str(r.error)
	else:
		why = "The server did not answer."
	return {"ok": false, "data": data if data is Dictionary else {}, "error": why}
