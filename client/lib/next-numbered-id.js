/**
 * WO-844: next free index for ids shaped `<prefix>_<n>` (str_1, rec_2, audio_3, out_4).
 *
 * `list.length + 1` hands out a duplicate as soon as a non-last entry was removed ([str_1, str_2] minus str_1
 * leaves length 1, so the next id is str_2 again). max(existing)+1 never reuses the id of a removed entry either, so
 * nothing that still references the old one is silently re-attached.
 *
 * @param {Array<{ id?: unknown }> | null | undefined} items
 * @param {string} prefix id prefix without the underscore (e.g. 'str')
 * @returns {number} 1 for an empty list
 */
export function nextNumberedIndex(items, prefix) {
	const re = new RegExp(`^${String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)$`)
	const used = new Set()
	let max = 0
	for (const it of Array.isArray(items) ? items : []) {
		const id = String(it?.id ?? '')
		used.add(id)
		const m = id.match(re)
		if (m) max = Math.max(max, parseInt(m[1], 10))
	}
	let n = max + 1
	while (used.has(`${prefix}_${n}`)) n++
	return n
}
