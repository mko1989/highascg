'use strict'

/**
 * WO-453: playback/mixer/data state behind {@link AmcpSimulated} (`offline_mode` / `--no-caspar`).
 * Tracks what the real Caspar would be doing so INFO XML and the sim OSC feeder
 * (src/caspar/sim-osc-feeder.js) can report it the same way the real server does.
 */

/** Read per clip (not at module load) so tests/operators can retune without a restart. */
function defaultClipSec() {
	const v = parseFloat(process.env.HIGHASCG_SIM_CLIP_SEC || '')
	return Number.isFinite(v) && v > 0 ? v : 30
}

/** Split `1-10` / `1` into { ch, layer } (layer null when absent). */
function parseChLayer(token) {
	const m = String(token || '').match(/^(\d+)(?:-(\d+))?$/)
	if (!m) return null
	return { ch: parseInt(m[1], 10), layer: m[2] != null ? parseInt(m[2], 10) : null }
}

/** First token after the channel-layer spec: quoted ("CLIP NAME") or bare. */
function parseClipToken(rest) {
	const s = String(rest || '').trim()
	if (!s) return { clip: null, tail: '' }
	if (s.startsWith('"')) {
		const m = s.match(/^"((?:[^"\\]|\\.)*)"\s*(.*)$/)
		if (m) return { clip: m[1].replace(/\\(.)/g, '$1'), tail: m[2] }
	}
	const m = s.match(/^(\S+)\s*(.*)$/)
	return { clip: m ? m[1] : null, tail: m ? m[2] : '' }
}

class SimPlaybackState {
	constructor() {
		/** @type {Map<number, Map<number, object>>} ch → layer → cell */
		this.channels = new Map()
		/** @type {Map<string, string>} DATA STORE key → payload */
		this.dataStore = new Map()
		/** @type {Map<string, string>} `${ch}-${layer}/PROP` → raw args string */
		this.mixerStore = new Map()
	}

	_layer(ch, layer) {
		if (!this.channels.has(ch)) this.channels.set(ch, new Map())
		const m = this.channels.get(ch)
		if (!m.has(layer)) m.set(layer, { fg: null, bg: null, cg: null, emptiedAt: 0 })
		return m.get(layer)
	}

	_makeClip(clip, { loop = false, paused = false } = {}) {
		return {
			clip: String(clip),
			loop,
			paused,
			duration: defaultClipSec(),
			startedAt: Date.now(),
			/** elapsed frozen here while paused (sec) */
			pausedElapsed: paused ? 0 : null,
		}
	}

	/** Elapsed seconds honoring pause/loop wrap. Returns null when nothing plays. */
	elapsedOf(cell) {
		const fg = cell && cell.fg
		if (!fg) return null
		if (fg.paused) return fg.pausedElapsed || 0
		let e = (Date.now() - fg.startedAt) / 1000
		if (fg.loop && fg.duration > 0) e = e % fg.duration
		return e
	}

