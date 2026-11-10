'use strict'

/**
 * WO-1029 C9 — pictures for the virtual boxes. The fake Caspars play nothing and write no shared memory, so a bed node
 * started with HIGHASCG_SANDBOX_FEED_FRAMES=<box id> (sandbox only, src/system/video-feed.js feedFrameHook) gets this
 * stand-in for its video-feed worker: per wanted surface a small real JPEG at the asked fps, with a JPEG comment
 * segment that names who made it:
 *   "highascg-test-frame box=<box id> role=<worker key> width=<asked width> fps=<asked fps> seq=<n>"
 * so a scenario can tell which box encoded a frame and at what size it was asked (the worker key carries the tier:
 * `pgm3~relay` = encoded for a linked server's relay). Same messages as video-feed-worker.js.
 */

const { EventEmitter } = require('events')

// 64×36 grey MJPEG frame (ffmpeg color source, q8)
const BASE = Buffer.from(
	'/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjExLjEwMAD/2wBDAAgQEBMQExYWFhYWFhoYGhsbGxoaGhobGxsdHR0iIiIdHR0bGx0dICAiIiUmJSMjIiMmJigoKDAwLi44ODpFRVP/xABMAAEBAAAAAAAAAAAAAAAAAAAABgEBAQAAAAAAAAAAAAAAAAAAAAQQAQAAAAAAAAAAAAAAAAAAAAARAQAAAAAAAAAAAAAAAAAAAAD/wAARCAAkAEADASIAAhEAAxEA/9oADAMBAAIRAxEAPwCAAVpAAAAAAAAAAAAAAAAAAAAAAH//2Q==',
	'base64'
)

/** A JPEG whose COM segment (FF FE) carries `text`. */
function stampedJpeg(text) {
	const t = Buffer.from(text, 'latin1')
	const len = Buffer.alloc(2)
	len.writeUInt16BE(t.length + 2)
	return Buffer.concat([BASE.subarray(0, 2), Buffer.from([0xff, 0xfe]), len, t, BASE.subarray(2)])
}

/** The stamp of a frame made here → { box, role, width, fps, seq } (null when the JPEG has none). */
function readStamp(jpeg) {
	const s = Buffer.from(jpeg).toString('latin1')
	const m = /highascg-test-frame box=(\S+) role=(\S+) width=(\d+) fps=(\d+) seq=(\d+)/.exec(s)
	return m ? { box: m[1], role: m[2], width: Number(m[3]), fps: Number(m[4]), seq: Number(m[5]) } : null
}

function createFakeFeedWorker({ label }) {
	const w = new EventEmitter()
	const timers = new Map() // key → { timer, params }
	let seq = 0
	const stopAll = () => {
		for (const t of timers.values()) clearInterval(t.timer)
		timers.clear()
	}
	w.postMessage = (m) => {
		if (m?.type === 'stop') return stopAll()
		if (m?.type !== 'set') return
		const want = new Map((m.surfaces || []).map((s) => [s.role, s]))
		for (const [k, t] of timers) {
			if (!want.has(k) || want.get(k).params.fps !== t.params.fps || want.get(k).params.width !== t.params.width) {
				clearInterval(t.timer)
				timers.delete(k)
			}
		}
		for (const [k, s] of want) {
			if (timers.has(k)) continue
			const p = s.params
			const timer = setInterval(() => {
				const jpeg = stampedJpeg(`highascg-test-frame box=${label} role=${k} width=${p.width} fps=${p.fps} seq=${++seq}`)
				w.emit('message', { role: k, seq, jpeg: jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length) })
			}, Math.round(1000 / p.fps))
			timer.unref?.()
			timers.set(k, { timer, params: p })
		}
	}
	w.terminate = () => stopAll()
	return w
}

module.exports = { createFakeFeedWorker, stampedJpeg, readStamp }
