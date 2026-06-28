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
const routesComposePreview = require('./routes-compose-preview')
const { applyUiSelectionPayloadToVariables } = require('./apply-ui-selection-variables')
const routesFtb = require('./routes-ftb')
const routesSystemStaged = require('./routes-system-staged')
const routesIngest = require('./routes-ingest')
const routesUsbIngest = require('./routes-usb-ingest')
const routesStreamingChannel = require('./routes-streaming-channel')
const routesSystemSetup = require('./routes-system-setup')
const routesSystemHardware = require('./routes-system-hardware')
const routesExfatSync = require('./routes-exfat-sync')
const routesCasparConfig = require('./routes-caspar-config')
const routesLogs = require('./routes-logs')
const routesHostStats = require('./routes-host-stats')
const routesPipOverlay = require('./routes-pip-overlay')
const routesArtnet = require('./routes-artnet')
const routesModules = require('./routes-modules')
const routesDeviceView = require('./routes-device-view')
const routesDeviceSnapshot = require('./routes-device-snapshot')
const routesPlugins = require('./routes-plugins')
const routesNdi = require('./routes-ndi')
const routesLowerThirds = require('./routes-lower-thirds')
const routesCgThumb = require('./routes-cg-thumb')
const routesReplication = require('./routes-replication')
const routesPrivateSync = require('./routes-private-sync')
const moduleRegistry = require('../module-registry')

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
		try {
			const payload = parseBody(body)
			if (ctx.state) applyUiSelectionPayloadToVariables(ctx.state, payload && typeof payload === 'object' ? payload : {})
			return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true }) }
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e)
			return { status: 500, headers: JSON_HEADERS, body: jsonBody({ ok: false, error: msg }) }
		}
	}

	{
		const mr = routesModules.handle(method, p)
		if (mr) return mr
	}
	{
		const pg = routesPlugins.handleGet(method, p, ctx)
		if (pg) return pg
	}

	if (method === 'GET' && (p === '/api/caspar-config/generate' || p === '/api/caspar-config/mode-choices' || p === '/api/caspar-config/override')) {
		const cr = routesCasparConfig.handleGet(p, query, ctx)
		if (cr) return cr
	}

	if (method === 'POST' && (p === '/api/caspar-config/apply' || p === '/api/caspar-config/override')) {
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

	if (method === 'GET') {
		const replGet = await routesReplication.handleGet(p, ctx, req)
		if (replGet) return replGet
	}
	if (method === 'POST') {
		const replPost = await routesReplication.handlePost(p, body, ctx, req)
		if (replPost) return replPost
	}

	if (method === 'GET' && p === '/api/system/exfat-sync') {
		const r = await routesExfatSync.handleGet(p, ctx)
		if (r) return r
	}
	if (method === 'POST' && p === '/api/system/exfat-sync/run') {
		const r = await routesExfatSync.handlePost(p, body, ctx)
		if (r) return r
	}
	if (method === 'GET') {
		const pr = await routesPrivateSync.handleGet(p, ctx)
		if (pr) return pr
	}
	if (method === 'POST') {
		const pr = await routesPrivateSync.handlePost(p, body, ctx)
		if (pr) return pr
	}
	if (
		method === 'GET' &&
		(p === '/api/system/gpu-nvidia' ||
			p === '/api/system/decklink' ||
			p === '/api/system/gpu-layout' ||
			p === '/api/system/xrandr-layout' ||
			p === '/api/system/network')
	) {
		const r = await routesSystemHardware.hardwareHandleGet(p, ctx)
		if (r) return r
	}
	if (
		method === 'POST' &&
		(p === '/api/system/gpu-nvidia/apply' ||
			p === '/api/system/gui-launch' ||
			p === '/api/system/gpu-ports-reset' ||
			p === '/api/system/xrandr-layout/apply' ||
			p === '/api/system/network/apply')
	) {
		const r = await routesSystemHardware.hardwareHandlePost(p, body, ctx)
		if (r) return r
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

	if (method === 'GET' && p === '/api/artnet/input') {
		return routesArtnet.handleGetArtnetInput(ctx)
	}

	if (method === 'GET' && p.startsWith('/api/osc')) {
		const or = routesOsc.handleGet(p, ctx)
		if (or) return or
	}

	if (
		method === 'GET' &&
		(p === '/api/audio/devices' ||
			p === '/api/audio/portaudio-devices' ||
			p === '/api/audio/live-inputs' ||
			p === '/api/audio/alsa-mixer')
	) {
		const ar = routesAudio.handleGet(p, query, ctx)
		if (ar) return ar
	}

	if (method === 'POST' && (p === '/api/audio/default-device' || p === '/api/audio/alsa-mixer')) {
		const ar = await routesAudio.handlePost(p, body, ctx)
		if (ar) return ar
	}

	if (method === 'POST' && p === '/api/audio/volume') {
		const ar = await routesAudio.handlePost(p, body, ctx)
		if (ar) return ar
	}

	if (
		method === 'POST' &&
		(p === '/api/audio/config' ||
			p === '/api/audio/route' ||
			p === '/api/audio/monitor-source' ||
			p === '/api/audio/solo' ||
			p === '/api/audio/live-inputs/apply' ||
			p === '/api/audio/live-inputs/config')
	) {
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

	// Settings, hardware, stream list, and streaming toggle — usable without Caspar (WO-03 / WO-05 / WO-06).
	if (method === 'GET' && p === '/api/settings') {
		const r = await routesSettings.handleGet(p, ctx)
		if (r) return r
	}
	if (method === 'GET' && p === '/api/system/setup') {
		const r = await routesSystemSetup.handleGet(p, ctx)
		if (r) return r
	}
	if (
		method === 'POST' &&
		(p === '/api/system/setup/restart-window-manager' ||
			p === '/api/system/setup/reboot' ||
			p === '/api/system/setup/restart-app')
	) {
		const r = await routesSystemSetup.handlePost(p, body, ctx)
		if (r) return r
	}

	{
		const dv =
			(p === '/api/device-view' || p === '/api/device-view/gpu-map-debug' || p === '/api/device-view/snapshot')
				? method === 'GET'
					? await routesDeviceView.handleGet(p, ctx, query)
					: method === 'POST'
						? await routesDeviceView.handlePost(body, ctx)
						: null
				: null
		if (dv) return dv
	}

	if (method === 'GET' && (p === '/api/device-snapshot/build' || p === '/api/device-snapshot/schema')) {
		const ds = routesDeviceSnapshot.handleGet(p, ctx)
		if (ds) return ds
	}
	if (method === 'POST' && p === '/api/device-snapshot/apply') {
		return await routesDeviceSnapshot.handlePost(body, ctx)
	}

	if (method === 'GET' && (p === '/api/hardware/displays' || p === '/api/hardware/modeline-preview')) {
		const r = await routesSettings.handleHardwareGet(p, query)
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
	if (method === 'POST' && p === '/api/settings') {
		try {
			const r = await routesSettings.handlePost(p, body, ctx)
			if (r) return r
		} catch (e) {
			const msg = e?.message || String(e)
			return { status: 502, headers: JSON_HEADERS, body: jsonBody({ error: msg }) }
		}
	}
	{
		const pg = await routesPlugins.handlePost(method, p, body, ctx)
		if (pg) return pg
	}
	if (method === 'POST' && p === '/api/settings/apply-os') {
		try {
			const r = await routesSettings.handleOsPost(p, body, ctx)
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

	if (method === 'POST' && (p === '/api/config/apply' || p === '/api/config/reset')) {
		return await routesConfig.handlePost(p, body, ctx)
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

	// USB ingest (WO-29) — no Caspar required
	{
		const ur = await routesUsbIngest.handle(method, p, pathRaw, body, ctx, req)
		if (ur) return ur
	}

	// Media list + local ffprobe — must work when AMCP is down (same folder as ingest / offline)
	// Project JSON — works without Caspar (disk mirror from web UI Save)
	if (method === 'POST' && (p === '/api/project/save' || p === '/api/project/load' || p === '/api/project/autosave')) {
		const r = await routesData.handleProject(p, body, ctx)
		if (r) return r
	}
	if (method === 'GET' && p === '/api/project/list') {
		const r = await routesData.handleProjectList(ctx)
		if (r) return r
	}
	if (method === 'GET' && (p === '/api/project' || p === '/api/project/')) {
		const r = await routesData.handleProjectGet(ctx)
		if (r) return r
	}

	if (method === 'GET' && p === '/api/media') {
		const r = await routesState.handleGet(p, ctx, query)
		if (r) return r
	}
	if (method === 'DELETE' && p.startsWith('/api/local-media/')) {
		const r = await routesMedia.handleDeleteLocalMedia(p, ctx)
		if (r) return r
	}
	// Body { id } avoids URL-encoding issues with slashes in paths (some stacks mishandle %2F in DELETE URLs).
	if (method === 'POST' && p === '/api/media/delete') {
		const r = await routesMedia.handleMediaDelete(body, ctx)
		if (r) return r
	}
	if (method === 'POST' && p === '/api/media/mkdir') {
		const r = await routesMedia.handleMediaMkdir(body, ctx)
		if (r) return r
	}
	if (method === 'POST' && p === '/api/media/move') {
		const r = await routesMedia.handleMediaMove(body, ctx)
		if (r) return r
	}
	if (method === 'POST' && p === '/api/media/copy') {
		const r = await routesMedia.handleMediaCopy(body, ctx)
		if (r) return r
	}
	if (method === 'POST' && p === '/api/media/refresh') {
		const r = await routesMedia.handleMediaRefresh(body, ctx)
		if (r) return r
	}
	// Duration for timeline drop: CINF + ffprobe fallback — must work when AMCP is down if files are on disk
	if (method === 'POST' && p === '/api/media/cinf') {
		const r = await routesMedia.handlePost(p, body, ctx, req, query)
		if (r) return r
	}
	// Live PRINT still cache — before Caspar gate (returns 502 if AMCP down, not blanket 503)
	if (method === 'POST' && p === '/api/thumbnail/live/capture') {
		const r = await routesMedia.handlePost(p, body, ctx, req, query)
		if (r) return r
	}
	if (method === 'POST' && p === '/api/thumbnail/live/upload') {
		const r = await routesMedia.handlePost(p, body, ctx, req, query)
		if (r) return r
	}
	if (method === 'POST' && p === '/api/compose-preview/refresh') {
		const r = await routesComposePreview.handlePost(p, body, ctx)
		if (r) return r
	}

	if (method === 'POST' && p === '/api/cg-thumb/render') {
		const r = await routesCgThumb.handlePost(p, body, ctx)
		if (r) return r
	}

	if (method === 'GET') {
		const cgtr = await routesCgThumb.handleGet(p, query, ctx)
		if (cgtr) return cgtr
		const cpr = await routesComposePreview.handleGet(p, query, ctx)
		if (cpr) return cpr
		const tr = await routesMedia.handleThumbnail(p, query, ctx)
		if (tr) return tr
		const lr = await routesMedia.handleLocalMedia(p, query, ctx)
		if (lr) return lr
	}

	{
		const srCh = await routesStreamingChannel.handle(method, p, body, ctx)
		if (srCh) return srCh
	}

	// Lower-thirds API — works before Caspar gate (listing templates is offline-safe)
	if (method === 'GET' && p.startsWith('/api/lower-thirds/')) {
		const lr = routesLowerThirds.handleGet(p, ctx, query)
		if (lr) return lr
	}
	if (method === 'POST' && p.startsWith('/api/lower-thirds/')) {
		const lr = await routesLowerThirds.handlePost(p, body, ctx, req)
		if (lr) return lr
	}

	// Optional-module routes run **before** the Caspar gate so modules that don't need AMCP
	// (tracking, auto-follow config, etc.) stay reachable when Caspar is offline. Modules that
	// do need AMCP can check `ctx.amcp` themselves.
	{
		const moduleEarly = await moduleRegistry.handleApi(method, p, body, ctx, req, query)
		if (moduleEarly) return moduleEarly
	}

	if (!ctx.amcp) {
		return { status: 503, headers: JSON_HEADERS, body: jsonBody({ error: 'Caspar not connected' }) }
	}

	try {
		if (method === 'GET') {
			let r = await routesNdi.handleGet(p, ctx, query)
			if (r) return r
			r = await routesPipOverlay.handleGet(p, ctx)
			if (r) return r
			r = await routesState.handleGet(p, ctx, query)
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
			r = await routesPipOverlay.handlePost(p, body, ctx)
			if (r) return r
			r = await routesCg.handlePost(p, body, ctx)
			if (r) return r
			r = await routesData.handlePost(p, body, ctx)
			if (r) return r
			r = await routesMedia.handlePost(p, body, ctx, req, query)
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
