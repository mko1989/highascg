/**
 * Person-tracking module registration (WO-19 / WO-30).
 *
 * Loaded by `src/module-registry.tryLoad('tracking')` when the module is enabled. The real
 * pipeline (FFmpeg consumer → raw RGB frames → Node worker running YOLOv8n-Pose + ByteTrack
 * → `tracking:persons` WS broadcast) lives under `src/tracking/` once implemented.
 *
 * Current status: skeleton. Exposes the directory boundaries, WS namespace, and a stub
 * `GET /api/tracking/stats` so the end-to-end plumbing is verifiable without any real
 * inference in place yet. Real task work lives in WO-19 Phases 1-5.
 */

'use strict'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

/**
 * @param {{ method: string, path: string, body: string, ctx: any, query: any, req: any }} reqInfo
 */
async function handleApi({ method, path }) {
	if (method === 'GET' && path === '/api/tracking/stats') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: JSON.stringify({
				module: 'tracking',
				status: 'skeleton',
				persons: 0,
				fps: 0,
				frameSource: 'none',
				see: 'work/19_WO_PERSON_TRACKING.md',
			}),
		}
	}

	// TODO WO-19 — /api/tracking/calibration (homography, zone definitions)
	// TODO WO-19 — /api/tracking/engine/start | /stop (FFmpeg consumer lifecycle)
	return null
}

module.exports = {
	name: 'tracking',

	apiPathPrefixes: ['/api/tracking'],
	handleApi,

	wsNamespaces: ['tracking:'],

	webBundles: ['/assets/modules/tracking/entry.js'],

	onBoot(ctx) {
		if (ctx && typeof ctx.log === 'function') {
			ctx.log('info', '[tracking] module skeleton booted — see WO-19 for implementation tasks')
		}
	},

	async onShutdown() {
		// TODO WO-19 — terminate worker thread, close FFmpeg consumer, release ONNX session
	},
}
