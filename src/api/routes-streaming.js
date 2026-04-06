'use strict'

const http = require('http')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { go2rtcManager } = require('../streaming/go2rtc-manager')
const { listNdiSources } = require('../streaming/ndi-resolve')

/** Max chars logged for go2rtc error bodies (avoid huge SDP dumps on weird failures). */
const GO2RTC_ERROR_BODY_LOG_MAX = 4096

/**
 * @param {Buffer} raw
 * @returns {string}
 */
function formatGo2rtcErrorBodyForLog(raw) {
	if (!raw || raw.length === 0) return '(empty)'
	let s = raw.toString('utf8')
	if (s.length > GO2RTC_ERROR_BODY_LOG_MAX) {
		s = s.slice(0, GO2RTC_ERROR_BODY_LOG_MAX) + '…'
	}
	return s.replace(/\r\n/g, '\n').replace(/\n/g, ' | ')
}

/**
 * Proxy WHEP-style POST /api/webrtc to local go2rtc so the browser stays same-origin (port 8080).
 * Direct fetch to :1984 from :8080 is blocked by CORS (go2rtc does not send Access-Control-Allow-Origin).
 * @param {Record<string, string>} query
 * @param {string} body raw SDP
 * @param {{ config?: { streaming?: { go2rtcPort?: number } } }} ctx
 */
async function proxyGo2rtcWebrtc(query, body, ctx) {
	const src = query.src
	if (!src) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: 'missing src query parameter' }) }
	}
	const port = ctx?.config?.streaming?.go2rtcPort ?? 1984
	const pathQ = `/api/webrtc?src=${encodeURIComponent(src)}`
	const buf = Buffer.from(typeof body === 'string' ? body : '', 'utf8')
	const t0 = Date.now()
	ctx?.log?.(
		'info',
		`[Streaming] WebRTC proxy → go2rtc 127.0.0.1:${port} src=${src} sdpBytes=${buf.length}`
	)
	return await new Promise((resolve) => {
		const req = http.request(
			{
				hostname: '127.0.0.1',
				port,
				path: pathQ,
				method: 'POST',
				headers: {
					'Content-Type': 'application/sdp',
					'Content-Length': buf.length,
				},
				timeout: 60000,
			},
			(res) => {
				const chunks = []
				res.on('data', (c) => chunks.push(c))
				res.on('end', () => {
					const raw = Buffer.concat(chunks)
					const ct = res.headers['content-type'] || 'application/sdp'
					const ms = Date.now() - t0
					const st = res.statusCode || 502
					ctx?.log?.(
						'info',
						`[Streaming] WebRTC proxy ← go2rtc status=${st} ${ms}ms bodyBytes=${raw.length} content-type=${ct} src=${src}`
					)
					if (st >= 400) {
						ctx?.log?.(
							'warn',
							`[Streaming] WebRTC proxy go2rtc HTTP ${st} body (${raw.length} bytes): ${formatGo2rtcErrorBodyForLog(raw)}`
						)
					}
					resolve({
						status: st,
						headers: { 'Content-Type': ct },
						body: raw,
					})
				})
			}
		)
		req.on('error', (e) => {
			ctx?.log?.('warn', `[Streaming] WebRTC proxy error: ${e.message} src=${src}`)
			resolve({
				status: 502,
				headers: JSON_HEADERS,
				body: jsonBody({ error: `go2rtc proxy: ${e.message}` }),
			})
		})
		req.on('timeout', () => {
			req.destroy()
			ctx?.log?.('warn', `[Streaming] WebRTC proxy timeout (60s) src=${src}`)
			resolve({
				status: 504,
				headers: JSON_HEADERS,
				body: jsonBody({ error: 'go2rtc proxy timeout' }),
			})
		})
		req.write(buf)
		req.end()
	})
}

async function handleGet(path, ctx) {
	if (path === '/api/streaming/ndi-sources') {
		const r = listNdiSources()
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				ok: r.ok,
				sources: r.sources,
				error: r.error,
			}),
		}
	}
	if (path === '/api/streams') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				streams: go2rtcManager.availableStreams,
				isRunning: !!go2rtcManager.process,
				config: go2rtcManager.config || {}
			})
		}
	}
	return null
}

async function handlePost(path, body, ctx) {
	const b = parseBody(body)

	if (path === '/api/streaming/toggle') {
		// ctx should have a method to handle the async cascade of starting caspar/go2rtc
		if (ctx.toggleStreaming) {
			await ctx.toggleStreaming(!!b.enabled)
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, enabled: !!b.enabled }) }
		}
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'toggleStreaming not implemented' }) }
	}

	if (path === '/api/streaming/restart') {
		if (ctx.restartStreaming) {
			await ctx.restartStreaming()
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
		}
		return { status: 500, headers: JSON_HEADERS, body: jsonBody({ error: 'restartStreaming not implemented' }) }
	}

	return null
}

module.exports = { handleGet, handlePost, proxyGo2rtcWebrtc }
