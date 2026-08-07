/**
 * Optional cap on parseCinfMedia work for large catalogs (GET /api/state, /api/media, WS full snapshots).
 * @see HIGHASCG_GETSTATE_CINF_MAX
 */
'use strict'

/**
 * Max media rows to run CINF string parsing per snapshot. `0` = unlimited.
 * @returns {number}
 */
function getCinfEnrichCap() {
	const raw = parseInt(process.env.HIGHASCG_GETSTATE_CINF_MAX || '0', 10)
	return Number.isFinite(raw) && raw > 0 ? raw : 0
}

/**
 * @param {object[]} media
 * @param {object} ctx — app context with optional `_mediaProbeCache`
 * @param {(m: object) => object} enrichRow — full CINF + probe merge for one row
 * @param {number} [capOverride] — `0` forces full enrich; omit to use env cap
 * @returns {{ list: object[], truncated: boolean, enrichedMax: number }}
 */
function enrichMediaListWithCinfAndProbe(media, ctx, enrichRow, capOverride) {
	const cap = capOverride !== undefined ? capOverride : getCinfEnrichCap()
	if (!Array.isArray(media)) return { list: [], truncated: false, enrichedMax: 0 }
	if (cap === 0) {
		return { list: media.map((m) => enrichRow(m)), truncated: false, enrichedMax: 0 }
	}
	const list = media.map((m, idx) => {
		if (idx >= cap) {
			const probed = (ctx._mediaProbeCache || {})[m.id] || {}
			return { ...m, ...probed }
		}
		return enrichRow(m)
	})
	return {
		list,
		truncated: media.length > cap,
		enrichedMax: cap,
	}
}

module.exports = { getCinfEnrichCap, enrichMediaListWithCinfAndProbe }
