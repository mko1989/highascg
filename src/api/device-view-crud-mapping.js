/**
 * Device View CRUD for pixel-mapping nodes.
 *
 * Split out of `device-view-crud.js` under WO-496 (500-line CI limit). Removal needs the DeckLink
 * release (WO-494), so both node handlers live together rather than being separated from it.
 */
'use strict'

const { normalizeDeviceGraph } = require('../config/device-graph')
const { releaseDecklinkOutputsForMappingNode } = require('./device-view-decklink-wiring')
const { saveConfig } = require('./device-view-crud-save')

function handleAddMappingNode(j, ctx) {
	const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph)
	const now = Date.now().toString(36)
	let seq = 1; while (g0.devices.some(d => d.id === `mapping_${now}_${seq}`)) seq++
	const id = `mapping_${now}_${seq}`
	const label = `Pixel Mapping ${seq}`
	
	const newDevice = {
		id,
		role: 'pixel_mapping',
		label,
		settings: {
			numOutputs: 2,
			outputs: [
				{ id: 'out_1', mode: '1080p5000', label: 'Output 1' },
				{ id: 'out_2', mode: '1080p5000', label: 'Output 2' }
			],
			mappings: []
		}
	}
	
	const newConnectors = [
		{ id: `${id}_in`, deviceId: id, kind: 'pixel_map_in', label: 'Input Feed' },
		{ id: `${id}_out_1`, deviceId: id, kind: 'pixel_map_out', index: 0, label: 'Output 1' },
		{ id: `${id}_out_2`, deviceId: id, kind: 'pixel_map_out', index: 1, label: 'Output 2' }
	]
	
	const next = {
		...g0,
		devices: [...g0.devices, newDevice],
		connectors: [...g0.connectors, ...newConnectors]
	}
	
	const norm = normalizeDeviceGraph(next)
	ctx.config.deviceGraph = norm
	saveConfig(ctx, { deviceGraph: norm })
	return { ok: true, graph: norm, addedId: id }
}

/**
 * WO-494: removing a pixel-mapping node.
 *
 * This used to have no handler at all — the client rewrote the graph and POSTed the whole thing,
 * landing in the generic `j.deviceGraph` branch which only persists. A whole-graph POST can never be
 * made safe: the server cannot tell a deletion from any other edit, so it cannot know a DeckLink
 * just lost its feed. Hence a dedicated handler, same shape as `handleRemoveDestination`.
 * @param {object} j
 * @param {object} ctx
 */
function handleRemoveMappingNode(j, ctx) {
	const id = String(j.removeMappingNode?.id || '').trim()
	if (!id) return { error: 'Missing id' }
	const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph)
	if (!(g0.devices || []).some((d) => String(d?.id || '') === id)) return { error: 'Not found', id }

	// Before pruning — it reads the edges the prune is about to drop.
	const released = releaseDecklinkOutputsForMappingNode(ctx, g0, id)
	const g = released.graph
	const dropIds = new Set(
		(g.connectors || []).filter((c) => String(c?.deviceId || '') === id).map((c) => String(c.id || '')),
	)
	const graph = normalizeDeviceGraph({
		...g,
		devices: (g.devices || []).filter((d) => String(d?.id || '') !== id),
		connectors: (g.connectors || []).filter((c) => !dropIds.has(String(c?.id || ''))),
		edges: (g.edges || []).filter(
			(e) => !dropIds.has(String(e?.sourceId || '')) && !dropIds.has(String(e?.sinkId || '')),
		),
	})
	ctx.config.deviceGraph = graph
	saveConfig(ctx, {
		deviceGraph: graph,
		...(released.casparServerChanged ? { casparServer: ctx.config.casparServer } : {}),
	})
	return { ok: true, graph, removedId: id, casparRestartNeeded: released.casparServerChanged }
}

module.exports = { handleAddMappingNode, handleRemoveMappingNode }
