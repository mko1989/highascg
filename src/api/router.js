/**
 * Main HTTP API dispatcher (split from companion `api-routes.js`).
 *
 * Routes registered **before** the Caspar gate (503 when offline) include settings, hardware, streams, streaming
 * toggle, OSC, and audio device/volume — usable with `--no-caspar` or when AMCP is down (WO-03).
 */

'use strict'

const liveSceneState = require('../state/live-scene-state')
const { JSON_HEADERS, jsonBody, parseBody, parseQueryString } = require('./response')
const { getState } = require('./get-state')

const routesState = require('./routes-state')
const routesMedia = require('./routes-media')
const routesAmcp = require('./routes-amcp')
const routesMixer = require('./routes-mixer')
const routesCg = require('./routes-cg')
const routesData = require('./routes-data')
const routesConfig = require('./routes-config')
const routesMultiview = require('./routes-multiview')
const routesScene = require('./routes-scene')
const routesMisc = require('./routes-misc')
const routesTimeline = require('./routes-timeline')
const routesStreaming = require('./routes-streaming')
const routesOsc = require('./routes-osc')
const routesSettings = require('./routes-settings')
const routesAudio = require('./routes-audio')
const routesProject = require('./routes-project')
const routesLedTestCard = require('./routes-led-test-card')
const routesFtb = require('./routes-ftb')
const routesSystemStaged = require('./routes-system-staged')
const routesIngest = require('./routes-ingest')
const routesSystemSetup = require('./routes-system-setup')
const routesCasparConfig = require('./routes-caspar-config')
const routesLogs = require('./routes-logs')
const routesHostStats = require('./routes-host-stats')

/**
 * @param {string} method
 * @param {string} path
 * @param {string} body
 * @param {import('http').IncomingMessage} req — raw request for streaming
 */
