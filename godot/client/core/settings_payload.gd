extends RefCounted
## WO-608 — the POST /api/settings body, pure. The server merges per top-level section and leaves an absent section
## untouched (src/api/settings-post.js), so only the sections changed since the last save are sent. Deviation from the
## web (settings-modal-logic.js buildSettingsPayload re-posts every section): GET /api/settings is redacted
## (src/support/redact-settings.js — any key matching password / token / secret / auth … reads "[REDACTED]", strings
## over 4096 chars are cut to "…[truncated]"), and echoing those back writes the placeholder over the stored value;
## re-posting `osc` also restarts the OSC subsystem on every save.

const REDACTED := "[REDACTED]"
const TRUNCATED := "…[truncated]"


## {key: settings[key]} for each dirty top-level key, redaction placeholders dropped. offline_mode is never sent (web).
static func build(settings: Dictionary, dirty: Array) -> Dictionary:
	var out := {}
	for k in dirty:
		if k == "offline_mode" or not settings.has(k):
			continue
		var v: Variant = strip(settings[k])
		if v != null:
			out[k] = v
	return out


## Drop "[REDACTED]" / truncated values so the server keeps what it stores. ui.nuclearPassword stays "[REDACTED]":
## that is the server's own "keep the stored hash" signal (src/utils/nuclear-password.js mergeUiNuclearPasswordSettings).
static func strip(v: Variant, key := "") -> Variant:
	if v is String:
		if (v == REDACTED and key != "nuclearPassword") or (v as String).ends_with(TRUNCATED):
			return null
		return v
	if v is Dictionary:
		var d := {}
		for k in v:
			var s: Variant = strip(v[k], str(k))
			if s != null or v[k] == null:
				d[k] = s
		return d
	return v
