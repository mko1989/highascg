extends RefCounted
## WO-1103 — which bone of a humanoid skeleton is which, whatever the exporter called it: the bones the puppet's
## motion needs (Godot's SkeletonProfileHumanoid names: Hips, Spine, Chest, UpperChest, Neck, Head, Left/Right
## UpperLeg / LowerLeg / Foot / Toes, Shoulder / UpperArm / LowerArm / Hand) found by name in the conventions seen in
## practice — Microsoft Rocketbox / 3ds Max biped ("Bip01 L Thigh"), Mixamo ("mixamorig:LeftUpLeg"), Unreal Engine /
## MetaHuman ("thigh_l", "calf_l", "ball_l", "spine_01" … "spine_05", "neck_01"), Godot / VRM ("LeftUpperLeg",
## "J_Bip_L_UpperLeg"), Blender Rigify ("DEF-thigh.L") —; the spine by structure (the chain between the hips and the
## neck, whatever its length). Fingers, twist / corrective / face bones are left alone (they keep their rest pose).

const REQUIRED := ["Hips", "Spine", "Head", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot", "RightUpperLeg", "RightLowerLeg", "RightFoot"]
## canonical (side-less) → name stems after normalising (lower case, prefixes and separators gone)
const LIMBS := {
	"UpperLeg": ["upleg", "thigh", "upperleg"],
	"LowerLeg": ["leg", "calf", "lowerleg", "shin", "knee"],
	"Foot": ["foot", "ankle"],
	"Toes": ["toebase", "toe0", "toe", "toes", "ball"],
	"Shoulder": ["shoulder", "clavicle", "collar"],
	"UpperArm": ["arm", "upperarm"],
	"LowerArm": ["forearm", "lowerarm", "elbow"],
	"Hand": ["hand", "wrist"],
}
const SIDES := {"Left": ["left", "l"], "Right": ["right", "r"]}
const PREFIXES := ["mixamorig", "bip001", "bip01", "jbip", "ccbase", "def", "org"]
## children of a canonical bone that point along it (a limb's direction at rest): canonical → its next canonical
const NEXT := {"Hips": "Spine", "Spine": "Chest", "Chest": "UpperChest", "Neck": "Head",
	"LeftUpperLeg": "LeftLowerLeg", "LeftLowerLeg": "LeftFoot", "LeftFoot": "LeftToes",
	"RightUpperLeg": "RightLowerLeg", "RightLowerLeg": "RightFoot", "RightFoot": "RightToes",
	"LeftShoulder": "LeftUpperArm", "LeftUpperArm": "LeftLowerArm", "LeftLowerArm": "LeftHand",
	"RightShoulder": "RightUpperArm", "RightUpperArm": "RightLowerArm", "RightLowerArm": "RightHand"}


## A bone name without exporter prefixes, case and separators ("mixamorig:LeftUpLeg" → "leftupleg",
## "Bip01 L Thigh" → "lthigh", "thigh_l" → "thighl", "DEF-thigh.L" → "thighl").
static func norm(name: String) -> String:
	var n := name.to_lower()
	for sep in [":", "|"]:
		if n.contains(sep):
			n = n.get_slice(sep, n.get_slice_count(sep) - 1)
	n = n.replace("_", "").replace(" ", "").replace(".", "").replace("-", "")
	for p in PREFIXES:
		if n.begins_with(p) and n.length() > p.length():
			n = n.substr(p.length())
	return n


## {canonical: bone index} for `sk`, plus "missing" (the REQUIRED ones not found) — the result's "ok" says whether the
## puppet's motion can drive it.
static func map(sk: Skeleton3D) -> Dictionary:
	var by_norm := {}
	for i in sk.get_bone_count():
		var n := norm(sk.get_bone_name(i))
		if not by_norm.has(n):
			by_norm[n] = i
	var out := {}
	for limb: String in LIMBS:
		for side: String in SIDES:
			var hit := -1
			for stem: String in LIMBS[limb]:
				for tok: String in SIDES[side]:
					for cand in [tok + stem, stem + tok]:
						if hit < 0 and by_norm.has(cand):
							hit = by_norm[cand]
			if hit >= 0:
				out[side + limb] = hit
	for stem in ["hips", "pelvis", "hip"]:
		if not out.has("Hips") and by_norm.has(stem):
			out["Hips"] = by_norm[stem]
	if by_norm.has("head"):
		out["Head"] = by_norm["head"]
	if out.has("Hips") and out.has("Head"):
		_spine(sk, out)
	var missing := []
	for r: String in REQUIRED:
		if not out.has(r):
			missing.append(r)
	return {"bones": out, "missing": missing, "ok": missing.is_empty()}


## The chain from the head down to the hips: the lowest "neck…" bone is Neck, the rest between it and the hips is the
## spine (first → Spine, middle → Chest, last → UpperChest).
static func _spine(sk: Skeleton3D, out: Dictionary) -> void:
	var chain := []  # head's ancestors, top-down order reversed below
	var b := sk.get_bone_parent(int(out.Head))
	while b >= 0 and b != int(out.Hips):
		chain.push_front(b)
		b = sk.get_bone_parent(b)
	if b < 0:
		return  # the head does not hang off the hips
	var neck := -1
	for i in chain.size():
		if norm(sk.get_bone_name(chain[i])).begins_with("neck"):
			neck = i
			break
	var spine := chain.slice(0, neck) if neck >= 0 else chain
	if neck >= 0:
		out["Neck"] = chain[neck]
	if spine.size() >= 1:
		out["Spine"] = spine[0]
	if spine.size() >= 3:
		out["Chest"] = spine[spine.size() / 2]
		out["UpperChest"] = spine[-1]
	elif spine.size() == 2:
		out["Chest"] = spine[1]
