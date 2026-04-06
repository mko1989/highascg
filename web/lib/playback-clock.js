/**
 * Client-side time derived from playback.matrix (startedAt + durationMs) — no server polling.
 * Values update whenever you read (wall clock). Optional rAF subscription for UI refresh.
 */

/**
 * @param {{ startedAt?: number, playing?: boolean, durationMs?: number | null, loop?: boolean } | undefined} cell
 * @returns {number} elapsed ms since startedAt (mod duration if loop)
 */
export function cellElapsedMs(cell) {
	if (!cell?.playing || cell.startedAt == null) return 0
	let e = Date.now() - cell.startedAt
	const d = cell.durationMs
	if (cell.loop && d > 0) e = e % d
	return Math.max(0, e)
}

/**
 * @returns {number | null} remaining ms, or null if unknown / still / route-only
 */
export function cellRemainingMs(cell) {
	if (!cell?.playing || cell.durationMs == null || cell.durationMs <= 0) return null
	const r = cell.durationMs - cellElapsedMs(cell)
	return Math.max(0, r)
}
