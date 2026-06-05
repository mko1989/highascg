/**
 * REST endpoints for CasparCG OSC aggregate state (UDP listener → {@link OscState}).
 */

'use strict'

const { JSON_HEADERS, jsonBody } = require('./response')

/** @param {Record<string, unknown>} chans */
function _channelData(chans, id) {
	const n = String(id)
	return chans[n] || chans[id] || null
}

/**
 * @param {string} p - path without query
 * @param {object} ctx
 * @returns {{ status: number, headers: Record<string, string>, body: string } | null}
 */
function handleGet(p, ctx) {
	if (!p.startsWith('/api/osc')) return null
	// Match `/api/osc/...` even if a client or proxy adds a trailing slash.
	if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1)

	if (p === '/api/osc/diagnostics') {
		const cfg = ctx.config?.osc || {}
		const stats = typeof ctx.getOscReceiverStats === 'function' ? ctx.getOscReceiverStats() : null
		const snap = ctx.oscState && typeof ctx.oscState.getSnapshot === 'function' ? ctx.oscState.getSnapshot() : null
		const chKeys = snap?.channels ? Object.keys(snap.channels) : []
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				listenerEnabled: cfg.enabled !== false,
				listenPort: cfg.listenPort != null ? Number(cfg.listenPort) : 6251,
				listenAddress: cfg.listenAddress || '0.0.0.0',
				udpPacketsReceived: stats?.received ?? 0,
				lastUdpAt: stats?.lastAt ?? null,
				recentOscAddresses: stats?.sampleAddresses || [],
				channelsInState: chKeys,
				hint:
					'If udpPacketsReceived stays 0, Caspar is not reaching this UDP port. On the same machine, Caspar <default-port> and HighAsCG listen port must differ; <predefined-client><port> must equal HighAsCG listenPort.',
			}),
		}
	}

	if (!ctx.oscState || typeof ctx.oscState.getSnapshot !== 'function') {
		if (p === '/api/osc/config-hint') {
			return {
				status: 200,
				headers: { 'Content-Type': 'application/xml; charset=utf-8' },
				body: buildConfigHintXml(ctx),
			}
		}
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ enabled: false, message: 'OSC listener disabled' }),
		}
	}

	const snap = ctx.oscState.getSnapshot()
	const chans = snap.channels || {}

	if (p === '/api/osc/state') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(snap) }
	}

	const audioM = p.match(/^\/api\/osc\/audio\/(\d+)$/)
	if (audioM) {
		const ch = parseInt(audioM[1], 10)
		const data = _channelData(chans, ch)
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ channel: ch, audio: data ? data.audio : { nbChannels: 0, levels: [] } }),
		}
	}

	const layerM = p.match(/^\/api\/osc\/layer\/(\d+)\/(\d+)$/)
	if (layerM) {
		const ch = parseInt(layerM[1], 10)
		const layer = parseInt(layerM[2], 10)
		const data = _channelData(chans, ch)
		const layerState = data?.layers?.[layer] ?? data?.layers?.[String(layer)] ?? null
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({ channel: ch, layer, layerState }),
		}
	}

	if (p === '/api/osc/profiler') {
		const byChannel = {}
		for (const k of Object.keys(chans)) {
			const c = chans[k]
			if (c?.profiler) byChannel[k] = c.profiler
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ channels: byChannel }) }
	}

	if (p === '/api/osc/outputs') {
		const byChannel = {}
		for (const k of Object.keys(chans)) {
			const c = chans[k]
			if (c?.outputs) byChannel[k] = c.outputs
		}
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ channels: byChannel }) }
	}

	if (p === '/api/osc/config-hint') {
		return {
			status: 200,
			headers: { 'Content-Type': 'application/xml; charset=utf-8' },
			body: buildConfigHintXml(ctx),
		}
	}

	return null
}

/**
 * Caspar <default-port> (Caspar bind) must differ from <predefined-client> port (HighAsCG bind) on one host.
 */
function casparDefaultPortForHint(listenPort) {
	const t = Number(listenPort) || 6251
	/** Caspar’s own OSC server (`<default-port>`); HighAsCG listens on `listenPort` (default 6251). */
	let d = 6250
	if (d === t) d = t + 1
	if (d > 65535) d = Math.max(1024, t - 1)
	return d
}

/**
 * CasparCG `casparcg.config` snippet: predefined OSC client → this app.
 * @param {object} ctx
 */
function buildConfigHintXml(ctx) {
	const cfg = ctx.config || {}
	const osc = cfg.osc || {}
	const targetPort = osc.listenPort != null ? Number(osc.listenPort) : 6251
	const defaultPort = casparDefaultPortForHint(targetPort)
	let addr = String(osc.listenAddress || '127.0.0.1')
	if (addr === '0.0.0.0') addr = '127.0.0.1'
	return (
		`<?xml version="1.0" encoding="utf-8"?>\n` +
		`<!-- HighAsCG listens on UDP predefined-client port. Caspar uses default-port for its own OSC server — must not equal the same port on one machine. -->\n` +
		`<osc>\n` +
		`  <default-port>${defaultPort}</default-port>\n` +
		`  <disable-send-to-amcp-clients>false</disable-send-to-amcp-clients>\n` +
		`  <predefined-clients>\n` +
		`    <predefined-client>\n` +
		`      <address>${escapeXml(addr)}</address>\n` +
		`      <port>${targetPort}</port>\n` +
		`    </predefined-client>\n` +
		`  </predefined-clients>\n` +
		`</osc>\n`
	)
}

function escapeXml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
}

module.exports = { handleGet, buildConfigHintXml }
