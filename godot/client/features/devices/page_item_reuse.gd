extends RefCounted
## WO-923 — which built nodes an item page (server_controls.gd) keeps when its item list changes. A poll that changes
## one row ("Commands sent", "synced 5s ago") used to rebuild the whole page every 3 s while a backup was paired, and a
## click whose press and release straddled a rebuild was lost. Now only the changed items get new nodes.


## For each new item, the index of an equal old item whose node is kept, or -1 (build a new one). The same index wins;
## otherwise the first unused equal one, so an item appearing or vanishing above does not rebuild the rest. Each old
## index is used at most once.
static func plan(old: Array, new: Array) -> PackedInt32Array:
	var by_hash := {}  # hash → old indices, in order
	for i in old.size():
		var h := hash(old[i])
		if not by_hash.has(h):
			by_hash[h] = []
		by_hash[h].append(i)
	var used := {}
	var out := PackedInt32Array()
	out.resize(new.size())
	for j in new.size():
		var k := -1
		if j < old.size() and not used.has(j) and old[j] == new[j]:
			k = j
		else:
			for i in by_hash.get(hash(new[j]), []):
				if not used.has(i) and old[i] == new[j]:
					k = i
					break
		out[j] = k
		if k >= 0:
			used[k] = true
	return out
