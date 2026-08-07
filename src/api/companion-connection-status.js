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
 * Connect AND read the Satellite handshake: Companion answers
 * `BEGIN CompanionVersion=…` then `CAPS SUBSCRIPTIONS=0|1 …`. Reporting the CAPS bit from a
 * live probe is what makes the settings status truthful — the passive preview client is
 * disconnected whenever no picker is open, so its `subscriptionsSupported=false` said
 * "Button Subscriptions API is not enabled" even when it was (todos06.08 false-flag report).
 * @param {string} host
 * @param {number} port
 * @param {number} [timeoutMs]
 */
function probeCompanionTcp(host, port, timeoutMs = 2500) {
	return new Promise((resolve) => {
		const socket = net.connect({ host, port })
		socket.setEncoding('utf8')
		let buf = ''
		let connected = false
		let companionVersion = null
		/** @type {boolean | null} */
		let subscriptionsSupported = null
		const done = (result) => {
			clearTimeout(timer)
			clearTimeout(capsTimer)
			try {
				socket.destroy()
			} catch {}
			resolve(result)
		}
		const finishConnected = () => done({ connected: true, subscriptionsSupported, companionVersion })
		const timer = setTimeout(() => {
			if (connected) finishConnected()
			else done({ connected: false, subscriptionsSupported: null, error: 'timeout' })
		}, timeoutMs)
		/* Give the handshake a short window after connect; a bare TCP open already means "up". */
		let capsTimer = null
		socket.once('connect', () => {
			connected = true
			capsTimer = setTimeout(finishConnected, 1200)
		})
		socket.on('data', (chunk) => {
			buf += chunk
			const mVer = buf.match(/\bCompanionVersion="([^"]*)"/)
			if (mVer) companionVersion = mVer[1]
			const mCaps = buf.match(/^CAPS\b[^\n]*\bSUBSCRIPTIONS=("?)(0|1|true|false)\1/m)
			if (mCaps) {
				subscriptionsSupported = mCaps[2] === '1' || mCaps[2] === 'true'
				finishConnected()
			}
		})
		socket.once('error', (err) =>
			done({ connected: false, subscriptionsSupported: null, error: err?.message || String(err) }),
		)
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

	/* Live probe first; passive client only as a fallback when the probe saw no CAPS line. */
	let satelliteSubscriptions = satelliteTcp.subscriptionsSupported ?? null
	let satelliteReason = null
	let satelliteHint = null
	if (cfg.satelliteEnabled && satelliteSubscriptions === false) {
		satelliteReason = 'subscriptions_disabled'
		satelliteHint =
			'In Companion Settings, enable **Button Subscriptions API** (Satellite server alone is not enough). HighAsCG uses ADD-SUB for button previews — same API as the Elgato app.'
	} else if (usingSaved && cfg.satelliteEnabled && satelliteSubscriptions === null) {
		const client = getSatellitePreviewClient()
		client.configure(ctx.config)
		const st = client.getStatus()
		if (st.satelliteConnected) satelliteSubscriptions = !!st.subscriptionsSupported
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
