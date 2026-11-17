/**
 * GET /api/modules — report which optional feature modules are enabled on this server.
 * Used by the web client to decide which dynamic bundles to import (see
 * `web/lib/optional-modules.js`). Matches WO-30 T30.3.
 *
 * WO-1076 — external (installable, opt-in) modules, docs/MODULES.md:
 *   GET  /api/modules            + `available`: every installed module (name, title, version, source, enabled, …)
 *   POST /api/modules/enable     { name }  load + boot now, remember enabled (~/.highascg/modules.json)
 *   POST /api/modules/disable    { name }  onShutdown + unregister now, remember disabled
 *   POST /api/modules/install    { path | url, sha256?, name?, enable? }  unpack into ~/.highascg/modules/<name>/
 *   POST /api/modules/uninstall  { name }  disable, then remove the installed copy (never the repo modules/)
 * Normal API auth on all of them (no public path). WO-1106 B1: the four POSTs change installed code, so they also need
 * the password (auth enforced) or a request from the box itself (module-host/code-change-gate.js) — 403 otherwise.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBodyStrict } = require('./response')
const moduleRegistry = require('../module-registry')

/**
 * @param {string} method
 * @param {string} p
 */
function handle(method, p) {
	if (method !== 'GET' || p !== '/api/modules') return null
	const info = moduleRegistry.describe()
	let available = []
	try {
		available = require('../module-host/module-loader').listAvailable()
	} catch {}
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			enabled: info.modules,
			bundles: info.bundles,
			styles: info.styles,
			wsNamespaces: info.wsNamespaces,
			available,
		}),
	}
}

const reply = (r) => {
	const { status, ...rest } = r
	return { status: status || (r.ok ? 200 : 400), headers: JSON_HEADERS, body: jsonBody(rest) }
}

/**
 * @param {'enable'|'disable'|'install'|'uninstall'} action
 * @param {string} body raw JSON body
 * @param {any} ctx
 * @param {object} [deps] smokes only (install: fetch / limits)
 * @param {import('http').IncomingMessage} [req] who asks (WO-1106 B1: no req = refused)
 */
async function handlePost(action, body, ctx, deps, req) {
	const gate = require('../module-host/code-change-gate').mayChangeInstalledCode(req, ctx)
	if (!gate.ok) return reply(gate)
	const b = parseBodyStrict(body)
	if (!b.ok || !b.value || typeof b.value !== 'object' || Array.isArray(b.value)) return reply({ ok: false, status: 400, error: 'JSON object body expected' })
	const v = b.value
	const loader = require('../module-host/module-loader')
	const install = require('../module-host/module-install')
	let r
	if (action === 'enable') r = await loader.enableModule(String(v.name || ''), ctx)
	else if (action === 'disable') r = await loader.disableModule(String(v.name || ''), ctx)
	else if (action === 'uninstall') r = await install.uninstallModule(String(v.name || ''), ctx)
	else {
		const opts = {
			path: typeof v.path === 'string' ? v.path : undefined,
			url: typeof v.url === 'string' ? v.url : undefined,
			sha256: typeof v.sha256 === 'string' ? v.sha256 : undefined,
			name: typeof v.name === 'string' ? v.name : undefined,
			enable: v.enable === false ? false : undefined,
		}
		r = await install.installModule(opts, ctx, deps)
	}
	return reply({ ...r, available: loader.listAvailable() })
}

/** @param {import('./route-registry').RouteRegistry} routes */
function registerPostRoutes(routes) {
	const o = { requireCaspar: false }
	routes.post('/api/modules/enable', ({ body, ctx, req }) => handlePost('enable', body, ctx, undefined, req), o)
	routes.post('/api/modules/disable', ({ body, ctx, req }) => handlePost('disable', body, ctx, undefined, req), o)
	routes.post('/api/modules/install', ({ body, ctx, req }) => handlePost('install', body, ctx, undefined, req), o)
	routes.post('/api/modules/uninstall', ({ body, ctx, req }) => handlePost('uninstall', body, ctx, undefined, req), o)
}

module.exports = { handle, handlePost, registerPostRoutes }
