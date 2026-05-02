'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { buildChannelMap } = require('../config/channel-map-from-ctx')
const { normalizeTandemTopology } = require('../config/tandem-topology')
const phClient = require('../pixelhue/client')

/**
 * @param {object} ctx
 */
function casparSnapshot(ctx) {
	const conn = ctx._casparStatus
	const connected = conn && typeof conn.connected === 'boolean' ? conn.connected : !!(ctx.amcp && ctx.amcp.connected)
	return {
		connected,
		host: ctx.config?.caspar?.host,
		port: ctx.config?.caspar?.port,
		channelMap: buildChannelMap(ctx),
	}
}

/**
 * @param {object} ctx
 */
async function handleGet(ctx) {
	const topology = normalizeTandemTopology(ctx.config?.tandemTopology)
	/** @type {any} */
	const out = {
		topology,
		caspar: casparSnapshot(ctx),
		pixelhue: { available: false },
	}
	try {
		const c = await phClient.resolveConnection(ctx, { force: false })
		const [screens, layers, ifaces] = await Promise.all([
			phClient.unicoRequest(c, phClient.PATH.screenList, 'GET'),
			phClient.unicoRequest(c, phClient.PATH.layerList, 'GET'),
			phClient.unicoRequest(c, phClient.PATH.ifaceList, 'GET'),
		])
		out.pixelhue = {
			available: true,
			apiPort: c.apiPort,
			sn: c.sn,
			screens: screens.json,
			layers: layers.json,
			interfaces: ifaces.json,
		}
	} catch (e) {
		const ex = e instanceof Error ? e : new Error(String(e))
		const code = /** @type {any} */ (ex).code
		out.pixelhue = {
			available: false,
			error: ex.message,
			...(code ? { code } : {}),
		}
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody(out) }
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(body, ctx) {
	const j = parseBody(body) || {}
	if (!j.tandemTopology || typeof j.tandemTopology !== 'object') {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'Expected { tandemTopology }' }) }
	}
	const next = normalizeTandemTopology(j.tandemTopology)
	ctx.config.tandemTopology = next
	if (ctx.configManager) {
		const cur = ctx.configManager.get()
		ctx.configManager.save({ ...cur, tandemTopology: next })
	}
	return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, topology: next }) }
}

/**
 * Bind a PixelHue layer to a configured switcher input (Caspar feed or other) using `layers/source`.
 * One PH layer = one physical input (full Caspar PGM), not one layer per stacked clip in Caspar.
 *
 * Body: `{ layerId: number, signalPathId?: string, mainIndex?: number, bus?: 'pgm'|'prv' }`
 *
 * @param {string} body
 * @param {object} ctx
 */
async function handleBindInput(body, ctx) {
	const j = parseBody(body) || {}
	const layerId = parseInt(String(j.layerId), 10)
	const signalPathId = j.signalPathId != null ? String(j.signalPathId).trim() : ''
	const mainIndex = Math.min(3, Math.max(0, parseInt(String(j.mainIndex ?? 0), 10) || 0))
	const bus = j.bus === 'prv' ? 'prv' : 'pgm'
	if (!Number.isFinite(layerId) || layerId < 1) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'layerId must be a positive integer' }) }
	}
	const top = normalizeTandemTopology(ctx.config?.tandemTopology)
	/** @type {any} */
	let path = null
	if (signalPathId) {
		path = top.signalPaths.find((s) => s && s.id === signalPathId) || null
	}
	if (!path) {
		path =
			top.signalPaths.find((s) => s && s.caspar && s.caspar.mainIndex === mainIndex && s.caspar.bus === bus) || null
	}
	if (!path || path.phInterfaceId == null) {
		return {
			status: 400,
			headers: JSON_HEADERS,
			body: jsonBody({
				error: 'No matching signal path with phInterfaceId. Configure Tandem → signal paths in Settings.',
			}),
		}
	}
	const c = await phClient.resolveConnection(ctx, { force: false })
	const ifRes = await phClient.unicoRequest(c, phClient.PATH.ifaceList, 'GET')
	if (ifRes.statusCode < 200 || ifRes.statusCode >= 300 || !ifRes.json) {
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: 'PixelHue interface list failed' }) }
	}
	const list = ifRes.json?.data?.list || []
	const iface = list.find((x) => x && Number(x.interfaceId) === Number(path.phInterfaceId))
	if (!iface) {
		return {
			status: 404,
			headers: JSON_HEADERS,
			body: jsonBody({ error: `No interface ${path.phInterfaceId} on device` }),
		}
	}
	const st = iface.auxiliaryInfo?.connectorInfo?.interfaceType
	const ct = iface.auxiliaryInfo?.connectorInfo?.type
	const payload = [
		{
			layerId,
			source: {
				general: {
					sourceId: iface.interfaceId,
					sourceType: st,
					connectorType: ct,
				},
			},
		},
	]
	const put = await phClient.unicoRequest(c, phClient.PATH.layersSource, 'PUT', payload)
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({
			ok: put.statusCode >= 200 && put.statusCode < 300,
			statusCode: put.statusCode,
			data: put.json != null ? put.json : put.raw,
			layerId,
			signalPathId: path.id,
		}),
	}
}

/**
 * @param {string} method
 * @param {string} p
 * @param {string} body
 * @param {object} ctx
 */
async function handle(method, p, body, ctx) {
	if (p === '/api/tandem-device' && method === 'GET') {
		return handleGet(ctx)
	}
	if (p === '/api/tandem-device' && method === 'POST') {
		return handlePost(body, ctx)
	}
	if (p === '/api/tandem-device/bind-input' && method === 'POST') {
		try {
			return await handleBindInput(body, ctx)
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}
	return null
}

module.exports = { handle, normalizeTandemTopology, casparSnapshot }
