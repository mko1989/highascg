'use strict'

/**
 * WO-790 — paced scrub seeks. Caspar rebuilds the decoder on every `CALL … SEEK` (av_producer.cpp `seek_internal`:
 * `decoders_.clear()` + a new filter graph), so a seek that lands before the previous one has produced a picture throws
 * that picture away. A ruler drag sends a seek per mouse move (~16 ms) while one seek takes ~120–250 ms to show on a 4K
 * NotchLC file, so the channel froze for the whole drag and only moved once the mouse stopped (owner 27.10: "when i hold
 * mouse button and dragging the video channel needs to reflect that imedietly").
 *
 * One seek per Caspar layer in flight: the next waits until OSC reports the layer at the target (`file/time`, updated
 * on every OSC message) or `MAX_WAIT_MS` passes, and only the newest target is sent. A drag then shows a new frame as
 * fast as Caspar can produce one, and always ends on the frame where the mouse stopped.
 */

const MAX_WAIT_MS = 300 // a seek OSC never confirms (no OSC, a clip without file/time) releases the layer anyway
const POLL_MS = 4
const AHEAD_S = 0.3 // a playing layer counts as there once it is at the target, up to this far past it
const SLACK_S = 0.05 // a source frame below the target (Caspar shows the frame at or before it)

/**
 * @param {object} engine the TimelineEngine (`self.amcp`, `self.oscState`, `_scrubGate` map)
 * @param {number} ch
 * @param {number} layer
 * @param {number} caspFrame SEEK target in channel frames
 * @param {number} chFps the channel's frame rate (caspFrame / chFps = file seconds, like OSC `file/time`)
 * @param {(err: Error) => void} onError
 */
function scrubSeek(engine, ch, layer, caspFrame, chFps, onError) {
	const gates = engine._scrubGate || (engine._scrubGate = new Map())
	const key = `${ch}-${layer}`
	const g = gates.get(key)
	const next = { caspFrame, sec: caspFrame / Math.max(1, chFps), onError }
	if (g) {
		g.pending = next
		return
	}
	send(engine, gates, key, ch, layer, next)
}

function send(engine, gates, key, ch, layer, target) {
	const g = { target, pending: null, sentAt: Date.now(), timer: null, before: elapsed(engine, ch, layer) }
	gates.set(key, g)
	engine.self.amcp.call(ch, layer, 'SEEK', String(target.caspFrame)).catch(target.onError)
	const poll = () => {
		if (gates.get(key) !== g) return
		if (!shown(engine, ch, layer, target.sec, g.before) && Date.now() - g.sentAt < MAX_WAIT_MS) {
			g.timer = setTimeout(poll, POLL_MS)
			if (g.timer.unref) g.timer.unref()
			return
		}
		gates.delete(key)
		if (g.pending) send(engine, gates, key, ch, layer, g.pending)
	}
	g.timer = setTimeout(poll, POLL_MS)
	if (g.timer.unref) g.timer.unref()
}

function elapsed(engine, ch, layer) {
	return Number(engine.self?.oscState?._channels?.[ch]?.layers?.[layer]?.file?.elapsed)
}

/**
 * The layer's file time (OSC) moved since the send and is at `sec` (a source frame of slack below, up to AHEAD_S past
 * it when playing). "Moved" keeps a small step back from counting as shown before Caspar has seeked at all.
 */
function shown(engine, ch, layer, sec, before) {
	const el = elapsed(engine, ch, layer)
	return Number.isFinite(el) && el !== before && el >= sec - SLACK_S && el <= sec + AHEAD_S
}

/**
 * Drop a layer's gate: a full transport (PLAY / LOAD) or a STOP replaces whatever seek was waiting, which would
 * otherwise land on the new clip.
 */
function cancelScrub(engine, ch, layer) {
	const g = engine._scrubGate?.get(`${ch}-${layer}`)
	if (!g) return
	clearTimeout(g.timer)
	engine._scrubGate.delete(`${ch}-${layer}`)
}

module.exports = { scrubSeek, cancelScrub, MAX_WAIT_MS }
