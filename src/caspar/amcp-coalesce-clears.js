'use strict'

/** Per-layer teardown lines that can be replaced by one `CLEAR <channel>`. */
const LAYER_TEARDOWN_RE = /^(?:CG|MIXER)\s+(\d+)-(\d+)\s+CLEAR$/i
const LAYER_STOP_RE = /^STOP\s+(\d+)-(\d+)$/i
const LAYER_CLEAR_RE = /^CLEAR\s+(\d+)-(\d+)$/i

function isLayerTeardownLine(line) {
	const t = String(line).trim()
	return LAYER_TEARDOWN_RE.test(t) || LAYER_STOP_RE.test(t) || LAYER_CLEAR_RE.test(t)
}

/**
 * Collapse large per-layer CLEAR/STOP storms (preview UI, multiview, timeline leftovers) into `CLEAR <ch>`.
 * Surgical 1–3 layer clears are left untouched.
 * @param {string[]} lines
 * @param {{ minTeardownLines?: number, skipChannels?: Set<number> }} [opts] - skipChannels: channels whose per-layer lines are already targeted (playback tracker) — never blanket those
 * @returns {{ lines: string[], coalesced: boolean, channels: number[] }}
 */
function coalescePerLayerClearStorm(lines, opts = {}) {
	const minTeardownLines = Math.max(2, parseInt(String(opts.minTeardownLines ?? 6), 10) || 6)
	const skipChannels = opts.skipChannels instanceof Set ? opts.skipChannels : null
	/** @type {Map<number, number[]>} */
	const indicesByCh = new Map()

	for (let i = 0; i < lines.length; i++) {
		const t = String(lines[i]).trim()
		if (!isLayerTeardownLine(t)) continue
		const m = t.match(/(\d+)-(\d+)/)
		if (!m) continue
		const ch = parseInt(m[1], 10)
		if (!Number.isFinite(ch) || ch < 1) continue
		if (skipChannels && skipChannels.has(ch)) continue
		if (!indicesByCh.has(ch)) indicesByCh.set(ch, [])
		indicesByCh.get(ch).push(i)
	}

	const skip = new Set()
	/** @type {Map<number, string>} */
	const replaceAt = new Map()
	const channels = []

	for (const [ch, indices] of indicesByCh) {
		if (indices.length < minTeardownLines) continue
		replaceAt.set(indices[0], `CLEAR ${ch}`)
		channels.push(ch)
		for (let j = 1; j < indices.length; j++) skip.add(indices[j])
	}

	if (replaceAt.size === 0) {
		return { lines, coalesced: false, channels: [] }
	}

	const out = []
	for (let i = 0; i < lines.length; i++) {
		if (skip.has(i)) continue
		if (replaceAt.has(i)) out.push(replaceAt.get(i))
		else out.push(lines[i])
	}
	return { lines: out, coalesced: true, channels }
}

module.exports = { coalescePerLayerClearStorm, LAYER_TEARDOWN_RE, LAYER_STOP_RE, LAYER_CLEAR_RE, isLayerTeardownLine }
