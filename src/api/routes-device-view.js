/**
 * Device View API Routes.
 */
'use strict'

const crypto = require('crypto')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { normalizeDeviceGraph, validateDeviceGraph, mergeHardwareSync, suggestConnectorsAndDevicesFromLive } = require('../config/device-graph')
const { normalizeScreenDestinations } = require('../config/screen-destinations')

const Snapshot = require('./device-view-snapshot')
const Apply = require('./device-view-apply')
const CRUD = require('./device-view-crud')
const CRUD_MAPPING = require('./device-view-crud-mapping')
const { enrichExtraLiveSource, enrichExtraLiveSources } = require('../config/extra-live-source-enrich')

/**
 * Merge patch into on-disk config and refresh `ctx.config` from ConfigManager (same as `change` listener).
 * @param {object} ctx
 * @param {object} patch
 * @returns {boolean}
 */
function persistConfigPatch(ctx, patch) {
	if (!ctx.configManager) {
		if (typeof ctx.log === 'function') ctx.log('warn', '[device-view] configManager missing; not writing to disk')
		Object.assign(ctx.config, patch)
		return true
	}
	return ctx.configManager.save({ ...ctx.configManager.get(), ...patch })
}

/**
 * Augment graph with virtual sources (destinations) for resolution inheritance.
 * @param {object} graph
 * @param {object} live
 */
function augmentGraphWithSources(graph, live) {
	if (!graph || typeof graph !== 'object') return
	const items = Array.isArray(live?.caspar?.destinationIntent?.items) ? live.caspar.destinationIntent.items : []
	graph.sources = items.map((it) => ({
		id: `dst_in_${it.id}`,
		label: it.label,
		videoMode: it.videoMode,
		width: it.width,
		height: it.height,
		fps: it.fps,
	}))
}

/**
 * @param {string} path
 * @param {object} ctx
 * @param {Record<string, string>} query
 */
async function handleGet(path, ctx, query, req) {
	ctx.augmentGraphWithSources = augmentGraphWithSources
	if (path !== '/api/device-view' && path !== '/api/device-view/gpu-map-debug' && path !== '/api/device-view/snapshot') return null
	try {
		const { touchDeviceViewGpuWatch } = require('../bootstrap/gpu-drm-hotplug-watch')
		touchDeviceViewGpuWatch(ctx)
	} catch {
		/* optional */
	}
	if (query?.freshGpu === '1' || query?.fresh === '1') {
		try {
			const { invalidateXrandrCache } = require('../utils/hardware-info')
			invalidateXrandrCache()
		} catch {
			/* optional */
		}
		try {
			Snapshot.invalidateDecklinkHwCache() // WO-396
		} catch {
			/* optional */
		}
	}
	const live = await Snapshot.buildLiveSnapshot(ctx)
	if (path === '/api/device-view/snapshot') {
		return {
			status: 200,
			headers: JSON_HEADERS,
			body: jsonBody(live),
		}
	}
	if (path === '/api/device-view/gpu-map-debug') {
		return {
			status: 200, headers: JSON_HEADERS,
			body: jsonBody({
				ok: true,
				gpu: {
					displays: live?.gpu?.displays || [],
					connectors: live?.gpu?.connectors || [],
					physicalMap: live?.gpu?.physicalMap || null,
				},
				warnings: live?.warnings || [],
			}),
		}
	}
	const graph = normalizeDeviceGraph(ctx.config?.deviceGraph)
	augmentGraphWithSources(graph, live)
	const { maskDeviceGraphConnectorKeys } = require('../engine/project-stream-credentials')
	const payload = {
		ok: true,
		graph: maskDeviceGraphConnectorKeys(graph), // WO-261: never emit raw per-connector stream keys

		live,
		suggested: suggestConnectorsAndDevicesFromLive(live, ctx.config || {}),
		screenDestinations: normalizeScreenDestinations(ctx.config?.screenDestinations),
		extraLiveSources: enrichExtraLiveSources(
			Array.isArray(ctx.config?.extraLiveSources) ? ctx.config.extraLiveSources : [],
			ctx,
		),
		audioOutputs: Array.isArray(ctx.config?.audioOutputs) ? ctx.config.audioOutputs : [],
		mappingTemplates: Array.isArray(ctx.config?.mappingTemplates) ? ctx.config.mappingTemplates : [],
	}

	// T202.3: Generate ETag from payload JSON hash
	const payloadJson = JSON.stringify(payload)
	const etag = `"${crypto.createHash('md5').update(payloadJson).digest('hex')}"`

	// Check If-None-Match header
	const ifNoneMatch = req?.headers?.['if-none-match'] || query?.ifNoneMatch
	if (ifNoneMatch && String(ifNoneMatch).trim() === etag) {
		return {
			status: 304,
			headers: { 'ETag': etag, 'Cache-Control': 'private, max-age=3' }
		}
	}

	return {
		status: 200,
		headers: { ...JSON_HEADERS, 'ETag': etag, 'Cache-Control': 'private, max-age=3' },
		body: payloadJson
	}
}

