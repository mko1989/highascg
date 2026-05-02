/**
 * Device View API Routes.
 */
'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { normalizeDeviceGraph, validateDeviceGraph, graphFromTandemTopology, mergeHardwareSync, suggestConnectorsAndDevicesFromLive } = require('../config/device-graph')
const { normalizeTandemTopology } = require('../config/tandem-topology')

const Snapshot = require('./device-view-snapshot')
const Apply = require('./device-view-apply')
const CRUD = require('./device-view-crud')

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
async function handleGet(path, ctx, query) {
	ctx.augmentGraphWithSources = augmentGraphWithSources
	if (path !== '/api/device-view' && path !== '/api/device-view/gpu-map-debug') return null
	const live = await Snapshot.buildLiveSnapshot(ctx, query.pixelhue !== '0')
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
	return {
		status: 200, headers: JSON_HEADERS,
		body: jsonBody({
			ok: true,
			graph,
			live,
			suggested: suggestConnectorsAndDevicesFromLive(live, ctx.config || {}),
			tandemTopology: normalizeTandemTopology(ctx.config?.tandemTopology),
			bootstrap: graphFromTandemTopology(normalizeTandemTopology(ctx.config?.tandemTopology)),
			audioOutputs: Array.isArray(ctx.config?.audioOutputs) ? ctx.config.audioOutputs : [],
			mappingTemplates: Array.isArray(ctx.config?.mappingTemplates) ? ctx.config.mappingTemplates : [],
		})
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
	else if (j.addMappingNode) res = CRUD.handleAddMappingNode(j, ctx)
	else if (j.updateDestination) res = CRUD.handleUpdateDestination(j, ctx)
	else if (j.removeDestination) res = CRUD.handleRemoveDestination(j, ctx)
	else if (j.addEdge) res = CRUD.handleAddEdge(j, ctx, await Snapshot.buildLiveSnapshot(ctx, j.pixelhue !== false))
	else if (j.removeEdge) res = CRUD.handleRemoveEdge(j, ctx)
	else if (j.removeAllEdges) res = CRUD.handleRemoveAllEdges(j, ctx)
	else if (j.updateConnector) res = CRUD.handleUpdateConnector(j, ctx, await Snapshot.buildLiveSnapshot(ctx, j.pixelhue !== false))
	else if (j.deviceGraph && typeof j.deviceGraph === 'object') {
		const next = normalizeDeviceGraph(j.deviceGraph)
		const v = validateDeviceGraph(next)
		if (!v.ok) res = { error: 'Invalid deviceGraph', details: v.errors }
		else {
			if (!persistConfigPatch(ctx, { deviceGraph: next })) {
				res = { status: 503, error: 'Failed to save config (check permissions on highascg.config.json / HIGHASCG_CONFIG_PATH)' }
			} else {
				ctx.config.deviceGraph = next
				const live = await Snapshot.buildLiveSnapshot(ctx, j.pixelhue !== false)
				augmentGraphWithSources(next, live)
				res = { ok: true, graph: next }
			}
		}
	}
	else if (j.syncFromLive === true) {
		const suggested = suggestConnectorsAndDevicesFromLive(await Snapshot.buildLiveSnapshot(ctx, j.pixelhue !== false), ctx.config || {})
		const next = mergeHardwareSync(ctx.config?.deviceGraph, suggested)
		if (!persistConfigPatch(ctx, { deviceGraph: next })) {
			res = { status: 503, error: 'Failed to save config (check permissions on highascg.config.json / HIGHASCG_CONFIG_PATH)' }
		} else {
			ctx.config.deviceGraph = next
			const live = await Snapshot.buildLiveSnapshot(ctx, j.pixelhue !== false)
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
			const live = await Snapshot.buildLiveSnapshot(ctx, j.pixelhue !== false)
			augmentGraphWithSources(norm, live)
			res = { ok: true, graph: norm, removedConnectorId: id }
		}
	} else if (j.addExtraLiveSource) {
		const list = Array.isArray(ctx.config.extraLiveSources) ? [...ctx.config.extraLiveSources] : []
		const item = j.addExtraLiveSource
		if (item && item.value) {
			const existing = list.findIndex(x => x.value === item.value)
			if (existing >= 0) list[existing] = item
			else list.push(item)
			if (persistConfigPatch(ctx, { extraLiveSources: list })) {
				ctx.config.extraLiveSources = list
				res = { ok: true, extraLiveSources: list }
			} else {
				res = { status: 503, error: 'Failed to save config' }
			}
		}
	} else if (j.removeExtraLiveSource) {
		const list = (Array.isArray(ctx.config.extraLiveSources) ? ctx.config.extraLiveSources : []).filter(x => x.value !== j.removeExtraLiveSource.value)
		if (persistConfigPatch(ctx, { extraLiveSources: list })) {
			ctx.config.extraLiveSources = list
			res = { ok: true, extraLiveSources: list }
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
