/**
 * Previs module registration (WO-17 / WO-30).
 *
 * Loaded by `src/module-registry.tryLoad('previs')` when the module is enabled. All previs
 * state, workers, and REST routes live under `src/previs/`; the core codebase never imports
 * from here directly — only this descriptor is seen through the registry.
 *
 * Current status: skeleton. It exposes the directory boundaries, the registration shape, and
 * a stub `GET /api/previs/health` so end-to-end plumbing (flag → module → API → web loader)
 * is verifiable without any real 3D code in place yet. Real task work lives in WO-17 Phases
 * 1-5.
 */

'use strict'

const routesModels = require('./routes-models')

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' }

/**
 * @param {{ method: string, path: string, body: string, ctx: any, query: any, req: any }} reqInfo
 */
async function handleApi(reqInfo) {
	const { method, path } = reqInfo
	if (method === 'GET' && path === '/api/previs/health') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: JSON.stringify({
				module: 'previs',
				status: 'phase-2',
				models: routesModels.listRecords().length,
				see: 'work/17_WO_3D_PREVIS.md',
			}),
		}
	}

	const modelResp = await routesModels.handle(reqInfo)
	if (modelResp) return modelResp

	// TODO WO-17 — /api/previs/screens (CRUD of ScreenRegion)
	// TODO WO-17 — /api/previs/virtual-canvas (GET/PUT of VirtualCanvas)
	return null
}

module.exports = {
	name: 'previs',

	apiPathPrefixes: ['/api/previs'],
	handleApi,

	wsNamespaces: ['previs:'],

	/**
	 * Served by the HTTP server out of `web/assets/modules/previs/`. Only fetched when the
	 * `/api/modules` response lists `previs`, so the base client never downloads them.
	 */
	webBundles: ['/assets/modules/previs/entry.js'],
	webStyles: [
		'/styles/previs-hud.css',
		'/styles/previs-inspector.css',
		'/styles/previs-settings.css'
	],

	onBoot(ctx) {
		if (ctx && typeof ctx.log === 'function') {
			ctx.log('info', '[previs] module skeleton booted — see WO-17 for implementation tasks')
		}
	},

	async onShutdown() {
		// TODO WO-17 — stop any workers, dispose GLTF caches, close file handles
	},
}
