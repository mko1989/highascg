extends RefCounted
## WO-1072 — the text and the apply gate of "Match console positions" (console_match_fold.gd); pure.


## Whether the answer is a preview that may be applied.
static func can_apply(res: Dictionary) -> bool:
	var fit: Variant = res.get("fit")
	return res.get("ok", false) == true and fit is Dictionary and not (fit as Dictionary).get("mirrored", false) and res.get("applied") == null


## The server's answer as the operator reads it.
static func summary(res: Dictionary) -> String:
	var fit: Variant = res.get("fit")
	if not (fit is Dictionary):
		return str(res.get("error", "The server did not answer."))
	var f: Dictionary = fit
	var s: Dictionary = f.get("shift", {})
	var lines: Array[String] = []
	lines.append("%d of %d heads matched by %s." % [int(res.get("matched", 0)), int(res.get("rows", 0)), str(res.get("by", ""))])
	var applied: Variant = res.get("applied")
	if f.get("mirrored", false):
		lines.append("The console's plan is mirrored against ours (left and right, or the depth direction). Moving cannot fix that — check the PSN axes and the console's patch.")
	else:
		var verb := "Moved" if applied is Dictionary else "Offset"
		lines.append("%s: X %+.2f m, upstage %+.2f m, height %+.2f m." % [verb, float(s.get("x", 0)), float(s.get("y", 0)), float(s.get("z", 0))])
		lines.append("After the move the heads are off by %.2f m on average, %.2f m at worst." % [float(f.get("rms", 0)), float(f.get("max", 0))])
		if absf(float(f.get("yaw_deg", 0))) >= 0.5:
			lines.append("The console's rig is also turned by %.1f° against ours; a move does not correct that." % float(f.get("yaw_deg", 0)))
		var worst: Array = f.get("worst", [])
		var off: Array = worst.filter(func(w: Dictionary) -> bool: return float(w.get("err", 0)) >= 0.25)
		if not off.is_empty():
			lines.append("Furthest off: " + ", ".join(off.slice(0, 4).map(func(w: Dictionary) -> String: return "%s (%.2f m)" % [str(w.get("name", w.get("id", ""))), float(w.get("err", 0))])) + ".")
	if applied is Dictionary and str((applied as Dictionary).get("mode", "")) == "heads":
		lines.append("%d heads took the console's own positions." % int((applied as Dictionary).get("heads", 0)))
	var un: Array = res.get("unmatched", [])
	if not un.is_empty():
		lines.append("%d rows of the file match no patched fixture." % un.size())
	if res.has("error"):
		lines.append(str(res.error))
	return "\n".join(lines)
