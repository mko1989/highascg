'use strict'

/**
 * WO-1088 — the cumulative Caspar OSC counters the keeping-up watch reads (src/health/keeping-up-service.js): per
 * channel its tick rate (`framerate`), per output port the consumer counters (screen presented / dropped, shm
 * published / dropped, portaudio fifo under- / overruns), per layer the shm producer's frames taken. They are kept
 * apart from the OSC state on purpose: they change every tick and nothing in the WS `osc` snapshot reads them.
 * Rates come from counter deltas, never from message counts — the node's UDP socket drops a datagram now and then.
 */

const OUTPUT_KEYS = {
	consumer: 'consumer',
	'screen/presented_frames': 'presented',
	'screen/dropped_frames': 'dropped',
	'screen/name': 'name',
	'shm/published': 'published',
	'shm/dropped': 'shmDropped',
	'shm/name': 'name',
	'fifo-underruns': 'underruns',
	'fifo-overruns': 'overruns',
}
const LAYER_KEYS = { 'foreground/shm/frames': 'frames', 'foreground/shm/signal': 'signal', 'foreground/shm/name': 'name' }

class OscHealthCounters {
	constructor(now = Date.now) {
		this._now = now
		/** @type {Map<number, { fps: number, at: number }>} */
		this.channels = new Map()
		/** @type {Map<string, Record<string, unknown> & { ch: number, port: number, at: number }>} */
		this.outputs = new Map()
		/** @type {Map<string, Record<string, unknown> & { ch: number, layer: number, at: number }>} */
		this.layers = new Map()
		this.lastAt = 0
	}

	/** One routed OSC message (`rest` = the address after `/channel/<ch>/`). Cheap: two string tests per message. */
	note(ch, rest, vals) {
		const now = this._now()
		this.lastAt = now
		if (rest === 'framerate') {
			const num = Number(vals[0])
			const den = Number(vals[1]) || 1
			if (num > 0) this.channels.set(ch, { fps: num / den, at: now })
			return
		}
		if (rest.startsWith('output/port/')) {
			const slash = rest.indexOf('/', 12)
			if (slash < 0) return
			const field = OUTPUT_KEYS[rest.slice(slash + 1)]
			if (!field) return
			const port = parseInt(rest.slice(12, slash), 10)
			const key = `${ch}/${port}`
			let o = this.outputs.get(key)
			if (!o) this.outputs.set(key, (o = { ch, port, at: now }))
			o[field] = typeof vals[0] === 'string' ? vals[0] : Number(vals[0]) // Number(Long) → its value
			o.at = now
			return
		}
		if (rest.startsWith('stage/layer/') && rest.includes('/shm/')) {
			const slash = rest.indexOf('/', 12)
			const field = LAYER_KEYS[rest.slice(slash + 1)]
			if (!field) return
			const layer = parseInt(rest.slice(12, slash), 10)
			const key = `${ch}/${layer}`
			let l = this.layers.get(key)
			if (!l) this.layers.set(key, (l = { ch, layer, at: now }))
			l[field] = field === 'name' ? String(vals[0]) : field === 'signal' ? vals[0] === true : Number(vals[0])
			l.at = now
		}
	}

	/** Plain copy for the sampler: entries older than `staleMs` (consumer / layer gone, Caspar down) are left out. */
	snapshot(staleMs = 3000) {
		const now = this._now()
		const fresh = (m) => [...m.values()].filter((e) => now - e.at <= staleMs).map((e) => ({ ...e }))
		return { at: now, lastAt: this.lastAt, channels: Object.fromEntries([...this.channels].filter(([, c]) => now - c.at <= staleMs).map(([k, c]) => [k, c.fps])),
			outputs: fresh(this.outputs), layers: fresh(this.layers) }
	}
}

module.exports = { OscHealthCounters }
