'use strict'

const defaults = require('../config/defaults')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const phClient = require('../pixelhue/client')

/**
 * @param {string} what
 * @param {{ statusCode: number, json: any, raw: string }} u
 */
function require2xx(what, u) {
	if (u.statusCode < 200 || u.statusCode >= 300) {
		const e = new Error(`${what} failed (HTTP ${u.statusCode})`)
		/** @type {any} */ (e).code = 'PIXELHUE_HTTP'
		/** @type {any} */ (e).body = u.json != null ? u.json : u.raw
		throw e
	}
	return u.json
}

/**
 * @param {string} method
 * @param {string} p - path without query
 * @param {string} body
 * @param {Record<string, string | string[] | undefined>} query
 * @param {object} ctx
 * @returns {Promise<{ status: number, headers: object, body: string } | null>}
 */
const ALLOW = new Set([
	'GET /api/pixelhue/status',
	'GET /api/pixelhue/screens',
	'GET /api/pixelhue/presets',
	'GET /api/pixelhue/layers',
	'GET /api/pixelhue/interfaces',
	'GET /api/pixelhue/layer-presets',
	'GET /api/pixelhue/source-backup',
	'POST /api/pixelhue/take',
	'POST /api/pixelhue/cut',
	'POST /api/pixelhue/ftb',
	'POST /api/pixelhue/freeze',
	'POST /api/pixelhue/preset-apply',
	'POST /api/pixelhue/layer-select',
	'POST /api/pixelhue/layer-zorder',
	'POST /api/pixelhue/layer-window',
	'POST /api/pixelhue/layer-umd',
	'POST /api/pixelhue/layer-source',
	'POST /api/pixelhue/layer-preset-apply',
	'POST /api/pixelhue/source-backup',
	'POST /api/pixelhue/proxy',
])

/**
 * @param {string} method
 * @param {string} p
 * @returns {boolean}
 */
function isPixelhueRoute(method, p) {
	return p.startsWith('/api/pixelhue') && ALLOW.has(`${method} ${p}`)
}

/**
 * @param {unknown} v
 * @returns {v is Array<any>}
 */
function requireArrayBody(v) {
	return Array.isArray(v)
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>}
 */
