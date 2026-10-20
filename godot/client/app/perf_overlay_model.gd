extends RefCounted
## WO-623 — performance overlay rows, pure: this client's own numbers (Godot monitors + /proc/self) and the box's
## (GET /api/host-stats: cpu.usagePct, memory, gpu util / VRAM / temp, Caspar + HighAsCG process CPU / RSS).
## Each row is {label, value, level}: level 0 normal, 1 warn, 2 alarm.

const CLK_TCK := 100.0  # Linux USER_HZ — /proc/<pid>/stat times are in these ticks


## utime + stime ticks from /proc/self/stat (fields 14 + 15; the comm field may hold spaces, so count after ')').
static func stat_ticks(text: String) -> int:
	var close := text.rfind(")")
	if close < 0:
		return -1
	var f := text.substr(close + 2).split(" ", false)
	if f.size() < 13:
		return -1
	return int(f[11]) + int(f[12])  # fields 3.. → index 0 is field 3, so 14/15 are 11/12


## % of ONE core (top's convention: a process using two cores shows 200).
static func cpu_pct(prev_ticks: int, cur_ticks: int, dt_s: float) -> float:
	if prev_ticks < 0 or cur_ticks < prev_ticks or dt_s <= 0.0:
		return -1.0
	return (cur_ticks - prev_ticks) / CLK_TCK / dt_s * 100.0


static func vm_rss_bytes(status_text: String) -> int:
	for line in status_text.split("\n"):
		if line.begins_with("VmRSS:"):
			return int(line.substr(6).strip_edges().split(" ", false)[0]) * 1024
	return -1


static func fmt_bytes(b: float) -> String:
	if b < 0:
		return "—"
	if b >= 1024.0 ** 3:
		return "%.1f GiB" % (b / 1024.0 ** 3)
	return "%d MiB" % roundi(b / 1024.0 ** 2)


static func level(v: float, warn: float, alarm: float) -> int:
	return 2 if v >= alarm else (1 if v >= warn else 0)


static func _num(d: Variant, key: String) -> float:
	if not d is Dictionary:
		return -1.0
	var v: Variant = (d as Dictionary).get(key)
	return float(v) if v is float or v is int else -1.0


static func _row(label: String, value: String, lvl := 0) -> Dictionary:
	return {"label": label, "value": value, "level": lvl}


## client: {fps, frame_ms, render_cpu_ms, render_gpu_ms, draw_calls, objects, vram, static_mem, cpu_pct, rss}
## (missing / negative → "—"). cores scales the client's CPU% into a machine share like the server does.
static func client_rows(c: Dictionary, cores: int) -> Array:
	var fps := float(c.get("fps", -1))
	var rows := [
		_row("FPS", "%d" % fps if fps >= 0 else "—", 2 if fps >= 0 and fps < 20 else (1 if fps >= 0 and fps < 45 else 0)),
		_row("Frame", "%.1f ms" % float(c.frame_ms) if float(c.get("frame_ms", -1)) >= 0 else "—"),
	]
	if float(c.get("render_cpu_ms", -1)) >= 0:
		rows.append(_row("Render", "cpu %.1f · gpu %.1f ms" % [float(c.render_cpu_ms), float(c.get("render_gpu_ms", 0))]))
	rows.append(_row("Draw calls", "%d · %d obj" % [int(c.get("draw_calls", 0)), int(c.get("objects", 0))]))
	rows.append(_row("VRAM (Godot)", fmt_bytes(float(c.get("vram", -1)))))
	var pct := float(c.get("cpu_pct", -1))
	var share := " (%.1f%% box)" % (pct / cores) if pct >= 0 and cores > 0 else ""
	rows.append(_row("CPU", ("%d%%" % roundi(pct) + share) if pct >= 0 else "—", level(pct / maxi(1, cores), 25, 50) if pct >= 0 else 0))
	rows.append(_row("RAM", fmt_bytes(float(c.get("rss", -1)))))
	return rows


## host: the /api/host-stats body. Preshow (mode "preshow") and unreachable both give a single note row.
static func host_rows(h: Variant) -> Array:
	if not h is Dictionary or (h as Dictionary).is_empty():
		return [_row("Box", "unreachable", 1)]
	var d: Dictionary = h
	if str(d.get("mode", "")) == "preshow":
		return [_row("Box", "stats off in preshow", 0)]
	var rows := []
	var cpu: Variant = d.get("cpu", {})
	var pct := _num(cpu, "usagePct")
	var load := _num(cpu, "load1")
	var cores := int(_num(cpu, "cores"))
	var cpu_txt := ("%d%%" % roundi(pct)) if pct >= 0 else "—"
	if load >= 0:
		cpu_txt += " · load %.1f/%d" % [load, cores]
	rows.append(_row("CPU", cpu_txt, level(pct, 70, 90) if pct >= 0 else 0))
	var mem: Variant = d.get("memory", {})
	var tot := _num(mem, "totalBytes")
	var used := _num(mem, "usedBytes")
	rows.append(_row("RAM", "%s / %s" % [fmt_bytes(used), fmt_bytes(tot)], level(used / tot * 100.0, 80, 92) if tot > 0 and used >= 0 else 0))
	var gpu: Variant = d.get("gpu", {})
	var util := _num(gpu, "utilizationPct")
	var temp := _num(gpu, "tempC")
	if util >= 0:
		rows.append(_row("GPU", "%d%%%s" % [roundi(util), (" · %d °C" % roundi(temp)) if temp >= 0 else ""], maxi(level(util, 80, 95), level(temp, 80, 88))))
		var vu := _num(gpu, "vramUsedMiB")
		var vt := _num(gpu, "vramTotalMiB")
		if vu >= 0 and vt > 0:
			rows.append(_row("VRAM", "%s / %s" % [fmt_bytes(vu * 1048576.0), fmt_bytes(vt * 1048576.0)], level(vu / vt * 100.0, 80, 92)))
	else:
		rows.append(_row("GPU", "—"))
	var disk: Variant = (d.get("media", {}) as Dictionary).get("disk") if d.get("media") is Dictionary else null
	var free := _num(disk, "freeBytes")
	var dtot := _num(disk, "totalBytes")
	if free >= 0:
		rows.append(_row("Media disk", "%s free" % fmt_bytes(free), level(100.0 - free / dtot * 100.0, 85, 95) if dtot > 0 else 0))
	var procs: Variant = d.get("processes", {})
	for spec in [["caspar", "CasparCG"], ["highascg", "HighAsCG"]]:
		var p: Variant = (procs as Dictionary).get(spec[0]) if procs is Dictionary else null
		if not p is Dictionary:
			continue
		var pc := _num(p, "cpuPct")
		var share := _num(p, "cpuPctOfMachine")
		var txt := ("%d%%" % roundi(pc)) if pc >= 0 else "—"
		if share >= 0:
			txt += " (%.1f%% box)" % share
		rows.append(_row(spec[1], "%s · %s" % [txt, fmt_bytes(_num(p, "rssBytes"))], level(share, 50, 80) if share >= 0 else 0))
	return rows


static func cores_of(h: Variant) -> int:
	if h is Dictionary and (h as Dictionary).get("cpu") is Dictionary:
		return int(_num((h as Dictionary).cpu, "cores"))
	return OS.get_processor_count()
