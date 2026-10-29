/**
 * WO-800 — per-layer audio levels for the Audio view's layer strips (web twin of the Godot
 * `features/audio/layer_levels.gd`). The node's GET /api/osc/audio-layers
 * (`{ channels: { "<ch>": { "<layer>": { nbChannels, levels: [{ dBFS, peak }] } } } }`, Caspar's per-layer
 * sample peaks) is polled while the view is visible; this maps a strip to its Caspar (channel, layer) and
 * reads the level. Scale, ballistics and colours are the strip meters' own (audio-mixer-meter-loop.js).
 * Pure module (no DOM, no fetch of its own) so the offline smoke can import it.
 */

export const LAYER_LEVELS_PATH = '/api/osc/audio-layers'
export const LAYER_LEVELS_POLL_MS = 200 // 5 Hz; the meter loop itself ticks at 50 ms
const LOOK_MIN = 10 // look layers, bank A (src/engine/look-layer-ranges.js); bank B = +100
const LOOK_MAX = 99
const BANK_B_OFFSET = 100
/**
 * An entry older than this (response `updatedAt` − entry `updatedAt`, both the node's clock) counts as absent. The node
 * only drops a layer after `osc.staleTimeoutMs` (5000 on the box), so without this a clip that ends would hold its last
 * level for up to 5 s. 500 ms = 12+ Caspar frames.
 */
export const LAYER_LEVELS_FRESH_MS = 500

/**
 * The physical [channel, layer] a layer strip meters, or null. Only `pgm:<ch>:layer:<L>` strips (their wide bar
 * is the channel sum); masters and dedicated input strips (`input:<ch>`, whose channel carries only that input)
 * get none. Scene look rows (`meta.lookLayer`) on a channel in bank "b" play on layer + 100.
 * @param {string} key meter key
 * @param {{ lookLayer?: boolean } | undefined} meta
 * @param {Record<string, unknown> | undefined} banks scene.programLayerBankByChannel
 * @returns {[number, number] | null}
 */
export function layerLevelTarget(key, meta, banks) {
	const m = /^pgm:(\d+):layer:(\d+)$/.exec(String(key || ''))
	if (!m) return null
	const ch = parseInt(m[1], 10)
	let ln = parseInt(m[2], 10)
	const bank = banks && typeof banks === 'object' ? banks[String(ch)] : null
	if (meta?.lookLayer && ln >= LOOK_MIN && ln <= LOOK_MAX && (bank === 'b' || bank === true)) ln += BANK_B_OFFSET
	return [ch, ln]
}

/**
 * The response's entry for one layer, or null (no audio on that layer: Caspar stopped sending it — absent, or
 * older than LAYER_LEVELS_FRESH_MS against the response time).
 * @param {unknown} data
 */
export function layerLevelEntry(data, ch, ln) {
	const d = /** @type {any} */ (data)
	const e = d?.channels?.[String(ch)]?.[String(ln)]
	if (!e || typeof e !== 'object') return null
	if (Number.isFinite(d.updatedAt) && Number.isFinite(e.updatedAt) && d.updatedAt - e.updatedAt > LAYER_LEVELS_FRESH_MS)
		return null
	return e
}

/**
 * The layer's level: the loudest audio channel's dBFS over `nbChannels` (−99 when none is a number).
 * @param {unknown} entry
 */
export function layerLevelPeak(entry) {
	const levels = /** @type {any} */ (entry)?.levels
	if (!Array.isArray(levels)) return -99
	let n = levels.length
	const nb = Number(/** @type {any} */ (entry)?.nbChannels)
	if (Number.isFinite(nb) && nb > 0) n = Math.min(n, nb)
	let best = -99
	for (let i = 0; i < n; i++) {
		const d = levels[i]?.dBFS
		if (Number.isFinite(d)) best = Math.max(best, d)
	}
	return best
}

/**
 * `{ present, level }` for a strip: present = the layer is in the response (it carries audio right now).
 * @returns {{ present: boolean, level: number }}
 */
export function readLayerLevel(data, key, meta, banks) {
	const t = layerLevelTarget(key, meta, banks)
	const e = t ? layerLevelEntry(data, t[0], t[1]) : null
	return { present: !!e, level: e ? layerLevelPeak(e) : -99 }
}

/**
 * Starts / stops the 5 Hz poll. One request at a time; a failed read clears the data (lanes hide rather than
 * freeze). `get` = apiGet; `wanted()` = the view is visible and at least one lane exists.
 * @param {{ get: (path: string) => Promise<unknown>, wanted: () => boolean }} opts
 */
export function createLayerLevelPoller({ get, wanted }) {
	/** @type {unknown} */
	let data = null
	let busy = false
	/** @type {ReturnType<typeof setInterval> | null} */
	let timer = null
	const poll = async () => {
		if (busy) return
		if (!wanted() || (typeof document !== 'undefined' && document.hidden)) {
			data = null
			return
		}
		busy = true
		try {
			const res = await get(LAYER_LEVELS_PATH)
			data = res && typeof res === 'object' && wanted() ? res : null
		} catch {
			data = null
		} finally {
			busy = false
		}
	}
	return {
		data: () => data,
		start() {
			if (timer) return
			timer = setInterval(poll, LAYER_LEVELS_POLL_MS)
			void poll()
		},
		stop() {
			if (timer) clearInterval(timer)
			timer = null
			data = null // never show a level from before the view was hidden
		},
	}
}
