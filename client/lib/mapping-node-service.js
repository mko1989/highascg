/**
 * Single source of truth for pixel_mapping device graph mutations (WO-41).
 */
import { api } from './api-client.js'

/** Common Caspar video-mode IDs for mapping output dropdowns */
export const MAPPING_OUTPUT_VIDEO_MODES = [
	'1080p5000',
	'1080p5994',
	'1080p6000',
	'1080p2500',
	'1080p2997',
	'1080p3000',
	'2160p5000',
	'2160p2500',
	'720p5000',
	'576p2500',
	'PAL',
	'NTSC',
]

/** Resolve resolution from mode string (standard Caspar id or custom `3456x1152p50`). */
export function parseCustomVideoMode(mode) {
	const m = String(mode || '').trim()
	const match = m.match(/^(\d{2,5})x(\d{2,5})p([\d.]+)$/i)
	if (match) {
		return {
			width: Math.max(1, parseInt(match[1], 10) || 1),
			height: Math.max(1, parseInt(match[2], 10) || 1),
			fps: Math.max(1, parseFloat(match[3]) || 50),
			isCustom: true,
		}
	}
	return null
}

export function formatCustomVideoMode(width, height, fps) {
	const w = Math.max(1, parseInt(String(width), 10) || 1)
	const h = Math.max(1, parseInt(String(height), 10) || 1)
	const f = Math.max(1, parseFloat(String(fps)) || 50)
	const fpsStr = Number.isInteger(f) ? String(f) : String(f)
	return `${w}x${h}p${fpsStr}`
}

/** @param {object | null | undefined} output */
export function resolveMappingOutputResolution(output) {
	const mode = String(output?.mode || '1080p5000').trim() || '1080p5000'
	const custom = parseCustomVideoMode(mode)
	if (custom) {
		return {
			mode,
			width: Number.isFinite(Number(output?.width)) ? Number(output.width) : custom.width,
			height: Number.isFinite(Number(output?.height)) ? Number(output.height) : custom.height,
			fps: Number.isFinite(Number(output?.fps)) ? Number(output.fps) : custom.fps,
			isCustom: true,
		}
	}
	if (Number.isFinite(Number(output?.width)) && Number.isFinite(Number(output?.height))) {
		return {
			mode,
			width: Number(output.width),
			height: Number(output.height),
			fps: Number.isFinite(Number(output?.fps)) ? Number(output.fps) : 50,
			isCustom: !MAPPING_OUTPUT_VIDEO_MODES.includes(mode),
		}
	}
	const res = videoModeToResolution(mode)
	return { mode, width: res.w, height: res.h, fps: res.fps ?? 50, isCustom: false }
}

export function videoModeToResolution(mode) {
	const custom = parseCustomVideoMode(mode)
	if (custom) return { w: custom.width, h: custom.height, fps: custom.fps }
	const m = String(mode || '').toLowerCase()
	if (m.startsWith('1080')) return { w: 1920, h: 1080, fps: 50 }
	if (m.startsWith('2160')) return { w: 3840, h: 2160, fps: 50 }
	if (m.startsWith('720')) return { w: 1280, h: 720, fps: 50 }
	if (m === 'pal') return { w: 720, h: 576, fps: 25 }
	if (m === 'ntsc') return { w: 720, h: 486, fps: 29.97 }
	return { w: 1920, h: 1080, fps: 50 }
}

/**
 * Split input canvas horizontally across N mapping outputs.
 * @param {number} inputWidth
 * @param {number} inputHeight
 * @param {number} fps
 * @param {number} numOutputs
 */
