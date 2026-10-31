'use strict'
/**
 * WO-903: two (or more) operator GUI heads side by side — the pointer fence must go round all of them, not only the
 * primary one (resolveOperatorMonitorRect stays single-head: it also places the GUI window).
 *
 * Only heads that share y and height and touch edge to edge are joined, so the union never holds an off-screen gap
 * the pointer could vanish into. The joined rect's sysId is the comma list "DP-4,DP-6" (left to right) —
 * confine-pointer-barriers.py unions the same heads by name and keeps tracking them through RandR changes.
 */

/**
 * @param {{ sysId?: string|null, x: number, y: number, width: number, height: number, kind?: string }} rect
 * @param {{ operatorGui?: Record<string, { sysId?: string, x: number, y: number, width: number, height: number }> }} [layout]
 */
function spanOperatorHeads(rect, layout) {
	if (!rect?.sysId || rect.kind === 'multiview') return rect
	const heads = Object.values(layout?.operatorGui || {}).filter(
		(h) => h?.sysId && h.y === rect.y && h.height === rect.height && Number.isFinite(h.x) && h.width > 0,
	)
	if (!heads.some((h) => String(h.sysId) === String(rect.sysId))) return rect
	let x0 = rect.x
	let x1 = rect.x + rect.width
	const ids = [String(rect.sysId)]
	for (let grown = true; grown; ) {
		grown = false
		for (const h of heads) {
			const id = String(h.sysId)
			if (ids.includes(id)) continue
			if (h.x + h.width === x0) {
				x0 = h.x
				ids.unshift(id)
				grown = true
			} else if (h.x === x1) {
				x1 = h.x + h.width
				ids.push(id)
				grown = true
			}
		}
	}
	if (ids.length === 1) return rect
	return { ...rect, x: x0, width: x1 - x0, sysId: ids.join(','), heads: ids }
}

module.exports = { spanOperatorHeads }
