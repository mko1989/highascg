/**
 * Stage auto-follow module registration (WO-31 / WO-30).
 *
 * Loaded by `src/module-registry.tryLoad('autofollow')` when the module is enabled. Consumes
 * `tracking:persons` WS broadcasts, translates them into per-device normalised pan/tilt/zoom
 * commands in the stage coord frame, and re-broadcasts on `autofollow:*` for the Companion
 * module to fan out to physical PTZ cameras and moving-head lights.
 *
 * Current status: skeleton. Exposes the directory boundaries, WS namespace, and a stub
 * `GET /api/autofollow/devices` so the plumbing is verifiable. Real task work lives in
 * WO-31 Phases 1-5.
 */

'use strict'

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

/**
 * @param {{ method: string, path: string, body: string, ctx: any, query: any, req: any }} reqInfo
 */
async function handleApi({ method, path }) {
	if (method === 'GET' && path === '/api/autofollow/devices') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: JSON.stringify({
				module: 'autofollow',
				status: 'skeleton',
				devices: [],
				see: 'work/31_WO_STAGE_AUTOFOLLOW_PTZ.md',
			}),
		}
	}

	// TODO WO-31 — /api/autofollow/devices (CRUD)
	// TODO WO-31 — /api/autofollow/calibrate (per-device aim calibration wizard)
	// TODO WO-31 — /api/autofollow/arm | /disarm | /panic
	return null
}

module.exports = {
	name: 'autofollow',

	apiPathPrefixes: ['/api/autofollow'],
	handleApi,

	wsNamespaces: ['autofollow:'],

	webBundles: ['/assets/modules/autofollow/entry.js'],

	onBoot(ctx) {
		if (ctx && typeof ctx.log === 'function') {
			ctx.log('info', '[autofollow] module skeleton booted — see WO-31 for implementation tasks')
		}
	},

	async onShutdown() {
		// TODO WO-31 — stop any follow timers, emit final "all home" broadcast
	},
}
