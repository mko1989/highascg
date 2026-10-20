extends RefCounted
## WO-608 — Settings → System / DeckLink text, same answers as client/components/settings-modal-mount-hardware*.js
## (except disk sizes: lsblk text passes through where the web printed "NaN GB").

const M := preload("res://features/settings/system_model.gd")
var t


func test_fmt_bytes_and_uptime() -> void:
	t.eq(M.fmt_bytes(null), "—")
	t.eq(M.fmt_bytes(512.0), "512 B")
	t.eq(M.fmt_bytes(2048.0), "2.0 KB")
	t.eq(M.fmt_bytes(12899823616.0), "12.0 GB")
	t.eq(M.fmt_bytes(5.0 * 1048576.0), "5.0 MB")
	t.eq(M.fmt_bytes("953.9G"), "953.9G")
	t.eq(M.uptime(121929.0), "1d 9h 52m")


func test_operator_line() -> void:
	t.eq(M.operator_line(null), "Operator display unknown.")
	t.eq(M.operator_line({"summary": "Operator monitor: DP-2", "interactiveAllowance": [], "confineActive": true}),
		"Operator monitor: DP-2 Pointer confine: active.")
	t.eq(M.operator_line({"summary": "S", "interactiveAllowance": ["a", "b"], "confineDesired": true}),
		"S Interactive Caspar heads (also allowed when confining): a, b. Pointer confine: enabled on operator GPU port (Device View).")


func test_hardware_sections() -> void:
	var hw := {"cpu": {"modelName": "i7", "cores": 28.0, "load1": 10.76, "load5": 9.83, "load15": 9.69},
		"memory": {"usedBytes": 1073741824.0, "totalBytes": 2147483648.0},
		"disks": [{"name": "nvme0n1", "size": "953.9G", "type": "disk", "mountpoint": null}],
		"gpu": {"nvidia": {"name": "RTX", "driver": "595", "vramMiB": "24467 MiB"},
			"displayPorts": [{"type": "DisplayPort", "name": "DP-2", "connected": true}, {"type": "DisplayPort", "name": "DP-0", "connected": false}]},
		"decklink": {"devices": [{"index": 1.0, "label": "DeckLink [1]"}]},
		"audio": {"deviceCount": 34.0, "devices": [{"type": "alsa", "name": "PCH"}]},
		"network": {"hostname": "box", "interfaces": [{"name": "eno1", "address": "192.168.50.64"}, {"name": "wl0"}]},
		"system": {"osRelease": "Ubuntu", "kernel": "6.8", "uptimeSec": 90061.0}}
	var s := M.hardware_sections(hw)
	t.eq(s.map(func(x: Array) -> String: return x[0]), ["Processor", "Memory", "Storage devices", "Graphics",
		"DeckLink devices", "Audio devices", "Network", "System"])
	t.eq(s[0][1], [["Model", "i7"], ["Cores", "28"], ["Load (1/5/15)", "10.8/9.8/9.7"]])
	t.eq(s[1][1], [["Usage", "1.0 GB / 2.0 GB"]])
	t.eq(s[2][1], [["nvme0n1", "953.9G · disk · (not mounted)"]])
	t.eq(s[3][1][3], ["Display ports", "DisplayPort (DP-2) ✓, DisplayPort (DP-0)"])
	t.eq(s[4][1], [["#1", "DeckLink [1]"]])
	t.eq(s[5][1], [["Count", "34"], ["", "PCH (alsa)"]])
	t.eq(s[6][1], [["Hostname", "box"], ["", "eno1 (192.168.50.64)"], ["", "wl0 (no IPv4)"]])
	t.eq(s[7][1][2], ["Uptime", "1d 1h 1m"])
	t.eq(M.hardware_sections({"cpu": {"error": "x"}}), [["Processor", [["Status", "x"]]]])


func test_time_rules() -> void:
	t.eq(M.parse_now("Tue 2026-07-14 10:27:20 UTC"), {"date": "2026-07-14", "time": "10:27:20"})
	t.eq(M.parse_now(null), {})
	t.eq(M.normalize_time("9:05"), "09:05:00")
	t.eq(M.normalize_time("23:59:59"), "23:59:59")
	t.eq(M.normalize_time("24:00"), "")
	t.eq(M.normalize_time("12:5"), "")
	t.eq(M.valid_date("2026-10-20"), true)
	t.eq(M.valid_date("20.10.2026"), false)


func test_decklink_and_launch() -> void:
	t.eq(M.decklink_lines({}), "No DeckLink devices discovered yet (ffmpeg + recent Caspar log).")
	t.eq(M.decklink_lines({"devices": [{"index": 1.0, "label": "8K Pro [1]", "externalRef": "16378"}, {"index": 2.0, "label": "B"}]}),
		"#1 8K Pro [1]    Caspar externalRef=16378\n#2 B")
	t.eq(M.launch_note({"raised": true}), "Raised existing window.")
	t.eq(M.launch_note({"exe": "/usr/bin/firefox"}), "Started: /usr/bin/firefox")
	t.eq(M.launch_note({}), "Started.")
