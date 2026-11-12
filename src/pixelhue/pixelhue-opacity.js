'use strict'

/**
 * WO-1050 — a PixelHue layer's opacity from a controller fader, without flooding the switcher.
 *
 * A fader sends up to ~100 values a second; the switcher gets at most one `PUT /unico/v1/layers/opacity` in flight per
 * layer. While one is in flight only the newest value is kept and goes next (latest wins) — never a backlog, so the
 * layer ends exactly where the fader stopped. Layers are independent: two faders on two layers both flow.
 */

const OPACITY_PATH = '/unico/v1/layers/opacity'

/**
 * @param {(path: string, body: object[]) => Promise<unknown>} put the reader's write (pixelhue-read.js `put`)
 * @param {{ log?: (msg: string) => void }} [opts]
 */
function createOpacityWriter(put, opts = {}) {
	const log = opts.log || ((msg) => console.warn(msg))
	/** layerId → { busy, next, sent, error } */
	const slots = new Map()

	async function pump(layerId, s) {
		s.busy = true
		while (s.next != null) {
			const opacity = s.next
			s.next = null
			try {
				await put(OPACITY_PATH, [{ layerId, opacity }])
				s.sent = opacity
				s.error = ''
			} catch (e) {
				s.error = String(e?.message || e)
				log(`[pixelhue] layer ${layerId} opacity ${opacity}: ${s.error}`)
			}
		}
		s.busy = false
	}

	/** Queue `opacity` (0..100) for `layerId`; returns at once. `queued` = it waits behind a PUT in flight. */
	function set(layerId, opacity) {
		let s = slots.get(layerId)
		if (!s) slots.set(layerId, (s = { busy: false, next: null, sent: null, error: '' }))
		const queued = s.busy
		s.next = opacity
		if (!queued) pump(layerId, s)
		return { queued, sent: s.sent, error: s.error }
	}

	return { set }
}

module.exports = { OPACITY_PATH, createOpacityWriter }
