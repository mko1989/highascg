'use strict'

const { XRANDR_MODE_RE } = require('./xrandr-safety')

/**
 * WO-919 F4 / F20 — the xrandr plan meets the outputs X actually has.
 *
 * F4: a planned head on an output xrandr reports `disconnected` (an old project cabled to a port that is down) made
 * the one combined `xrandr --output …` command fail for EVERY head, and it still counted toward the canvas, so the
 * nodm restart ran for a monitor that is not there. Such a head is dropped (and reported).
 * F20: a connected, lit output the plan does not mention kept its old position and could sit on top of a planned head
 * (DP-6 at +1920+0 over DP-0). An unplanned head that overlaps the plan moves right of everything, keeping its
 * current mode and rate; one that overlaps nothing stays where it is. Off outputs are left alone.
 * With no xrandr answer (`states` empty) the plan passes through unchanged.
 */

/**
 * @typedef {{ name: string, connected: boolean, active: boolean, x: number, y: number, width: number, height: number, mode: string, rate: number|null }} OutputState
 */

/**
 * Every output line of `xrandr --query`, connected or not.
 * @param {string} raw
 * @returns {Map<string, OutputState>}
 */
function parseXrandrOutputStates(raw) {
	/** @type {Map<string, OutputState>} */
	const out = new Map()
	/** @type {OutputState|null} */
	let cur = null
	for (const line of String(raw || '').split('\n')) {
		const head = line.match(/^(\S+)\s+(connected|disconnected)\b/)
		if (head) {
			const geom = line.match(/(\d+)x(\d+)\+(\d+)\+(\d+)/)
			cur = {
				name: head[1],
				connected: head[2] === 'connected',
				active: !!geom,
				x: geom ? parseInt(geom[3], 10) : 0,
				y: geom ? parseInt(geom[4], 10) : 0,
				width: geom ? parseInt(geom[1], 10) : 0,
				height: geom ? parseInt(geom[2], 10) : 0,
				mode: geom ? `${geom[1]}x${geom[2]}` : '',
				rate: null,
			}
			out.set(cur.name, cur)
			continue
		}
		if (!cur || !/^\s/.test(line) || !line.includes('*')) continue
		const m = line.match(/^\s+(\d+x\d+\S*)\s+(.+)$/)
		if (!m) continue
		const tok = m[2].split(/\s+/).find((t) => t.includes('*'))
		const hz = tok ? parseFloat(tok.replace(/[^0-9.]/g, '')) : NaN
		if (XRANDR_MODE_RE.test(m[1])) cur.mode = m[1] // an interlaced/odd token keeps the plain WxH
		if (Number.isFinite(hz) && hz > 0) cur.rate = hz
	}
	return out
}

/** WxH of an xrandr mode token ("3840x1792", "3840x1792_50.00"), or 0x0. */
function modeSize(mode) {
	const m = String(mode || '').match(/^(\d+)x(\d+)/i)
	return m ? { width: parseInt(m[1], 10), height: parseInt(m[2], 10) } : { width: 0, height: 0 }
}

const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * @template {{ output: string, x: number, y: number, width?: number, height?: number, mode?: string }} H
 * @param {H[]} heads - the planned heads (xrandr output names)
 * @param {Map<string, OutputState>} states - from {@link parseXrandrOutputStates}
 * @returns {{ heads: H[], dropped: string[], moved: Array<{ output: string, x: number, y: number, mode: string, rate: number|null, width: number, height: number, from: { x: number, y: number } }> }}
 */
function reconcileHeadsWithOutputs(heads, states) {
	const list = Array.isArray(heads) ? heads : []
	if (!states || states.size === 0) return { heads: list, dropped: [], moved: [] }
	const kept = list.filter((h) => states.get(h.output)?.connected !== false)
	const dropped = list.filter((h) => !kept.includes(h)).map((h) => h.output)
	const rect = (h) => {
		const s = h.width > 0 && h.height > 0 ? { width: h.width, height: h.height } : modeSize(h.mode)
		return { x: Number(h.x) || 0, y: Number(h.y) || 0, ...s }
	}
	const taken = kept.map(rect)
	const planned = new Set(list.map((h) => h.output))
	const loose = [...states.values()].filter((s) => s.connected && s.active && !planned.has(s.name))
	const staying = loose.filter((s) => !taken.some((r) => overlaps(r, s)))
	let right = Math.max(0, ...[...taken, ...staying].map((r) => r.x + r.width))
	const moved = []
	for (const s of loose.filter((x) => !staying.includes(x))) {
		moved.push({ output: s.name, x: right, y: 0, mode: s.mode, rate: s.rate, width: s.width, height: s.height, from: { x: s.x, y: s.y } })
		right += s.width
	}
	return { heads: kept, dropped, moved }
}

module.exports = { parseXrandrOutputStates, reconcileHeadsWithOutputs, modeSize }
