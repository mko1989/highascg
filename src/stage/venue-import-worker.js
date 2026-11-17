'use strict'

/**
 * WO-1098 — the venue conversion off the server's event loop (a SketchUp hall is ~1.8 M triangles: seconds of CPU and
 * ~0.5 GB while it runs). workerData = { dir (staged upload), opts (convertVenue options) }; posts
 * { type: 'progress', phase, done, total, text } … then { type: 'done', glb, report } or { type: 'error', error }.
 *
 * WO-1106 B20 — cancel: the parent posts { type: 'cancel' }; the worker kills its ffmpeg children (scene-tex.js stopAll:
 * a bare terminate() orphaned them and their kill timers), replies { type: 'cancelled', killed } and exits. The parent
 * still terminates it after a grace period (a worker busy in a synchronous phase answers only at its next await).
 * WO-1106 B5 — RESOURCE_LIMITS: the Worker's resourceLimits (the parent passes them): a generous heap — the real Hilton
 * hall (77 MB OBJ, WO-1098) peaks far below it — so a hostile upload ends this thread, not node.
 */

const { parentPort, workerData, isMainThread } = require('worker_threads')

const RESOURCE_LIMITS = { maxOldGenerationSizeMb: 3072 }

async function main() {
	const { gather } = require('./venue-sources')
	const { convertVenue } = require('./venue-convert')
	const src = await gather(workerData.dir)
	let last = 0
	const { glb, report } = await convertVenue(src, workerData.opts || {}, (p) => {
		const now = Date.now()
		if (now - last < 150 && p.phase === 'reading') return // ~7 updates a second is plenty
		last = now
		parentPort.postMessage({ type: 'progress', ...p })
	})
	const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length)
	parentPort.postMessage({ type: 'done', glb: ab, report }, [ab])
}

if (!isMainThread && parentPort) {
	parentPort.on('message', (m) => {
		if (m?.type !== 'cancel') return
		const killed = require('./scene-tex').stopAll()
		parentPort.postMessage({ type: 'cancelled', killed })
		process.exit(0)
	})
	parentPort.unref() // the cancel listener must not keep a finished worker alive
	main().catch((e) => parentPort.postMessage({ type: 'error', error: String(e?.message || e) }))
}

module.exports = { RESOURCE_LIMITS }