export function proposeMappingOutputLayout(inputWidth, inputHeight, fps, numOutputs) {
	const inW = Math.max(1, parseInt(String(inputWidth), 10) || 1)
	const inH = Math.max(1, parseInt(String(inputHeight), 10) || 1)
	const rate = Math.max(1, parseFloat(String(fps)) || 50)
	const n = Math.max(1, parseInt(String(numOutputs), 10) || 1)
	const baseW = Math.floor(inW / n)
	const out = []
	let x = 0
	for (let i = 0; i < n; i++) {
		const w = i === n - 1 ? inW - x : baseW
		out.push({
			label: `Output ${i + 1}`,
			width: w,
			height: inH,
			fps: rate,
			mode: formatCustomVideoMode(w, inH, rate),
			rect: { x, y: 0, w, h: inH },
		})
		x += w
	}
	return out
}

export async function fetchDeviceView() {
	return api.get('/api/device-view')
}

export async function saveDeviceGraph(graph) {
	return api.post('/api/device-view', { deviceGraph: graph })
}

export function findMappingNode(graph, nodeId) {
	return (graph?.devices || []).find((d) => d.id === nodeId && d.role === 'pixel_mapping') || null
}

/** Connector IDs for this node's pixel_map_out connectors (before mutation). */
export function collectPixelMapOutConnectorIds(graph, nodeId) {
	return new Set(
		(graph?.connectors || [])
			.filter((c) => String(c?.deviceId || '') === nodeId && c.kind === 'pixel_map_out')
			.map((c) => String(c.id || ''))
	)
}

/**
 * Rebuild pixel_map_out connectors from node.settings.outputs (left-to-right order = array index).
 */
export function syncPixelMapOutputConnectors(graph, nodeId) {
	const node = findMappingNode(graph, nodeId)
	if (!node) return false
	const outputs = Array.isArray(node.settings?.outputs) ? node.settings.outputs : []
	node.settings = { ...(node.settings || {}), outputs, numOutputs: outputs.length }
	const connectors = Array.isArray(graph.connectors) ? graph.connectors : []
	const kept = connectors.filter((c) => !(String(c?.deviceId || '') === nodeId && c.kind === 'pixel_map_out'))
	const built = outputs.map((o, i) => ({
		id: `${nodeId}_${o.id}`,
		deviceId: nodeId,
		kind: 'pixel_map_out',
		index: i,
		label: String(o.label || `Output ${i + 1}`),
	}))
	graph.connectors = [...kept, ...built]
	return true
}

export function pruneEdgesForRemovedMappingOutputs(graph, nodeId, previousOutConnectorIds) {
	const nextIds = new Set(
		(graph?.connectors || [])
			.filter((c) => String(c?.deviceId || '') === nodeId && c.kind === 'pixel_map_out')
			.map((c) => String(c.id || ''))
	)
	graph.edges = (graph.edges || []).filter((e) => {
		const s = String(e?.sourceId || '')
		const t = String(e?.sinkId || '')
		if (previousOutConnectorIds.has(s) && !nextIds.has(s)) return false
		if (previousOutConnectorIds.has(t) && !nextIds.has(t)) return false
		return true
	})
}

