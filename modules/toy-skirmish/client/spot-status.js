/**
 * Stage Skirmish (WO-1081), Spotlight mode (WO-1083) — the HUD line and the minimap ring from the state's `spot` — pure.
 *   spotStatus(spot, o) → { text, kind: 'mine' | 'other' | 'fight' | 'free' } or null
 *     o = { meId, phase, sNow, me: { x, z } | null, nameOf: (id) => string, s: scene scale, warnS }
 *   The text names who holds the light (+1 a second in a match), "contested", or "free"; within warnS seconds of the
 *   move it says so; when the pool is out of the player's view (> VIEW_U away) an arrow points to it (screen-up = −Z).
 */
export const VIEW_U = 5 // about the follow camera's shortest reach (server sk-view.js: 4.75 u down-screen)

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']

/** Arrow for the plan direction (dx, dz): screen-up is −Z, screen-right +X. */
export function arrowFor(dx, dz) {
	const a = Math.atan2(dx, -dz) // 0 = up, clockwise
	const k = Math.round(a / (Math.PI / 4))
	return ARROWS[(k + 8) % 8]
}

export function spotStatus(spot, o) {
	if (!spot || ![spot.x, spot.z, spot.r].every(Number.isFinite)) return null
	const match = o.phase === 'match'
	let text
	let kind
	if (spot.contested) {
		text = 'Light contested!'
		kind = 'fight'
	} else if (spot.holder != null && spot.holder === o.meId) {
		text = match ? 'You hold the light · +1 a second' : 'You hold the light (warm-up)'
		kind = 'mine'
	} else if (spot.holder != null) {
		text = `${o.nameOf(spot.holder)} holds the light`
		kind = 'other'
	} else {
		text = 'The light is free'
		kind = 'free'
	}
	if (o.me && Number.isFinite(o.me.x)) {
		const dx = spot.x - o.me.x
		const dz = spot.z - o.me.z
		const d = Math.hypot(dx, dz) / (o.s || 1)
		if (d > VIEW_U) text = `${arrowFor(dx, dz)} ${text} · ${Math.round(d)} u`
	}
	const left = Number.isFinite(spot.movesAt) ? (spot.movesAt - o.sNow) / 1000 : Infinity
	if (left > 0 && left <= (o.warnS ?? 5)) text += ` · moves in ${Math.ceil(left)}`
	return { text, kind }
}
