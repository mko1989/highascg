/**
 * Stage Salad (WO-1089) — the ammo table (work/notes/stage-salad-contract.md §4). Pure, shared: the server referee,
 * the bots and the browser all import this one file (the server through require() of an ES module).
 * Lengths in metres, speeds m/s, times s, angles degrees. Our own vegetables, our own numbers.
 */

export const VEGGIES = Object.freeze({
	tomato: Object.freeze({ id: 'tomato', name: 'Tomato', r: 0.045, vMin: 7, vMax: 17, k: 0.018, e: 0, bounces: 0, splat: true, reload: 0.8, pitch: 22, points: 1, color: '#e2392b', n: 1 }),
	potato: Object.freeze({ id: 'potato', name: 'Potato', r: 0.05, vMin: 6, vMax: 13, k: 0.006, e: 0.25, bounces: 2, splat: false, reload: 1.2, pitch: 34, points: 1.2, color: '#a87a4a', n: 1 }),
	carrot: Object.freeze({ id: 'carrot', name: 'Carrot', r: 0.03, vMin: 9, vMax: 20, k: 0.008, e: 0.15, bounces: 1, splat: false, reload: 1, pitch: 12, points: 1.3, color: '#f07c1c', n: 1 }),
	cabbage: Object.freeze({ id: 'cabbage', name: 'Cabbage', r: 0.11, vMin: 6, vMax: 15, k: 0.022, e: 0.2, bounces: 1, splat: true, reload: 1.6, pitch: 30, points: 0.8, color: '#7cc44e', n: 1 }),
	onion: Object.freeze({ id: 'onion', name: 'Onion', r: 0.045, vMin: 7, vMax: 16, k: 0.012, e: 0.6, bounces: 3, splat: false, reload: 1, pitch: 20, points: 1, color: '#d9a441', n: 1, bank: 1.5 }),
	peas: Object.freeze({ id: 'peas', name: 'Pea burst', r: 0.018, vMin: 8, vMax: 17, k: 0.02, e: 0, bounces: 0, splat: true, reload: 1.4, pitch: 18, points: 0.3, color: '#5fbf3a', n: 5, spreadDeg: 3 }),
})

export const VEG_IDS = Object.freeze(Object.keys(VEGGIES))

/** Launch power limits (share of the vegetable's speed range). */
export const POWER_MIN = 0.15
export const POWER_MAX = 1

/** id → the vegetable or null. */
export function vegOf(id) {
	return typeof id === 'string' && Object.prototype.hasOwnProperty.call(VEGGIES, id) ? VEGGIES[id] : null
}

/** Launch speed for a vegetable at `power` (clamped to POWER_MIN…POWER_MAX). */
export function launchSpeed(veg, power) {
	const p = Math.max(POWER_MIN, Math.min(POWER_MAX, Number(power) || 0))
	return veg.vMin + (p - POWER_MIN) / (POWER_MAX - POWER_MIN) * (veg.vMax - veg.vMin)
}