export async function renameMappingNode(nodeId, label) {
	const trimmed = String(label || '').trim()
	if (!trimmed) return { ok: false, error: 'Empty label' }
	try {
		const payload = await fetchDeviceView()
		const graph = payload?.graph
		if (!graph) return { ok: false, error: 'No graph' }
		const node = findMappingNode(graph, nodeId)
		if (!node) return { ok: false, error: 'Node not found' }
		node.label = trimmed
		await saveDeviceGraph(graph)
		return { ok: true, graph }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

export async function duplicateMappingNode(nodeId) {
	try {
		const payload = await fetchDeviceView()
		const graph = payload?.graph
		if (!graph) return { ok: false, error: 'No graph' }
		const devices = Array.isArray(graph.devices) ? graph.devices : []
		const connectors = Array.isArray(graph.connectors) ? graph.connectors : []
		const edges = Array.isArray(graph.edges) ? graph.edges : []
		const srcNode = findMappingNode(graph, nodeId)
		if (!srcNode) return { ok: false, error: 'Node not found' }

		const now = Date.now().toString(36)
		let seq = 1
		let newId = `mapping_${now}_${seq}`
		while (devices.some((d) => d.id === newId)) {
			seq += 1
			newId = `mapping_${now}_${seq}`
		}

		const defaultMode = MAPPING_OUTPUT_VIDEO_MODES[0]
		const outputDefs = Array.isArray(srcNode.settings?.outputs) && srcNode.settings.outputs.length
			? srcNode.settings.outputs.map((o, i) => ({
				id: `out_${i + 1}`,
				mode: String(o?.mode || defaultMode),
				label: String(o?.label || `Output ${i + 1}`),
			}))
			: [{ id: 'out_1', mode: defaultMode, label: 'Output 1' }]

		const newNode = {
			...JSON.parse(JSON.stringify(srcNode)),
			id: newId,
			label: `${String(srcNode.label || 'Pixel Mapping')} Copy`,
			settings: {
				...(srcNode.settings || {}),
				numOutputs: outputDefs.length,
				outputs: outputDefs,
				mappings: Array.isArray(srcNode.settings?.mappings)
					? srcNode.settings.mappings.map((m) => ({
						...JSON.parse(JSON.stringify(m)),
						id: `map_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
					}))
					: [],
			},
		}

		const newConnectors = [
			{ id: `${newId}_in`, deviceId: newId, kind: 'pixel_map_in', label: 'Input Feed' },
			...outputDefs.map((o, i) => ({
				id: `${newId}_${o.id}`,
				deviceId: newId,
				kind: 'pixel_map_out',
				index: i,
				label: o.label || `Output ${i + 1}`,
			})),
		]

		const next = {
			...graph,
			devices: [...devices, newNode],
			connectors: [...connectors, ...newConnectors],
			edges,
		}
		await saveDeviceGraph(next)
		return { ok: true, newId, graph: next }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

export async function deleteMappingNode(nodeId) {
	try {
		const payload = await fetchDeviceView()
		const graph = payload?.graph
		if (!graph) return { ok: false, error: 'No graph' }
		const removeConnectorIds = new Set(
			(graph.connectors || [])
				.filter((c) => String(c?.deviceId || '') === nodeId)
				.map((c) => String(c.id || ''))
		)
		const next = {
			...graph,
			devices: (graph.devices || []).filter((d) => String(d?.id || '') !== nodeId),
			connectors: (graph.connectors || []).filter((c) => !removeConnectorIds.has(String(c?.id || ''))),
			edges: (graph.edges || []).filter(
				(e) => !removeConnectorIds.has(String(e?.sourceId || '')) && !removeConnectorIds.has(String(e?.sinkId || ''))
			),
		}
		await saveDeviceGraph(next)
		return { ok: true, graph: next }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

export async function addMappingOutput(nodeId) {
	try {
		const payload = await fetchDeviceView()
		const graph = payload?.graph
		if (!graph) return { ok: false, error: 'No graph' }
		const node = findMappingNode(graph, nodeId)
		if (!node) return { ok: false, error: 'Node not found' }
		const outputs = Array.isArray(node.settings?.outputs) ? [...node.settings.outputs] : []
		const nextIdx = outputs.length + 1
		const outputId = `out_${nextIdx}`
		outputs.push({ id: outputId, mode: MAPPING_OUTPUT_VIDEO_MODES[0], label: `Output ${nextIdx}` })
		node.settings = { ...(node.settings || {}), outputs, numOutputs: outputs.length }
		syncPixelMapOutputConnectors(graph, nodeId)
		await saveDeviceGraph(graph)
		return { ok: true, graph }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

export async function removeMappingOutput(nodeId, outputId) {
	try {
		const payload = await fetchDeviceView()
		const graph = payload?.graph
		if (!graph) return { ok: false, error: 'No graph' }
		const node = findMappingNode(graph, nodeId)
		if (!node) return { ok: false, error: 'Node not found' }
		const outputs = Array.isArray(node.settings?.outputs) ? node.settings.outputs : []
		if (outputs.length <= 1) return { ok: false, error: 'At least one output required' }

		const prevIds = collectPixelMapOutConnectorIds(graph, nodeId)
		const nextOutputs = outputs.filter((o) => String(o?.id || '') !== String(outputId))
		const firstId = nextOutputs[0]?.id || 'out_1'
		node.settings = {
			...(node.settings || {}),
			outputs: nextOutputs,
			numOutputs: nextOutputs.length,
			mappings: (Array.isArray(node.settings?.mappings) ? node.settings.mappings : []).map((m) =>
				String(m?.outputId || '') === String(outputId) ? { ...m, outputId: firstId } : m
			),
		}
		syncPixelMapOutputConnectors(graph, nodeId)
		pruneEdgesForRemovedMappingOutputs(graph, nodeId, prevIds)
		await saveDeviceGraph(graph)
		return { ok: true, graph }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

export async function updateMappingOutputFields(nodeId, outputId, patch) {
	try {
		const payload = await fetchDeviceView()
		const graph = payload?.graph
		if (!graph) return { ok: false, error: 'No graph' }
		const node = findMappingNode(graph, nodeId)
		if (!node) return { ok: false, error: 'Node not found' }
		const outputs = Array.isArray(node.settings?.outputs) ? node.settings.outputs : []
		const idx = outputs.findIndex((o) => String(o?.id || '') === String(outputId))
		if (idx < 0) return { ok: false, error: 'Output not found' }
		const cur = outputs[idx]
		if (patch.label != null) cur.label = String(patch.label).trim() || cur.label
		if (patch.mode != null) cur.mode = String(patch.mode).trim() || cur.mode
		if (patch.width != null) cur.width = Math.max(1, parseInt(String(patch.width), 10) || 1)
		if (patch.height != null) cur.height = Math.max(1, parseInt(String(patch.height), 10) || 1)
		if (patch.fps != null) cur.fps = Math.max(1, parseFloat(String(patch.fps)) || 50)
		outputs[idx] = cur
		node.settings = { ...(node.settings || {}), outputs }
		syncPixelMapOutputConnectors(graph, nodeId)
		await saveDeviceGraph(graph)
		return { ok: true, graph }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

/**
 * Fill output modes + source slice rects from input resolution ÷ output count.
 * @param {string} nodeId
 * @param {{ width: number, height: number, fps?: number }} input
 */
export async function proposeMappingOutputsFromInput(nodeId, input) {
	try {
		const payload = await fetchDeviceView()
		const graph = payload?.graph
		if (!graph) return { ok: false, error: 'No graph' }
		const node = findMappingNode(graph, nodeId)
		if (!node) return { ok: false, error: 'Node not found' }
		const outputs = Array.isArray(node.settings?.outputs) ? node.settings.outputs : []
		if (!outputs.length) return { ok: false, error: 'No outputs on node' }
		const inW = Math.max(1, parseInt(String(input?.width), 10) || 1)
		const inH = Math.max(1, parseInt(String(input?.height), 10) || 1)
		const fps = Math.max(1, parseFloat(String(input?.fps ?? 50)) || 50)
		const proposed = proposeMappingOutputLayout(inW, inH, fps, outputs.length)
		const mappings = []
		for (let i = 0; i < outputs.length; i++) {
			const out = outputs[i]
			const p = proposed[i]
			if (!p) continue
			out.mode = p.mode
			out.width = p.width
			out.height = p.height
			out.fps = p.fps
			if (!out.label) out.label = p.label
			mappings.push({
				id: `map_${out.id}`,
				type: 'video_slice',
				label: out.label || p.label,
				outputId: out.id,
				rotation: 0,
				rect: { ...p.rect },
			})
		}
		node.settings = {
			...(node.settings || {}),
			outputs,
			mappings,
			numOutputs: outputs.length,
		}
		syncPixelMapOutputConnectors(graph, nodeId)
		await saveDeviceGraph(graph)
		return { ok: true, graph, proposed }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}
