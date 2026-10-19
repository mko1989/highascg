extends RefCounted
## WO-617 — who holds which video surface. Pure bookkeeping (no autoloads) so it is unit-testable;
## VideoSurfaces polls, uploads and leases only roles that are held.

static var _runtime_re := RegEx.create_from_string("^(?:(?:pgm|prv)[1-4]|in(?:[1-9]|1[0-6])|ch[1-9][0-9]?)$")
var _holders := {}  # role -> { owner instance id: true }


## Returns true when this is the role's first holder (caller may lease it immediately).
func hold(role: String, owner: Object) -> bool:
	var h: Dictionary = _holders.get(role, {})
	var first := h.is_empty()
	h[owner.get_instance_id()] = true
	_holders[role] = h
	return first


func drop(role: String, owner: Object) -> void:
	var h: Dictionary = _holders.get(role, {})
	h.erase(owner.get_instance_id())
	if h.is_empty():
		_holders.erase(role)


func drop_all(owner: Object) -> void:
	for role in _holders.keys():
		drop(role, owner)


func is_held(role: String) -> bool:
	return _holders.has(role)


func roles() -> Array:
	return _holders.keys()


## Leased (server-ADDed) roles: pgm/prv 1–4, WO-616 inN (DeckLink input N's channel) and chN (any channel).
## Mirrors src/system/video-surfaces.js roleIndex(); anything else (the operator surface) is config, never leased.
static func is_runtime_role(role: String) -> bool:
	return _runtime_re.search(role) != null
