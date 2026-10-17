extends RefCounted
## WO-617 — who holds which video surface. Pure bookkeeping (no autoloads) so it is unit-testable;
## VideoSurfaces polls, uploads and leases only roles that are held.

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
