'use strict'

/**
 * WO-1029 — Caspar 2.6 `INFO <ch>` XML → what each layer shows, for the air snapshot (air-snapshot.js) and the restore
 * (air-snapshot-restore.js). Pure, no I/O.
 *
 * Shape on this build (core/video_channel.cpp, core/producer/layer.cpp, av_producer.cpp, route_producer.cpp,
 * html_producer.cpp, color_producer.cpp):
 *   channel.framerate = [num * fields, den]  (the simulator sends one value)
 *   stage.layer.layer_N.foreground = { producer, paused, file: { name, path, clip: [start, len], time: [t, dur] },
 *     loop, route: { channel, layer }, color }        — html: file.path is the URL; decklink: file.path = device index
 * `file/time` is seconds (frames / the channel fps); SEEK takes CHANNEL frames (memory: SEEK n = s × channel fps).
 */

const { parseString } = require('xml2js')

const first = (v) => (Array.isArray(v) ? v[0] : v)
const text = (v) => {
	const x = first(v)
	if (x == null) return ''
	if (typeof x === 'object') return String(x._ ?? '')
	return String(x)
}
const nums = (v) =>
	(Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => parseFloat(text(x))).filter((n) => Number.isFinite(n))
const bool = (v) => /^(true|1)$/i.test(text(v).trim())

/** `[50000, 1000]` → 50, `[50]` → 50, '' → null. */
function fpsOf(framerate) {
	const n = nums(framerate)
	if (!n.length || !(n[0] > 0)) return null
	const fps = n.length >= 2 && n[1] > 0 ? n[0] / n[1] : n[0]
	return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : null
}

/** One foreground element → the layer record ('' producer / 'empty' = nothing on it → null). */
function layerOf(n, fg) {
	if (!fg || typeof fg !== 'object') return null
	const producer = text(fg.producer).trim().toLowerCase()
	if (!producer || producer === 'empty') return null
	const file = first(fg.file) || {}
	const path = text(file.path).trim()
	const name = text(file.name).trim()
	const time = nums(file.time)
	const clipRange = nums(file.clip)
	const route = first(fg.route)
	const rc = route ? parseInt(text(route.channel), 10) : NaN
	const rl = route ? parseInt(text(route.layer), 10) : NaN
	const out = { layer: n, producer, paused: bool(fg.paused), loop: bool(fg.loop) }
	if (producer === 'route') {
		if (Number.isFinite(rc)) out.route = { channel: rc, layer: Number.isFinite(rl) ? rl : null }
		return out
	}
	if (producer === 'html') {
		if (path) out.url = path
		return out
	}
	if (producer === 'decklink') {
		if (/^\d+$/.test(path)) out.device = parseInt(path, 10)
		return out
	}
	if (producer === 'color') {
		const c = text(fg.color).trim()
		if (c) out.color = c
		return out
	}
	const clip = name || clipIdFromPath(path)
	if (clip) out.clip = clip
	if (time.length) out.time_s = time[0]
	const len = time.length >= 2 && time[1] > 0 ? time[1] : clipRange.length >= 2 && clipRange[1] > 0 ? clipRange[1] : null
	if (len != null) out.length_s = len
	return out
}

/** `media/sub/Clip.mov` → `SUB/CLIP` style id is the reconcile's job; here only the extension-less tail path. */
function clipIdFromPath(p) {
	const s = String(p || '').trim()
	if (!s) return ''
	const m = /(?:^|[/\\])media[/\\](.+)$/i.exec(s)
	const rel = (m ? m[1] : s.split(/[/\\]/).pop() || '').replace(/\\/g, '/')
	return rel.replace(/\.[A-Za-z0-9]{1,5}$/, '')
}

/**
 * @param {string} xml INFO <ch> XML
 * @returns {Promise<{ fps: number|null, layers: object[] }|null>} null = not parseable (unknown, not "empty")
 */
function parseChannelInfo(xml) {
	if (!xml || typeof xml !== 'string' || !xml.includes('<channel')) return Promise.resolve(null)
	return new Promise((resolve) => {
		parseString(xml, { explicitArray: false }, (err, res) => {
			if (err || !res?.channel) return resolve(null)
			try {
				const ch = res.channel
				const stage = first(ch.stage)
				const wrap = stage && first(stage.layer)
				const layers = []
				if (wrap && typeof wrap === 'object') {
					for (const key of Object.keys(wrap)) {
						if (!key.startsWith('layer_')) continue
						const n = parseInt(key.slice(6), 10)
						if (!Number.isFinite(n)) continue
						const rec = layerOf(n, first(first(wrap[key])?.foreground))
						if (rec) layers.push(rec)
					}
				}
				layers.sort((a, b) => a.layer - b.layer)
				resolve({ fps: fpsOf(ch.framerate), layers })
			} catch {
				resolve(null)
			}
		})
	})
}

module.exports = { parseChannelInfo, fpsOf }