/**
 * @param {string} body
 * @param {object} ctx
 */
async function handlePost(body, ctx) {
	ctx.augmentGraphWithSources = augmentGraphWithSources
	const j = parseBody(body) || {}; let res = null
	if (j.applyPlan) res = await Apply.executeApplyPlan(ctx, typeof j.applyPlan === 'object' ? j.applyPlan : {})
	else if (j.addDestination) res = CRUD.handleAddDestination(j, ctx)
	else if (j.addMappingNode) res = CRUD_MAPPING.handleAddMappingNode(j, ctx)
	// WO-494: dedicated handler so the DeckLinks the node fed are released. It must sit ABOVE the
	// generic `j.deviceGraph` branch, which only persists and cannot tell a deletion from any edit.
	else if (j.removeMappingNode) res = CRUD_MAPPING.handleRemoveMappingNode(j, ctx)
	else if (j.updateDestination) res = CRUD.handleUpdateDestination(j, ctx)
	else if (j.removeDestination) res = CRUD.handleRemoveDestination(j, ctx)
	else if (j.addEdge) res = CRUD.handleAddEdge(j, ctx, await Snapshot.buildLiveSnapshot(ctx))
	else if (j.removeEdge) res = CRUD.handleRemoveEdge(j, ctx)
	else if (j.removeAllEdges) res = CRUD.handleRemoveAllEdges(j, ctx)
	else if (j.updateConnector) res = CRUD.handleUpdateConnector(j, ctx, await Snapshot.buildLiveSnapshot(ctx))
	else if (j.deviceGraph && typeof j.deviceGraph === 'object') {
		const next = normalizeDeviceGraph(j.deviceGraph)
		const v = validateDeviceGraph(next)
		if (!v.ok) res = { error: 'Invalid deviceGraph', details: v.errors }
		else {
			if (!persistConfigPatch(ctx, { deviceGraph: next })) {
				res = { status: 503, error: 'Failed to save config (check permissions on highascg.config.json / HIGHASCG_CONFIG_PATH)' }
			} else {
				ctx.config.deviceGraph = next
				const live = await Snapshot.buildLiveSnapshot(ctx)
				augmentGraphWithSources(next, live)
				res = { ok: true, graph: next }
			}
		}
	}
	else if (j.syncFromLive === true) {
		const suggested = suggestConnectorsAndDevicesFromLive(await Snapshot.buildLiveSnapshot(ctx), ctx.config || {})
		const next = mergeHardwareSync(ctx.config?.deviceGraph, suggested)
		if (!persistConfigPatch(ctx, { deviceGraph: next })) {
			res = { status: 503, error: 'Failed to save config (check permissions on highascg.config.json / HIGHASCG_CONFIG_PATH)' }
		} else {
			ctx.config.deviceGraph = next
			const live = await Snapshot.buildLiveSnapshot(ctx)
			augmentGraphWithSources(next, live)
			res = { ok: true, graph: next, suggestedCount: suggested.connectors.length }
		}
	}
	else if (j.removeConnector?.id) {
		const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph); const id = String(j.removeConnector.id)
		const next = { ...g0, connectors: (g0.connectors || []).filter(c => c.id !== id), edges: (g0.edges || []).filter(e => e.sourceId !== id && e.sinkId !== id) }
		const norm = normalizeDeviceGraph(next)
		if (!persistConfigPatch(ctx, { deviceGraph: norm })) {
			res = { status: 503, error: 'Failed to save config (check permissions on highascg.config.json / HIGHASCG_CONFIG_PATH)' }
		} else {
			ctx.config.deviceGraph = norm
			const live = await Snapshot.buildLiveSnapshot(ctx)
			augmentGraphWithSources(norm, live)
			res = { ok: true, graph: norm, removedConnectorId: id }
		}
	} else if (j.addExtraLiveSource) {
		const list = Array.isArray(ctx.config.extraLiveSources) ? [...ctx.config.extraLiveSources] : []
		const item = j.addExtraLiveSource
		// WO-258: browser_display entries are keyed by `url` (real Firefox + x11grab), not `value`/
		// `templateOrUrl` (CEF) or `ndiName`.
		if (item && (item.value || item.ndiName || item.templateOrUrl || (item.mode === 'browser_display' && item.url))) {
			try {
				const { normalizeToHostLiveSource } = require('../config/host-live-sources')
				const normalized = normalizeToHostLiveSource(item, ctx)
				const enriched = enrichExtraLiveSource(normalized, ctx)
				const existingIdx = list.findIndex(
					(x) => x.value === enriched.value || (enriched.sourceId && x.sourceId === enriched.sourceId),
				)
				const isNewEntry = existingIdx < 0
				if (existingIdx >= 0) list[existingIdx] = enriched
				else list.push(enriched)
				if (persistConfigPatch(ctx, { extraLiveSources: list })) {
					ctx.config.extraLiveSources = list
					let playResult = null
					let casparRestartRecommended = false
					try {
						const { playHostLiveSourceNow } = require('../config/host-live-sources-setup')
						const { isHostLiveSource } = require('../config/host-live-sources')
						const { hostLiveCasparChannelsOutOfDate } = require('../config/host-live-sources-caspar')
						if (isHostLiveSource(enriched)) {
							const casparCheck = hostLiveCasparChannelsOutOfDate(ctx)
							casparRestartRecommended = isNewEntry && !!casparCheck.needed
							if (ctx.amcp && (!casparCheck.needed || !isNewEntry)) {
								playResult = await playHostLiveSourceNow(ctx, enriched)
							}
						}
					} catch (e) {
						playResult = { ok: false, error: e?.message || String(e) }
					}
					res = {
						ok: true,
						extraLiveSources: list.map((x) => enrichExtraLiveSource(x, ctx)),
						hostLivePlay: playResult,
						casparRestartRecommended,
						pendingApply: casparRestartRecommended,
					}
					if (typeof ctx._wsBroadcast === 'function') {
						ctx._wsBroadcast('change', { path: 'extraLiveSources', value: list })
					}
				} else {
					res = { status: 503, error: 'Failed to save config' }
				}
			} catch (e) {
				res = { status: 400, error: e?.message || String(e) }
			}
		}
	} else if (j.removeExtraLiveSource) {
		const list = (Array.isArray(ctx.config.extraLiveSources) ? ctx.config.extraLiveSources : []).filter(x => x.value !== j.removeExtraLiveSource.value)
		if (persistConfigPatch(ctx, { extraLiveSources: list })) {
			ctx.config.extraLiveSources = list
			res = { ok: true, extraLiveSources: list }
			if (typeof ctx._wsBroadcast === 'function') {
				ctx._wsBroadcast('change', { path: 'extraLiveSources', value: list })
			}
		} else {
			res = { status: 503, error: 'Failed to save config' }
		}
	} else if (Array.isArray(j.mappingTemplates)) {
		const next = j.mappingTemplates
		if (persistConfigPatch(ctx, { mappingTemplates: next })) {
			ctx.config.mappingTemplates = next
			res = { ok: true, mappingTemplates: next }
		} else {
			res = { status: 503, error: 'Failed to save config' }
		}
	}

	if (res) {
		if (res.error) return { status: Number(res.status) >= 400 && Number(res.status) < 600 ? Number(res.status) : 400, headers: JSON_HEADERS, body: jsonBody(res) }
		return { status: 200, headers: JSON_HEADERS, body: jsonBody(res) }
	}
	return { status: 404, headers: JSON_HEADERS, body: jsonBody({ error: 'Not found' }) }
}

module.exports = { handleGet, handlePost, buildDecklinkSummary: Snapshot.buildDecklinkSummary, buildLiveSnapshot: Snapshot.buildLiveSnapshot, executeApplyPlan: Apply.executeApplyPlan }
