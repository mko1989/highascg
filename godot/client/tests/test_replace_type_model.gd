extends RefCounted
## WO-633 T2 — replace_type_model.gd: stand-in ranking, mode pairing by footprint, patch re-pointing. Names and modes
## are the real Capture stub / manufacturer GDTF pairs from the owner's Downloads (ADJ Focus Profile, Brighter Pixel Strobe).

const R := preload("res://features/previs/fixtures/replace_type_model.gd")
var t

const STUB := {"id": "aaaaaaaaaaaa", "name": "Focus Profile", "manufacturer": "ADJ", "placeholder": true,
	"modes": [{"name": "36 Channel", "footprint": 36}, {"name": "40 Channel", "footprint": 40},
		{"name": "51 Channel", "footprint": 51}, {"name": "60 Channel", "footprint": 60}]}
const REAL := {"id": "bbbbbbbbbbbb", "name": "Focus Profile", "manufacturer": "ADJ",
	"modes": [{"name": "Extended Mode 51ch", "footprint": 51}, {"name": "Standard Mode 40ch", "footprint": 40},
		{"name": "Basic Mode 36ch", "footprint": 36}]}


func test_norm_and_targets() -> void:
	t.eq(R.norm("Robin 600 LEDWash+"), "robin600ledwash")
	t.eq(R.norm("Dummy - Robin 600 LEDWash Plus"), "robin600ledwashplus")
	var other := {"id": "cccccccccccc", "name": "Vizi Beam CMY", "manufacturer": "ADJ"}
	var robe := {"id": "dddddddddddd", "name": "Robin 600 LEDWash", "manufacturer": "Robe Lighting"}
	var stub2 := {"id": "eeeeeeeeeeee", "name": "Focus Profile", "manufacturer": "ADJ", "placeholder": true}
	var ids := R.targets([other, robe, STUB, stub2, REAL], STUB).map(func(x: Dictionary) -> String: return x.id)
	t.eq(ids, ["bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd"], "same name first; no placeholders, not itself")
	var r600 := {"name": "Robin 600 LEDWash+", "manufacturer": "Robe"}
	t.eq(R.targets([other, robe], r600)[0].id, "dddddddddddd", "maker prefix + name containment")


func test_pair_modes_by_footprint() -> void:
	t.eq(R.pair_modes(STUB, REAL), {"36 Channel": "Basic Mode 36ch", "40 Channel": "Standard Mode 40ch",
		"51 Channel": "Extended Mode 51ch", "60 Channel": ""}, "60 has no real mode → keeps the placeholder")
	var ps := {"modes": [{"name": "4 Channel RGBW", "footprint": 4}, {"name": "4 Channel Strobe", "footprint": 4}]}
	var pr := {"modes": [{"name": "4Ch-Strobe", "footprint": 4}, {"name": "4Ch-RGBW", "footprint": 4}]}
	t.eq(R.pair_modes(ps, pr), {"4 Channel RGBW": "4Ch-RGBW", "4 Channel Strobe": "4Ch-Strobe"}, "ties: shared words")
	var one := {"modes": [{"name": "4Ch", "footprint": 4}]}
	t.eq(R.pair_modes(ps, one), {"4 Channel RGBW": "4Ch", "4 Channel Strobe": "4Ch"}, "reused once the unused run out")


func test_repoint() -> void:
	var patch := [{"id": "mvr-1", "typeId": STUB.id, "mode": "40 Channel", "address": 1},
		{"id": "mvr-2", "typeId": STUB.id, "mode": "60 Channel", "address": 41},
		{"id": "fx3", "typeId": "cccccccccccc", "mode": "40 Channel", "address": 101}]
	var r := R.repoint(patch, STUB.id, REAL.id, R.pair_modes(STUB, REAL))
	t.eq(r.moved, 1)
	t.eq(r.patch.map(func(f: Dictionary) -> Array: return [f.id, f.typeId, f.mode, f.address]),
		[["mvr-1", REAL.id, "Standard Mode 40ch", 1], ["mvr-2", STUB.id, "60 Channel", 41],
			["fx3", "cccccccccccc", "40 Channel", 101]])
	t.eq(patch[0].typeId, STUB.id, "the input is not changed")
