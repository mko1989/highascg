'use strict'

/**
 * WO-670 P4b — what this server has on air, kept as the AMCP lines that put it there, so the master can replay it to a
 * server that joins or reconnects mid-show (cluster-fanout.js). Per channel-layer:
 *   play  — the producer: a PLAY / LOAD with a clip starts over; LOADBG + bare PLAY are compacted to the last pair;
 *           PAUSE / RESUME / CALL kept in order; STOP / CLEAR empty it.
 *   mixer — the last MIXER line per property (DEFER stripped); MIXER … CLEAR empties it.
 *   cg    — CG lines in order since the last CG … CLEAR / CLEAR.
 * Channel-level MIXER (MASTERVOLUME, GRID…) is kept per property too. Replayed lines start clips from their first
 * frame (no SEEK to the master's position yet).
 */

const LINE = /^(\S+)\s+(\d+)(?:-(\d+))?(?:\s+(.*))?$/
const MAX_PLAY = 8
const MAX_CG = 20

function createAirJournal() {
	/** ch → { mixer: Map<prop, line>, layers: Map<layer, { play: string[], mixer: Map<prop, line>, cg: string[] }> } */
	const channels = new Map()

	const chan = (ch) => {
		if (!channels.has(ch)) channels.set(ch, { mixer: new Map(), layers: new Map() })
		return channels.get(ch)
	}
	const layerOf = (ch, l) => {
		const c = chan(ch)
		if (!c.layers.has(l)) c.layers.set(l, { play: [], mixer: new Map(), cg: [] })
		return c.layers.get(l)
	}

	function record(raw) {
		const line = String(raw || '').trim().replace(/\s+DEFER\s*$/i, '')
		const m = line.match(LINE)
		if (!m) return
		const verb = m[1].toUpperCase()
		const ch = Number(m[2])
		const layer = m[3] == null ? null : Number(m[3])
		const rest = String(m[4] || '').trim()
		const first = (rest.split(/\s+/)[0] || '').toUpperCase()
		if (verb === 'MIXER') {
			if (first === 'COMMIT' || !first) return
			const target = layer == null ? chan(ch) : layerOf(ch, layer)
			if (first === 'CLEAR') {
				target.mixer.clear()
				if (layer == null) for (const L of chan(ch).layers.values()) L.mixer.clear()
				return
			}
			if (rest.split(/\s+/).length < 2) return // a query (MIXER 1-10 OPACITY), not a setting
			target.mixer.set(first, line)
			return
		}
		if (verb === 'CLEAR') {
			const all = layer == null ? [...chan(ch).layers.values()] : [layerOf(ch, layer)]
			for (const L of all) Object.assign(L, { play: [], cg: [] })
			return
		}
		if (layer == null) return
		const L = layerOf(ch, layer)
		if (verb === 'CG') {
			if (first === 'CLEAR') L.cg = []
			else L.cg = [...L.cg, line].slice(-MAX_CG)
			return
		}
		if (verb === 'STOP') L.play = []
		else if ((verb === 'PLAY' && rest) || verb === 'LOAD') L.play = [line]
		else if (verb === 'PLAY') {
			const bg = L.play.filter((l) => /^LOADBG\s/i.test(l)).pop()
			L.play = bg ? [bg, line] : [...L.play, line].slice(-MAX_PLAY)
		} else if (['LOADBG', 'PAUSE', 'RESUME', 'CALL'].includes(verb)) L.play = [...L.play, line].slice(-MAX_PLAY)
	}

	/** The lines that rebuild these channels, channel mixer first, then layer by layer (producer, mixer, CG). */
	function replay(only) {
		const out = []
		for (const ch of [...channels.keys()].sort((a, b) => a - b)) {
			if (only && !only.has(ch)) continue
			const c = channels.get(ch)
			out.push(...c.mixer.values())
			for (const l of [...c.layers.keys()].sort((a, b) => a - b)) {
				const L = c.layers.get(l)
				out.push(...L.play, ...L.mixer.values(), ...L.cg)
			}
		}
		return out
	}

	return { record, replay }
}

module.exports = { createAirJournal }
