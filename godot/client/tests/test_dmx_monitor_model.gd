extends RefCounted
## WO-693 — dmx_monitor_model.gd: universe labels / clamps, list rows from GET /api/dmx-monitor, status + values.

const D := preload("res://features/previs/fixtures/dmx_monitor_model.gd")
var t

const SNAP := {
	"artnet": {"listening": "own",
		"nodes": [{"ip": "10.0.0.7", "shortName": "Node A", "longName": "Node A long", "report": "ok", "mac": "00:01",
			"outputs": [0x123, 0x124], "inputs": [], "self": false},
			{"ip": "192.168.0.23", "shortName": "", "longName": "This box", "outputs": [], "inputs": [], "self": true}],
		"sources": [{"ip": "10.0.0.50", "universes": [0, 1], "packets": 40, "self": false}]},
	"sacn": {"sources": [{"cid": "ab", "name": "Desk", "ip": "10.0.0.60", "universes": [4, 5], "self": false}]},
	"frame": {"from": "10.0.0.50", "source": "", "age_ms": 120, "data": [255, 0, 7]},
}


func test_labels_and_clamps() -> void:
	t.eq(D.universe_label("artnet", 0x123), "1:2:3 (291)")
	t.eq(D.universe_label("artnet", 0), "0:0:0 (0)")
	t.eq(D.universe_label("sacn", 5), "5")
	t.eq(D.clamp_universe("sacn", 0), 1, "sACN starts at 1")
	t.eq(D.clamp_universe("artnet", 40000), 32767, "15-bit port-address")
	t.eq(D.query("sacn", 7), "/api/dmx-monitor?protocol=sacn&universe=7")
	t.eq(D.query("bogus", 7), "/api/dmx-monitor?protocol=artnet&universe=7")


func test_rows() -> void:
	var art := D.rows(SNAP, "artnet")
	t.eq(art.size(), 3, "2 nodes + 1 sender")
	t.eq(art[0].text, "◆ Node A · 10.0.0.7  out 291, 292")
	t.eq(art[0].universe, 0x123, "a node jumps to its first output")
	t.eq(art[1].text, "◆ This box · 192.168.0.23  (this box)", "no short name → long name; this box marked")
	t.eq(art[1].universe, -1, "no ports → nothing to jump to")
	t.eq(art[2].text, "▸ 10.0.0.50  → 0, 1")
	t.eq(art[2].tip, "40 ArtDmx packets")
	var sacn := D.rows(SNAP, "sacn")
	t.eq(sacn.size(), 1)
	t.eq(sacn[0].text, "Desk · 10.0.0.60  → U 4, 5")
	t.eq(sacn[0].universe, 4)
	t.eq(D.rows({}, "artnet"), [], "an empty answer → no rows")
	var many := {"artnet": {"sources": [{"ip": "x", "universes": range(10)}]}}
	t.eq(D.rows(many, "artnet")[0].text, "▸ x  → 0, 1, 2, 3, 4, 5, 6, 7 …", "long lists are cut")


func test_status_and_values() -> void:
	var ok := {"ok": true, "status": 200, "data": SNAP}
	t.eq(D.status("in", "artnet", 0, ok), "Art-Net 0:0:0 (0) ← 10.0.0.50")
	t.eq(D.values("in", ok), [255, 0, 7])
	var stale := {"ok": true, "data": {"frame": {"from": "1.2.3.4", "source": "Desk", "age_ms": 4000, "data": []}}}
	t.eq(D.status("in", "sacn", 3, stale), "sACN 3 ← 1.2.3.4 \"Desk\"  (stale 4.0 s)")
	t.eq(D.status("in", "sacn", 3, {"ok": true, "data": {"frame": null}}), "sACN 3 — no input")
	t.eq(D.values("in", {"ok": true, "data": {"frame": null}}), [])
	t.eq(D.status("in", "artnet", 1, {"ok": false, "error": "HTTP 500"}), "Art-Net 0:0:1 (1) — the server does not answer (HTTP 500)")
	var out := {"ok": true, "status": 200, "data": {"live": false, "dest": "2.255.255.255:6454", "data": [1, 2]}}
	t.eq(D.status("out", "artnet", 1, out), "Art-Net 0:0:1 (1) — this box would send (not live) to 2.255.255.255:6454")
	t.eq(D.values("out", out), [1, 2])
	t.eq(D.status("out", "artnet", 1, {"ok": false, "status": 404}), "Art-Net 0:0:1 (1) — this box outputs nothing on this universe")
	t.eq(D.status("out", "artnet", 1, {"ok": false, "status": 503}), "Art-Net 0:0:1 (1) — fixture engine off (the Tracking module on the server)")