	/**
	 * Apply one playout command. Returns true when the command was a recognized
	 * playback mutation (caller answers 202).
	 */
	apply(first, rest) {
		const parts = String(rest || '').trim()
		const clToken = parts.match(/^(\S+)\s*(.*)$/)
		const cl = clToken ? parseChLayer(clToken[1]) : null
		const tail = clToken ? clToken[2] : ''

		switch (first) {
			case 'PLAY': {
				if (!cl) return false
				const cell = this._layer(cl.ch, cl.layer ?? 0)
				const { clip, tail: flags } = parseClipToken(tail)
				if (clip) {
					cell.fg = this._makeClip(clip, { loop: /\bLOOP\b/i.test(flags) })
				} else if (cell.bg) {
					cell.fg = { ...cell.bg, paused: false, startedAt: Date.now(), pausedElapsed: null }
					cell.bg = null
				} else if (cell.fg && cell.fg.paused) {
					cell.fg.paused = false
					cell.fg.startedAt = Date.now() - (cell.fg.pausedElapsed || 0) * 1000
					cell.fg.pausedElapsed = null
				}
				return true
			}
			case 'LOADBG': {
				if (!cl) return false
				const cell = this._layer(cl.ch, cl.layer ?? 0)
				const { clip, tail: flags } = parseClipToken(tail)
				if (!clip) return true
				cell.bg = this._makeClip(clip, { loop: /\bLOOP\b/i.test(flags), paused: true })
				cell.bg.auto = /\bAUTO\b/i.test(flags)
				return true
			}
			case 'LOAD': {
				if (!cl) return false
				const cell = this._layer(cl.ch, cl.layer ?? 0)
				const { clip } = parseClipToken(tail)
				if (clip) {
					cell.fg = this._makeClip(clip, { paused: true })
					cell.fg.pausedElapsed = 0
				}
				return true
			}
			case 'PAUSE': {
				if (!cl) return false
				const cell = this._layer(cl.ch, cl.layer ?? 0)
				if (cell.fg && !cell.fg.paused) {
					cell.fg.pausedElapsed = this.elapsedOf(cell)
					cell.fg.paused = true
				}
				return true
			}
			case 'RESUME': {
				if (!cl) return false
				const cell = this._layer(cl.ch, cl.layer ?? 0)
				if (cell.fg && cell.fg.paused) {
					cell.fg.startedAt = Date.now() - (cell.fg.pausedElapsed || 0) * 1000
					cell.fg.paused = false
					cell.fg.pausedElapsed = null
				}
				return true
			}
			case 'STOP': {
				if (!cl) return false
				const cell = this._layer(cl.ch, cl.layer ?? 0)
				cell.fg = null
				cell.emptiedAt = Date.now()
				return true
			}
			case 'CLEAR': {
				if (!cl) return false
				if (cl.layer == null) {
					const m = this.channels.get(cl.ch)
					if (m) {
						for (const cell of m.values()) {
							cell.fg = null
							cell.bg = null
							cell.cg = null
							cell.emptiedAt = Date.now()
						}
					}
				} else {
					const cell = this._layer(cl.ch, cl.layer)
					cell.fg = null
					cell.bg = null
					cell.cg = null
					cell.emptiedAt = Date.now()
				}
				return true
			}
			case 'SWAP': {
				const other = parseChLayer((tail.match(/^(\S+)/) || [])[1])
				if (!cl || !other) return false
				const a = this._layer(cl.ch, cl.layer ?? 0)
				const b = this._layer(other.ch, other.layer ?? 0)
				const ka = { fg: a.fg, bg: a.bg, cg: a.cg }
				a.fg = b.fg; a.bg = b.bg; a.cg = b.cg
				b.fg = ka.fg; b.bg = ka.bg; b.cg = ka.cg
				return true
			}
			case 'CALL': {
				if (!cl) return false
				const cell = this._layer(cl.ch, cl.layer ?? 0)
				const m = tail.match(/\bLOOP\s+(\d)/i)
				if (m && cell.fg) cell.fg.loop = m[1] === '1'
				return true
			}
			default:
				return false
		}
	}

	/** CG grammar: `CG ch-layer VERB cgLayer ["template"] [play] ["data"]`. */
	applyCg(rest) {
		const m = String(rest || '').trim().match(/^(\S+)\s+(\S+)\s*(.*)$/)
		if (!m) return false
		const cl = parseChLayer(m[1])
		if (!cl) return false
		const verb = m[2].toUpperCase()
		const cell = this._layer(cl.ch, cl.layer ?? 0)
		if (verb === 'ADD') {
			const t = m[3].match(/^\d+\s+"((?:[^"\\]|\\.)*)"/)
			cell.cg = { template: t ? t[1] : '', playing: /\s1(\s|$)/.test(m[3]) }
		} else if (verb === 'PLAY') {
			if (cell.cg) cell.cg.playing = true
		} else if (verb === 'STOP') {
			if (cell.cg) cell.cg.playing = false
		} else if (verb === 'REMOVE' || verb === 'CLEAR') {
			cell.cg = null
		}
		return true
	}
}

module.exports = { SimPlaybackState, parseChLayer, parseClipToken, defaultClipSec }
