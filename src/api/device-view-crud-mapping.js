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
const { reconcileNodeSettings } = require('../config/mapping-slices-model')
const { planMappingNode } = require('../config/mapping-slices-plan')
const { planConfigSignature } = require('../config/mapping-slices-windows')

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
			mappings: [],
			slices: [], // WO-869
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

/**
 * WO-869: `{ updateMappingSlices: { nodeId, slices, outputPos? } }` — the slice editor's save. Persists the node's
 * slices (+ the legacy `mappings[]` mirror for the web editor) and, when only slice geometry inside a slice window
 * changed, applies them live (`APPLY … SLICES SET`, no restart). `casparRestartNeeded` is true only when the
 * generated config changes: an output switching backend, a DeckLink placement / GPU head moving, the window raster.
 * `outputPos` ({outId: {x, y}}) moves outputs on the node's window canvas.
 * @param {object} j
 * @param {object} ctx
 */
async function handleUpdateMappingSlices(j, ctx) {
	const body = j.updateMappingSlices && typeof j.updateMappingSlices === 'object' ? j.updateMappingSlices : {}
	const id = String(body.nodeId || '').trim()
	if (!id) return { error: 'Missing nodeId' }
	if (!Array.isArray(body.slices)) return { error: 'slices must be an array' }
	const g0 = normalizeDeviceGraph(ctx.config?.deviceGraph)
	const node = (g0.devices || []).find((d) => String(d?.id || '') === id && d.role === 'pixel_mapping')
	if (!node) return { error: 'Not found', id }
	const prevPlan = planMappingNode(node, { graph: g0 })
	const pos = body.outputPos && typeof body.outputPos === 'object' ? body.outputPos : {}
	const outputs = (Array.isArray(node.settings?.outputs) ? node.settings.outputs : []).map((o) => {
		const p = pos[String(o?.id || '')]
		if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return o
		return { ...o, pos: { x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) } }
	})
	const settings = reconcileNodeSettings({ ...(node.settings || {}), outputs, slices: body.slices }, node.settings).settings
	const nextNode = { ...node, settings }
	const graph = normalizeDeviceGraph({ ...g0, devices: g0.devices.map((d) => (d === node ? nextNode : d)) })
	ctx.config.deviceGraph = graph
	saveConfig(ctx, { deviceGraph: graph })
	const plan = planMappingNode(nextNode, { graph })
	const casparRestartNeeded = planConfigSignature(prevPlan) !== planConfigSignature(plan)
	let live = { applied: false }
	if (!casparRestartNeeded && plan.window) {
		live = await require('../engine/mapping-slices-apply').applyMappingNodeSlices(ctx, id, ctx.config)
	}
	return { ok: true, graph, nodeId: id, slices: settings.slices, plan, casparRestartNeeded, live }
}

module.exports = { handleAddMappingNode, handleRemoveMappingNode, handleUpdateMappingSlices }
