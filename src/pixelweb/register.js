'use strict'

const { JSON_HEADERS, jsonBody } = require('../api/response')
const phClient = require('../pixelhue/client')

async function getStatus(ctx) {
	const ph = ctx?.config?.pixelhue && typeof ctx.config.pixelhue === 'object' ? ctx.config.pixelhue : {}
	const host = String(ph.host || '').trim()
	const enabled = ph.enabled === true || ph.enabled === 'true' || ph.enabled === 1
	const unicoPort = Number.parseInt(String(ph.unicoPort ?? ''), 10)
	const secure = !(ph.secure === false || ph.secure === 'false' || ph.secure === 0 || ph.secure === '0')
	if (!host) return { configured: false, connected: false, host: '' }
	if (!enabled) return { configured: true, connected: false, host, unicoPort, secure, reason: 'pixelhue_disabled' }
	try {
		await phClient.resolveConnection(ctx, { force: false })
		return { configured: true, connected: true, host, unicoPort, secure }
	} catch (e) {
		return { configured: true, connected: false, host, unicoPort, secure, reason: e?.message || String(e) }
	}
}

async function saveConfig(ctx, body) {
	const j = body && typeof body === 'string' ? JSON.parse(body || '{}') : body || {}
	const host = String(j.host || '').trim()
	if (!host) throw new Error('host is required')
	const parsedUnicoPort = Number.parseInt(String(j.unicoPort ?? ''), 10)
	const unicoPort = Number.isFinite(parsedUnicoPort) && parsedUnicoPort >= 1 && parsedUnicoPort <= 65535 ? parsedUnicoPort : 19998
	const secure = !(j.secure === false || j.secure === 'false' || j.secure === 0 || j.secure === '0')
	const cur = ctx.configManager ? ctx.configManager.get() : (ctx.config || {})
	const next = {
		...cur,
		pixelhue: {
			...(cur.pixelhue || {}),
			enabled: true,
			host,
			unicoPort,
			secure,
		},
	}
	if (ctx.configManager) ctx.configManager.save(next)
	if (ctx.config) ctx.config.pixelhue = next.pixelhue
	return { ok: true, host, unicoPort, secure }
}

module.exports = {
	name: 'pixelweb',
	apiPathPrefixes: ['/api/pixelweb'],
	async handleApi({ method, path, body, ctx }) {
		if (method === 'GET' && path === '/api/pixelweb/status') {
			const status = await getStatus(ctx)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody(status) }
		}
		if (method === 'POST' && path === '/api/pixelweb/config') {
			try {
				const out = await saveConfig(ctx, body)
				return { status: 200, headers: JSON_HEADERS, body: jsonBody(out) }
			} catch (e) {
				return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: e?.message || String(e) }) }
			}
		}
		return null
	},
}