async function routeRequest(method, path, body, ctx, req) {
	const pathRaw = path || ''
	const qIdx = pathRaw.indexOf('?')
	const query = parseQueryString(qIdx >= 0 ? pathRaw.slice(qIdx + 1) : '')
	let p = qIdx >= 0 ? pathRaw.slice(0, qIdx) : pathRaw
	const instanceMatch = p.match(/^\/instance\/[^/]+\/(.+)$/)
	if (instanceMatch) p = '/' + instanceMatch[1]
	if (!p.startsWith('/api/')) {
		return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
	}

	if (method === 'POST' && p === '/api/selection') {
		return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
	}

	if (method === 'GET' && (p === '/api/caspar-config/generate' || p === '/api/caspar-config/mode-choices')) {
		const cr = routesCasparConfig.handleGet(p, query, ctx)
		if (cr) return cr
	}

	if (method === 'POST' && p === '/api/caspar-config/apply') {
		return await routesCasparConfig.handlePost(p, body, ctx)
	}

	if (method === 'GET' && p === '/api/logs') {
		const lr = routesLogs.handleGet(p, query, ctx)
		if (lr) return lr
	}
	if (method === 'POST' && p === '/api/logs/clear') {
		const lr = routesLogs.handlePost(p, body)
		if (lr) return lr
	}

	if (method === 'GET' && p === '/api/host-stats') {
		return await routesHostStats.handleGet(ctx)
	}

	if (method === 'GET' && p === '/api/scene/live') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody({
				channels: liveSceneState.getAll(),
				programLayerBankByChannel: ctx.programLayerBankByChannel || {},
			}),
		}
	}

	if (method === 'GET' && p.startsWith('/api/osc')) {
		const or = routesOsc.handleGet(p, ctx)
		if (or) return or
	}

	if (method === 'GET' && p === '/api/audio/devices') {
		const ar = routesAudio.handleGet(p, query)
		if (ar) return ar
	}

	if (method === 'POST' && p === '/api/audio/default-device') {
		const ar = await routesAudio.handlePost(p, body, ctx)
		if (ar) return ar
	}

	if (method === 'POST' && p === '/api/audio/volume') {
		const ar = await routesAudio.handlePost(p, body, ctx)
		if (ar) return ar
	}

	if (method === 'POST' && (p === '/api/audio/config' || p === '/api/audio/route')) {
		const ar = await routesAudio.handlePost(p, body, ctx)
		if (ar) return ar
	}

	if (method === 'GET' && (p === '/api/variables' || p === '/api/variables/batch' || p === '/api/variables/custom')) {
		const r = await routesState.handleGet(p, ctx, query)
		if (r) return r
	}

	if (method === 'POST' && (p === '/api/variables/batch' || p === '/api/variables/custom')) {
		const r = await routesState.handlePost(p, body, ctx)
		if (r) return r
	}

	// Settings, hardware, go2rtc stream list, and streaming toggle — usable without Caspar (WO-03 / WO-05 / WO-06).
	if (method === 'GET' && p === '/api/settings') {
		const r = await routesSettings.handleGet(p, ctx)
		if (r) return r
	}
	if (method === 'GET' && p === '/api/system/setup') {
		const r = await routesSystemSetup.handleGet(p, ctx)
		if (r) return r
	}
	if (method === 'GET' && p === '/api/hardware/displays') {
		const r = await routesSettings.handleHardwareGet(p)
		if (r) return r
	}
	if (method === 'GET' && (p === '/api/streams' || p === '/api/streaming/ndi-sources')) {
		const r = await routesStreaming.handleGet(p, ctx)
		if (r) return r
	}
	if (method === 'GET' && p.startsWith('/api/project/')) {
		const pr = await routesProject.handleGet(p, query, ctx)
		if (pr) return pr
	}
	// Same-origin WebRTC SDP exchange (avoids CORS: browser :8080 → go2rtc :1984)
	if (method === 'POST' && p === '/api/go2rtc/webrtc') {
		return await routesStreaming.proxyGo2rtcWebrtc(query, body, ctx)
	}
	if (method === 'POST' && p === '/api/settings') {
		try {
			const r = await routesSettings.handlePost(p, body, ctx)
			if (r) return r
		} catch (e) {
			const msg = e?.message || String(e)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}
	if (method === 'POST' && p === '/api/settings/apply-os') {
		try {
			const r = await routesSettings.handleOsPost(p, ctx)
			if (r) return r
		} catch (e) {
			const msg = e?.message || String(e)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}
	if (method === 'POST' && (p === '/api/streaming/toggle' || p === '/api/streaming/restart')) {
		try {
			const r = await routesStreaming.handlePost(p, body, ctx)
			if (r) return r
		} catch (e) {
			const msg = e?.message || String(e)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}

	{
		const sr = routesSystemStaged.handle(method, p)
		if (sr) return sr
	}

	// Ingest routes — must work without Caspar for offline/upload scenarios
	if (method === 'POST' && p === '/api/ingest/upload') return await routesIngest.handleUpload(req, null, ctx)
	if (method === 'POST' && p === '/api/ingest/download') return await routesIngest.handleDownload(body, ctx)
	if (method === 'GET' && p === '/api/ingest/download-status') return routesIngest.handleGetDownloadStatus(ctx)
	if (method === 'GET' && p === '/api/ingest/preview') return await routesIngest.handleIngestPreview(query, ctx)

	// Media list + local ffprobe — must work when AMCP is down (same folder as ingest / offline)
	// Project JSON — works without Caspar (disk mirror from web UI Save)
	if (method === 'POST' && (p === '/api/project/save' || p === '/api/project/load')) {
		const r = await routesData.handleProject(p, body, ctx)
		if (r) return r
	}
	if (method === 'GET' && p === '/api/project') {
		const r = await routesData.handleProjectGet(ctx)
		if (r) return r
	}

	if (method === 'GET' && p === '/api/media') {
		const r = await routesState.handleGet(p, ctx, query)
		if (r) return r
	}
	// Duration for timeline drop: CINF + ffprobe fallback — must work when AMCP is down if files are on disk
	if (method === 'POST' && p === '/api/media/cinf') {
		const r = await routesMedia.handlePost(p, body, ctx)
		if (r) return r
	}

	if (method === 'GET') {
		const tr = await routesMedia.handleThumbnail(p, query, ctx)
		if (tr) return tr
		const lr = await routesMedia.handleLocalMedia(p, query, ctx)
		if (lr) return lr
	}

	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}

	try {
		if (method === 'GET') {
			let r = await routesState.handleGet(p, ctx, query)
			if (r) return r
			r = await routesMixer.handleGet(p, query, ctx)
			if (r) return r
		}

		if (method === 'POST') {
			let r = await routesAmcp.handlePost(p, body, ctx)
			if (r) return r
			r = await routesMixer.handlePost(p, body, ctx)
			if (r) return r
			r = await routesLedTestCard.handlePost(p, body, ctx)
			if (r) return r
			r = await routesFtb.handlePost(p, body, ctx)
			if (r) return r
			r = await routesCg.handlePost(p, body, ctx)
			if (r) return r
			r = await routesData.handlePost(p, body, ctx)
			if (r) return r
			r = await routesConfig.handlePost(p, body, ctx)
			if (r) return r
			r = await routesMedia.handlePost(p, body, ctx)
			if (r) return r
			r = await routesMultiview.handlePost(p, body, ctx)
			if (r) return r
			r = await routesScene.handlePost(p, body, ctx)
			if (r) return r
			r = await routesProject.handlePost(p, body, ctx)
			if (r) return r
			r = await routesMisc.handlePost(p, body, ctx)
			if (r) return r
		}

		const tlResult = await routesTimeline.handle(method, p, body, ctx)
		if (tlResult) return tlResult
	} catch (e) {
		const msg = e?.message || String(e)
		return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
	}

	return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
}

module.exports = {
	routeRequest,
	getState,
	parseBody,
	parseQueryString,
	JSON_HEADERS,
	jsonBody,
}
