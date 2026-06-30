'use strict'

const net = require('net')
const { resolveCompanionConfig } = require('../companion/companion-config')
const { getSatellitePreviewClient } = require('../companion/satellite-preview-client')

/**
 * @param {Record<string, string | undefined>} [query]
 * @param {object} [baseConfig]
 */
function companionConfigFromQuery(query, baseConfig) {
	const base = resolveCompanionConfig(baseConfig)
	const q = query || {}
	const host = String(q.host ?? base.host).trim() || base.host
	const port = parseInt(String(q.port ?? base.port), 10) || base.port
	const satelliteHostRaw = String(q.satelliteHost ?? base.satelliteHost ?? '').trim()
	const satelliteHost = satelliteHostRaw || host
	const satellitePort = parseInt(String(q.satellitePort ?? base.satellitePort), 10) || base.satellitePort
	let satelliteEnabled = base.satelliteEnabled
	if (q.satelliteEnabled === '0' || q.satelliteEnabled === 'false') satelliteEnabled = false
	else if (q.satelliteEnabled === '1' || q.satelliteEnabled === 'true') satelliteEnabled = true
	return { host, port, satelliteHost, satellitePort, satelliteEnabled }
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 */
async function probeCompanionHttp(host, port, timeoutMs = 2500) {
	const url = `http://${host}:${port}/`
	try {
		const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
		return { connected: true, status: r.status, url }
	} catch (e) {
		return { connected: false, error: e?.message || String(e), url }
	}
}

/**
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 */
function probeCompanionTcp(host, port, timeoutMs = 2500) {
	return new Promise((resolve) => {
		const socket = net.connect({ host, port })
		const done = (result) => {
			clearTimeout(timer)
			try {
				socket.destroy()
			} catch {}
			resolve(result)
		}
		const timer = setTimeout(() => done({ connected: false, error: 'timeout' }), timeoutMs)
		socket.once('connect', () => done({ connected: true }))
		socket.once('error', (err) => done({ connected: false, error: err?.message || String(err) }))
	})
}

/**
 * @param {object} ctx
 * @param {Record<string, string | undefined>} [query]
 */
async function buildCompanionConnectionStatus(ctx, query) {
	const cfg = companionConfigFromQuery(query, ctx.config)
	const saved = resolveCompanionConfig(ctx.config)
	const usingSaved =
		cfg.host === saved.host &&
		cfg.port === saved.port &&
		cfg.satelliteHost === saved.satelliteHost &&
		cfg.satellitePort === saved.satellitePort &&
		cfg.satelliteEnabled === saved.satelliteEnabled

	const [http, satelliteTcp] = await Promise.all([
		probeCompanionHttp(cfg.host, cfg.port),
		cfg.satelliteEnabled
			? probeCompanionTcp(cfg.satelliteHost, cfg.satellitePort)
			: Promise.resolve({ connected: false, skipped: true }),
	])

	let satelliteSubscriptions = null
	let satelliteReason = null
	let satelliteHint = null
	if (usingSaved && cfg.satelliteEnabled) {
		const client = getSatellitePreviewClient()
		client.configure(ctx.config)
		const st = client.getStatus()
		satelliteSubscriptions = !!st.subscriptionsSupported
		satelliteReason = st.reason
		satelliteHint = st.hint
	}

	const httpConnected = !!http.connected
	const satelliteConnected = cfg.satelliteEnabled ? !!satelliteTcp.connected : null

	return {
		ok: true,
		connected: httpConnected,
		http: {
			connected: httpConnected,
			host: cfg.host,
			port: cfg.port,
			status: http.status ?? null,
			error: http.error ?? null,
		},
		satellite: cfg.satelliteEnabled
			? {
					enabled: true,
					connected: satelliteConnected,
					subscriptionsSupported: satelliteSubscriptions,
					host: cfg.satelliteHost,
					port: cfg.satellitePort,
					error: satelliteTcp.error ?? null,
					reason: satelliteReason,
					hint: satelliteHint,
				}
			: { enabled: false },
	}
}

module.exports = {
	buildCompanionConnectionStatus,
	companionConfigFromQuery,
	probeCompanionHttp,
	probeCompanionTcp,
}
