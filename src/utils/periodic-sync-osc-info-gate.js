'use strict'

/**
 * WO-477 — gate for the OSC INFO supplement (WO-252).
 *
 * WO-252 added `INFO <program channel>` polling because the 2.6-dev binary omits `file/time` for
 * some clips over OSC, so timer bars had no duration. It ran on a **fixed 2s heartbeat for as long
 * as an OSC listener existed** — `isOscPlaybackActive()` only checks that `ctx.oscState` is present,
 * not that anything is playing. An idle box therefore sent `INFO 1` + `INFO 3` every two seconds,
 * forever, which is exactly the AMCP chatter the standing rule forbids.
 *
 * The duration is a property of the CLIP, so it needs asking once per clip — not once per tick.
 * This gate lets a channel through only when its OSC clip signature CHANGES, and then for at most
 * `MAX_TRIES_PER_CLIP` ticks (one immediate + one retry, since the first INFO can land before
 * Caspar has parsed the file). Steady playback and idle both cost zero AMCP commands.
 *
 * `osc_info_supplement_ms: 0` still disables the supplement outright, upstream of this gate.
 */

/** One INFO on the clip change, one retry for a Caspar that has not parsed the file yet. */
const MAX_TRIES_PER_CLIP = 2

/** @type {Map<string, { sig: string, tries: number }>} */
const _gate = new Map()

/**
 * Identity of what is on a channel right now, from the OSC aggregate: the clip (or template/type)
 * per layer. Changes exactly when the content changes — which is the only time a fresh INFO can
 * tell us something new about durations.
 * @param {object} self
 * @param {number} ch
 * @returns {string}
 */
function oscClipSignatureForChannel(self, ch) {
	const snap = typeof self?.oscState?.getSnapshot === 'function' ? self.oscState.getSnapshot() : null
	const layers = snap?.channels?.[String(ch)]?.layers
	if (!layers || typeof layers !== 'object') return ''
	const parts = []
	for (const layerId of Object.keys(layers).sort((a, b) => Number(a) - Number(b))) {
		const layer = layers[layerId] || {}
		const f = layer.file || {}
		const clip = String(f.name || f.path || layer.template?.path || layer.type || '')
		if (!clip || clip === 'empty') continue
		parts.push(`${layerId}=${clip}`)
	}
	return parts.join('|')
}

/**
 * @param {object} self
 * @param {number} ch
 * @returns {boolean} whether this tick may spend an AMCP INFO on this channel
 */
function shouldSendOscInfoSupplement(self, ch) {
	const key = String(ch)
	const sig = oscClipSignatureForChannel(self, ch)
	/* Nothing on the channel — an INFO would describe an empty stage. */
	if (!sig) {
		_gate.delete(key)
		return false
	}
	const prev = _gate.get(key)
	if (!prev || prev.sig !== sig) {
		_gate.set(key, { sig, tries: 1 })
		return true
	}
	if (prev.tries >= MAX_TRIES_PER_CLIP) return false
	prev.tries += 1
	return true
}

/** Drop all gate state (teardown, reconnect, tests) so the next clip is asked about again. */
function resetOscInfoSupplementGate() {
	_gate.clear()
}

module.exports = {
	MAX_TRIES_PER_CLIP,
	oscClipSignatureForChannel,
	shouldSendOscInfoSupplement,
	resetOscInfoSupplementGate,
}
