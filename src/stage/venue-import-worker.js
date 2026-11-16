'use strict'

/**
 * WO-1098 — the venue conversion off the server's event loop (a SketchUp hall is ~1.8 M triangles: seconds of CPU and
 * ~0.5 GB while it runs). workerData = { dir (staged upload), opts (convertVenue options) }; posts
 * { type: 'progress', phase, done, total, text } … then { type: 'done', glb, report } or { type: 'error', error }.
 * Cancel = the parent terminates the worker.
 */

const { parentPort, workerData } = require('worker_threads')
const { gather } = require('./venue-sources')
const { convertVenue } = require('./venue-convert')

async function main() {
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

main().catch((e) => parentPort.postMessage({ type: 'error', error: String(e?.message || e) }))