function requireObjectBody(v) {
	return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * @param {any} row
 * @returns {boolean}
 */
function hasScreenIdRow(row) {
	return !!row && typeof row === 'object' && Number.isFinite(Number(row.screenId))
}

/**
 * @param {any} v
 * @returns {boolean}
 */
function hasPresetApplyShape(v) {
	if (!requireObjectBody(v)) return false
	const id = String(v.presetId || '').trim()
	return id !== '' && Number.isFinite(Number(v.targetRegion))
}

async function handle(method, p, body, query, ctx) {
	if (!p.startsWith('/api/pixelhue')) return null
	if (!isPixelhueRoute(method, p)) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
	}

	/** @type {any} */
	const _q = query || {}
	const force =
		_q.force === '1' || _q.force === 'true' || (Array.isArray(_q.force) && _q.force[0] === '1')

	/** @type {Record<string, unknown>} */
	const phCfg = { ...defaults.pixelhue, ...(ctx.config?.pixelhue && typeof ctx.config.pixelhue === 'object' ? ctx.config.pixelhue : {}) }
	const hostOk = String(phCfg.host || '').trim() !== ''
	const on = phCfg.enabled === true || phCfg.enabled === 'true' || phCfg.enabled === 1

	const bad = (msg) => ({ status: 400, headers: JSON_HEADERS, body: jsonBody({ error: msg, code: 'PIXELHUE_OFF' }) })

	if (method === 'GET' && p === '/api/pixelhue/status') {
		if (!on) {
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ enabled: false }) }
		}
		if (!hostOk) {
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ enabled: true, connected: false, error: 'host not set' }),
			}
		}
		try {
			const c = await phClient.resolveConnection(ctx, { force })
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					enabled: true,
					connected: true,
					host: String(phCfg.host).trim(),
					unicoPort: phCfg.unicoPort,
					apiPort: c.apiPort,
					sn: c.sn,
					model: c.deviceFromDiscovery && c.deviceFromDiscovery.modelId,
					protocols: c.deviceFromDiscovery && c.deviceFromDiscovery.protocols,
				}),
			}
		} catch (e) {
			const ex = e instanceof Error ? e : new Error(String(e))
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({
					enabled: true,
					connected: false,
					error: ex.message,
					code: /** @type {any} */ (ex).code,
				}),
			}
		}
	}

	if (!on) {
		return bad('PixelHue is disabled. Enable it in Settings → PixelHue.')
	}
	if (!hostOk) {
		return bad('Set PixelHue host in Settings → PixelHue.')
	}

	try {
		const c = await phClient.resolveConnection(ctx, { force })

		if (method === 'GET' && p === '/api/pixelhue/screens') {
			const u = await phClient.unicoRequest(c, phClient.PATH.screenList, 'GET')
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('screen list', u) || {}) }
		}
		if (method === 'GET' && p === '/api/pixelhue/presets') {
			const u = await phClient.unicoRequest(c, phClient.PATH.presetList, 'GET')
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('preset list', u) || {}) }
		}
		if (method === 'GET' && p === '/api/pixelhue/layers') {
			const u = await phClient.unicoRequest(c, phClient.PATH.layerList, 'GET')
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('layers', u) || {}) }
		}
		if (method === 'GET' && p === '/api/pixelhue/interfaces') {
			const u = await phClient.unicoRequest(c, phClient.PATH.ifaceList, 'GET')
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('interfaces', u) || {}) }
		}
		if (method === 'GET' && p === '/api/pixelhue/layer-presets') {
			const u = await phClient.unicoRequest(c, phClient.PATH.layerPresetList, 'GET')
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('layer presets', u) || {}) }
		}
		if (method === 'GET' && p === '/api/pixelhue/source-backup') {
			const u = await phClient.unicoRequest(c, phClient.PATH.sourceBackup, 'GET')
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('source backup', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/take') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'take body must be an array' }) }
			}
			if (j.length > 0 && !j.every(hasScreenIdRow)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'take rows must include numeric screenId' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.take, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('take', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/cut') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'cut body must be an array' }) }
			}
			if (j.length > 0 && !j.every(hasScreenIdRow)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'cut rows must include numeric screenId' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.cut, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('cut', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/ftb') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'ftb body must be an array' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.ftb, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('ftb', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/freeze') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'freeze body must be an array' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.freeze, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('freeze', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/preset-apply') {
			const j = parseBody(body) || {}
			if (!hasPresetApplyShape(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'preset-apply body must include presetId and targetRegion' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.apply, 'POST', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('preset apply', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/layer-select') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layer-select body must be an array' }) }
			}
			let u = await phClient.unicoRequest(c, phClient.PATH.layersSelect, 'PUT', j)
			// Some firmware uses /screen/select for layer selection.
			if (u.statusCode === 404 || u.statusCode === 405) {
				u = await phClient.unicoRequest(c, phClient.PATH.select, 'PUT', j)
			}
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('layer select', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/layer-zorder') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layer-zorder body must be an array' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.layersZorder, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('layer zorder', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/layer-window') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layer-window body must be an array' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.layersWindow, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('layer window', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/layer-umd') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layer-umd body must be an array' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.layersUmd, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('layer umd', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/layer-source') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layer-source body must be an array' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.layersSource, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('layer source', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/layer-preset-apply') {
			const j = parseBody(body) || {}
			if (!requireArrayBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layer-preset-apply body must be an array' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.layerPresetApply, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('layer preset apply', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/source-backup') {
			const j = parseBody(body) || {}
			if (!requireObjectBody(j)) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'source-backup body must be an object' }) }
			}
			const u = await phClient.unicoRequest(c, phClient.PATH.sourceBackup, 'PUT', j)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(require2xx('source backup', u) || {}) }
		}
		if (method === 'POST' && p === '/api/pixelhue/proxy') {
			const j = parseBody(body) || {}
			const m = String(j.method || 'GET').toUpperCase()
			const up = String(j.unicoPath || j.path || '').trim()
			if (!up.startsWith('/unico/')) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'unicoPath must start with /unico/' }) }
			}
			const b = j.body
			const u = await phClient.unicoRequest(c, up, m, b)
			return {
				status: 200,
				headers: JSON_HEADERS,
				body: jsonBody({ statusCode: u.statusCode, data: u.json != null ? u.json : u.raw }),
			}
		}
	} catch (e) {
		const ex = e instanceof Error ? e : new Error(String(e))
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: ex.message, code: /** @type {any} */ (ex).code || 'PIXELHUE_ERROR' }) }
	}

	return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'pixelhue: unhandled route' }) }
}

module.exports = { handle }
