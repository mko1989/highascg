'use strict'

/**
 * WO-933 — before the cluster master replays its air journal to a server's Caspar (cluster-fanout.js catch-up), it
 * asks that Caspar what is on air. A server whose node restarted, whose link flapped or that just handed master back
 * kept playing: its channels already show the journal's clips, and a replay would cut them back to their first frame.
 * A channel counts as on air when every layer the journal puts a producer on shows it in the foreground there:
 *   - a file clip: the same clip (live-scene-reconcile.js pathsMatch, as the reconcile after connect);
 *   - any other source (route://, DECKLINK, [HTML], colours) or a CG template: a producer that is not empty.
 * Layers the journal does not cover are not compared (a replay would not clear them either).
 */

const net = require('node:net')
const {
	pathsMatch,
	parseLayerFgClipsFromChannelXml,
	parseLayerFgProducerTypesFromChannelXml,
} = require('../state/live-scene-reconcile')

const LINE = /^(\S+)\s+(\d+)-(\d+)(?:\s+(.*))?$/

/**
 * `INFO <ch>` for each channel on one short-lived AMCP connection (the fan-out's own connection drains its replies).
 * @returns {Promise<Map<number, string>|null>} channel → its XML ('' when Caspar refused it), null when that Caspar
 *   did not answer in time
 */
function queryChannels(host, port, channels, timeoutMs = 2000) {
	return new Promise((resolve) => {
		const out = new Map()
		const todo = [...channels]
		let buf = ''
		let done = false
		const sock = net.connect({ host, port })
		const finish = (v) => {
			if (done) return
			done = true
			clearTimeout(timer)
			sock.destroy()
			resolve(v)
		}
		const timer = setTimeout(() => finish(null), timeoutMs)
		const next = () => (todo.length ? sock.write(`INFO ${todo[0]}\r\n`) : finish(out))
		sock.on('connect', next)
		sock.on('error', () => finish(null))
		sock.on('close', () => finish(null))
		sock.on('data', (d) => {
			buf += d.toString('utf8')
			for (;;) {
				const head = /^(\d{3})[^\r\n]*\r\n/.exec(buf)
				if (!head || !todo.length) return
				if (head[1] !== '201') {
					out.set(todo.shift(), '')
					buf = buf.slice(head[0].length)
				} else {
					const end = buf.indexOf('</channel>')
					const stop = end < 0 ? -1 : buf.indexOf('\r\n', end)
					if (stop < 0) return
					out.set(todo.shift(), buf.slice(head[0].length, end + '</channel>'.length))
					buf = buf.slice(stop + 2)
				}
				next()
			}
		})
	})
}

/** The source of a PLAY / LOAD / LOADBG argument list: the quoted clip or the first token. */
function sourceOf(rest) {
	const s = String(rest || '').trim()
	if (!s) return ''
	const q = /^"((?:[^"\\]|\\.)*)"/.exec(s)
	return q ? q[1] : s.split(/\s+/)[0]
}

const isFileClip = (src) => !/^(\[|#|route:|decklink\b|ndi\b|screen\b|\w+:\/\/)/i.test(src)

/**
 * What the journal's lines of one channel leave in the foreground of each layer.
 * @returns {Map<number, { fg: string, cg: boolean }>} only layers with a producer
 */
function expectedLayers(lines, ch) {
	const layers = new Map()
	for (const line of lines) {
		const m = LINE.exec(String(line).trim())
		if (!m || Number(m[2]) !== ch) continue
		const verb = m[1].toUpperCase()
		const layer = Number(m[3])
		const L = layers.get(layer) || { fg: '', bg: '', cg: false }
		const src = sourceOf(m[4])
		if ((verb === 'PLAY' && src) || verb === 'LOAD') L.fg = src
		else if (verb === 'LOADBG') L.bg = src
		else if (verb === 'PLAY' && L.bg) Object.assign(L, { fg: L.bg, bg: '' })
		else if (verb === 'STOP') L.fg = ''
		else if (verb === 'CG') L.cg = !/^CLEAR\b/i.test(String(m[4] || '').trim())
		layers.set(layer, L)
	}
	for (const [l, L] of layers) if (!L.fg && !L.cg) layers.delete(l)
	return layers
}

/** True when that Caspar's channel (its INFO XML) already shows what these journal lines of master channel `ch` put on air. */
async function channelOnAir(lines, ch, xml) {
	const want = expectedLayers(lines, ch)
	if (!want.size) return true
	if (!xml) return false
	let clips
	let types
	try {
		clips = await parseLayerFgClipsFromChannelXml(xml)
		types = await parseLayerFgProducerTypesFromChannelXml(xml)
	} catch {
		return false
	}
	for (const [layer, L] of want) {
		const type = types[String(layer)] || ''
		if (!type || type === 'empty') return false
		if (L.fg && isFileClip(L.fg) && !pathsMatch(L.fg, clips[String(layer)] || '')) return false
	}
	return true
}

module.exports = { queryChannels, expectedLayers, channelOnAir, sourceOf }
