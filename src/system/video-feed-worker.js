'use strict'

/**
 * WO-670 P1 — worker thread for the video feed: owns one JPEG encoder (video-feed-encoder.js) per wanted surface.
 * Main → worker: { type: 'set', surfaces: [{ role, path, params }] } (the full wanted set; others close).
 * Worker → main: { role, seq, jpeg: ArrayBuffer } (transferred).
 */

const { parentPort } = require('worker_threads')
const { createEncoder } = require('./video-feed-encoder')

const encoders = new Map()

function log(level, msg) {
	parentPort.postMessage({ log: level, msg })
}

parentPort.on('message', (m) => {
	if (m && m.type === 'stop') {
		for (const enc of encoders.values()) enc.close()
		encoders.clear()
		return process.exit(0)
	}
	if (!m || m.type !== 'set') return
	const wanted = new Map((Array.isArray(m.surfaces) ? m.surfaces : []).map((s) => [s.role, s]))
	for (const [role, enc] of encoders) {
		if (!wanted.has(role)) {
			enc.close()
			encoders.delete(role)
		}
	}
	for (const [role, s] of wanted) {
		if (encoders.has(role)) {
			encoders.get(role).retune(s.params)
			continue
		}
		encoders.set(
			role,
			createEncoder({
				role,
				path: s.path,
				params: s.params,
				log,
				onFrame: ({ jpeg, seq }) => {
					const ab = jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length)
					parentPort.postMessage({ role, seq, jpeg: ab }, [ab])
				},
			})
		)
	}
})
