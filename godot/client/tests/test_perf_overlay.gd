extends RefCounted
## WO-623 performance overlay — /proc/self parsing, CPU% maths, and the client / box rows built from
## Godot monitors and a GET /api/host-stats body (shape captured on the box 2026-10-20).

const M := preload("res://app/perf_overlay_model.gd")
var t

const HOST := {
	"mode": "production",
	"cpu": {"load1": 6.56, "load5": 8.12, "load15": 8.5, "cores": 28, "usagePct": 21.1},
	"memory": {"totalBytes": 67165978624, "freeBytes": 55200612352, "usedBytes": 11965366272},
	"media": {"path": "/home/casparcg/highascg/media", "disk": {"totalBytes": 1006662447104, "freeBytes": 119853010944, "usedBytes": 886809436160}},
	"gpu": {"text": "32% · 2321/24467 MiB VRAM", "utilizationPct": 32, "source": "nvidia-smi", "vramUsedMiB": 2321, "vramTotalMiB": 24467, "tempC": 57},
	"processes": {"caspar": {"pid": 599881, "cpuPct": 290, "rssBytes": 5643575296, "cpuPctOfMachine": 10.4},
		"highascg": {"pid": 676407, "cpuPct": 5, "rssBytes": 247783424, "cpuPctOfMachine": 0.2}},
}


func _pairs(rows: Array) -> Dictionary:
	var d := {}
	for r in rows:
		d[r.label] = [r.value, r.level]
	return d


func test_proc_parsing() -> void:
	var stat := "4242 (godot (main)) S 1 4242 4242 0 -1 4194304 1000 0 0 0 1234 567 0 0 20 0 30 0 99 0"
	t.eq(M.stat_ticks(stat), 1801, "utime+stime after the last ')' — comm may hold spaces and parens")
	t.eq(M.stat_ticks("garbage"), -1, "no comm → unknown")
	t.eq(M.cpu_pct(1000, 1150, 1.0), 150.0, "150 ticks in 1 s at USER_HZ 100 = 1.5 cores")
	t.eq(M.cpu_pct(-1, 1150, 1.0), -1.0, "first sample has no window")
	t.eq(M.vm_rss_bytes("Name:\tgodot\nVmRSS:\t  204800 kB\nThreads: 40\n"), 209715200, "VmRSS kB → bytes")
	t.eq(M.vm_rss_bytes("Name:\tgodot\n"), -1, "missing VmRSS")
	t.eq(M.fmt_bytes(11965366272), "11.1 GiB", "GiB")
	t.eq(M.fmt_bytes(247783424), "236 MiB", "MiB")
	t.eq(M.fmt_bytes(-1), "—", "unknown")


func test_host_rows() -> void:
	var d := _pairs(M.host_rows(HOST))
	t.eq(d["CPU"], ["21% · load 6.6/28", 0], "machine busy % (not load) + load for context")
	t.eq(d["RAM"], ["11.1 GiB / 62.6 GiB", 0], "used / total")
	t.eq(d["GPU"], ["32% · 57 °C", 0], "utilisation + temperature")
	t.eq(d["VRAM"], ["2.3 GiB / 23.9 GiB", 0], "MiB from nvidia-smi")
	t.eq(d["Media disk"][0], "111.6 GiB free", "media volume free space")
	t.eq(d["Media disk"][1], 1, "88% full warns")
	t.eq(d["CasparCG"], ["290% (10.4% box) · 5.3 GiB", 0], "Caspar: per-core % + machine share + RSS")
	t.eq(d["HighAsCG"], ["5% (0.2% box) · 236 MiB", 0], "node server")


func test_host_levels_and_degraded() -> void:
	var hot := HOST.duplicate(true)
	hot.cpu.usagePct = 93.0
	hot.gpu.tempC = 90
	var d := _pairs(M.host_rows(hot))
	t.eq(d["CPU"][1], 2, "CPU ≥ 90% alarms")
	t.eq(d["GPU"][1], 2, "a hot GPU alarms even at low utilisation")
	var no_gpu := HOST.duplicate(true)
	no_gpu.gpu = {"text": null, "utilizationPct": null, "source": null}
	d = _pairs(M.host_rows(no_gpu))
	t.eq(d["GPU"], ["—", 0], "no NVIDIA (AMD laptop) → dash, no VRAM row")
	t.ok(not d.has("VRAM"), "no VRAM row without nvidia-smi")
	t.eq(M.host_rows({}), [{"label": "Box", "value": "unreachable", "level": 1}], "server down")
	t.eq(M.host_rows({"mode": "preshow", "cpu": null}), [{"label": "Box", "value": "stats off in preshow", "level": 0}], "preshow stub")
	var old := HOST.duplicate(true)
	old.cpu.erase("usagePct")  # a server from before WO-623
	t.eq(_pairs(M.host_rows(old))["CPU"], ["— · load 6.6/28", 0], "older server: load only")
	t.eq(M.cores_of(HOST), 28, "cores from the box")


func test_client_rows() -> void:
	var c := {"fps": 60, "frame_ms": 2.25, "render_cpu_ms": 1.5, "render_gpu_ms": 3.0, "draw_calls": 412, "objects": 380,
		"vram": 524288000, "cpu_pct": 140.0, "rss": 734003200}
	var d := _pairs(M.client_rows(c, 28))
	t.eq(d["FPS"], ["60", 0], "fps")
	t.eq(d["Frame"], ["2.2 ms", 0], "process time")
	t.eq(d["Render"], ["cpu 1.5 · gpu 3.0 ms", 0], "measured viewport render time")
	t.eq(d["Draw calls"], ["412 · 380 obj", 0], "draw calls")
	t.eq(d["VRAM (Godot)"], ["500 MiB", 0], "Godot's own VRAM")
	t.eq(d["CPU"], ["140% (5.0% box)", 0], "per-core % + share of the 28-core box")
	t.eq(d["RAM"], ["700 MiB", 0], "RSS")
	c.fps = 15
	c.cpu_pct = -1.0
	d = _pairs(M.client_rows(c, 28))
	t.eq(d["FPS"][1], 2, "under 20 fps alarms")
	t.eq(d["CPU"], ["—", 0], "first tick has no CPU window")
