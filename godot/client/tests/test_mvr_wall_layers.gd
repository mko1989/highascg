extends RefCounted
## WO-706 — mvr_model.gd wall_layers / empty_layers / layer_labels: wall-named layers that hold something start hidden
## in a scene new to the project; layers the file left empty (the owner's Capture export) are labelled, not hideable.

const M := preload("res://features/previs/mvr_model.gd")
var t


func test_wall_names_in_the_owners_languages() -> void:
	for n in ["Ściana frontowa", "Ściany boczne", "ściana z drzwiami", "Side walls", "WALL_UB1", "Wände", "Murs", "Paroi est",
			"Pared norte", "Parete", "Scian (UB3+UB4)"]:
		t.eq(M.is_wall_layer(n), true, n)
	for n in ["Ekran główny", "Stage", "Video", "Truss", "Default Layer", "Layer 34", "Podłoga 1 hotelowa", "Żyrandole",
			"5. Sharpy Plus", ""]:
		t.eq(M.is_wall_layer(n), false, n)


func test_only_walls_with_objects_start_hidden() -> void:
	# the owner's Pabianice file: Capture wrote the wall layers with no children — nothing to hide, nothing to promise
	var layers := ["Default Layer", "Ściana frontowa", "Ściany boczne", "Ekran główny", "5. Sharpy Plus", "Layer 34"]
	var sizes := {"Default Layer": 238, "5. Sharpy Plus": 12, "Layer 34": 136}
	t.eq(M.wall_layers(layers, sizes), [])
	t.eq(M.empty_layers(layers, sizes), ["Ściana frontowa", "Ściany boczne", "Ekran główny"])
	t.eq(M.layer_labels(layers, sizes), {"Ściana frontowa": "Ściana frontowa · empty in the file",
		"Ściany boczne": "Ściany boczne · empty in the file", "Ekran główny": "Ekran główny · empty in the file"})
	# a file that carries its walls: those start hidden, the rest stays shown
	sizes["Ściany boczne"] = 4
	t.eq(M.wall_layers(layers, sizes), ["Ściany boczne"])
	t.eq(M.layer_labels([""], {}), {"": "(no layer) · empty in the file"})
