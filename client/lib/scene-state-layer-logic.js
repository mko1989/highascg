/**
 * Layer logic for SceneState.
 */
import { defaultFill, defaultLayerConfig, newId } from './scene-state-helpers.js'
import { getPipOverlaysFromLayer } from './pip-overlay-registry.js'

export function getLayerStyleDataFromLayer(l) {
	return {
		fill: l.fill ? { ...l.fill } : undefined,
		opacity: l.opacity,
		rotation: l.rotation,
		loop: l.loop,
		loopAlways: l.loopAlways,
		audioRoute: l.audioRoute,
		volume: l.volume,
		muted: l.muted,
		straightAlpha: l.straightAlpha,
		contentFit: l.contentFit,
		aspectLocked: l.aspectLocked,
		startBehaviour: l.startBehaviour ?? 'inherit',
		effects: Array.isArray(l.effects) ? JSON.parse(JSON.stringify(l.effects)) : [],
		transition: l.transition ? { ...l.transition } : null,
		fadeOnEnd: l.fadeOnEnd ? { ...l.fadeOnEnd } : { enabled: false, frames: 12 },
		pipOverlays: getPipOverlaysFromLayer(l).map((o) => JSON.parse(JSON.stringify(o))),
	}
}

export function applyLayerStyleData(L, c) {
	if (c.fill) L.fill = { ...defaultFill(), ...c.fill }
	if (c.opacity != null) L.opacity = c.opacity
	if (c.rotation != null) L.rotation = c.rotation
	if (c.loop != null) L.loop = c.loop
	if (c.loopAlways != null) L.loopAlways = c.loopAlways
	if (c.audioRoute != null) L.audioRoute = c.audioRoute
	if (c.volume != null) L.volume = c.volume
	if (c.muted != null) L.muted = c.muted
	if (c.straightAlpha != null) L.straightAlpha = c.straightAlpha
	if (c.contentFit != null) L.contentFit = c.contentFit
	if (c.aspectLocked != null) L.aspectLocked = c.aspectLocked
	if (Array.isArray(c.effects)) L.effects = JSON.parse(JSON.stringify(c.effects))
	if ('startBehaviour' in c) {
		if (c.startBehaviour === null || c.startBehaviour === 'inherit') delete L.startBehaviour
		else L.startBehaviour = c.startBehaviour
	}
	L.transition = c.transition
	if (c.fadeOnEnd) L.fadeOnEnd = { ...c.fadeOnEnd }
	if (c.pipOverlays !== undefined) {
		L.pipOverlays = Array.isArray(c.pipOverlays) ? JSON.parse(JSON.stringify(c.pipOverlays)) : []
	} else if (c.pipOverlay && typeof c.pipOverlay === 'object' && c.pipOverlay.type) {
		L.pipOverlays = [JSON.parse(JSON.stringify(c.pipOverlay))]
	}
}

export function uniqueLayerPresetName(presets, baseName) {
	const base = String(baseName || '').trim() || 'Layer preset'
	const taken = new Set(presets.map((p) => String(p.name || '').trim().toLowerCase()))
	if (!taken.has(base.toLowerCase())) return base
	for (let n = 2; n < 1000; n++) {
		const candidate = `${base} (${n})`
		if (!taken.has(candidate.toLowerCase())) return candidate
	}
	return `${base} ${Date.now()}`
}

export function importLayerPresetsFromServer(presets, list) {
	if (!Array.isArray(list) || list.length === 0) return null
	const next = list
		.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.data && typeof p.data === 'object')
		.map((p) => ({ id: p.id, name: p.name, data: p.data }))
	return next.length > 0 ? next : null
}

export function reorderLayers(layers, fromVisualIndex, toVisualIndex, LOOK_LAYER_FIRST, LOOK_LAYER_STEP) {
	const sorted = [...layers].sort((a, b) => (a.layerNumber || 0) - (b.layerNumber || 0))
	const n = sorted.length
	if (fromVisualIndex < 0 || fromVisualIndex >= n) return null
	if (toVisualIndex < 0 || toVisualIndex >= n) return null
	if (fromVisualIndex === toVisualIndex) return null
	const [item] = sorted.splice(fromVisualIndex, 1)
	sorted.splice(toVisualIndex, 0, item)
	let ln = LOOK_LAYER_FIRST
	for (const layer of sorted) {
		layer.layerNumber = ln
		ln += LOOK_LAYER_STEP
	}
	return sorted
}

export function patchLayer(L, patch) {
	if (patch.fill) {
		const f = { ...L.fill, ...patch.fill }
		// Sanitize against Infinity/NaN which can happen on div-by-zero in drag handlers
		if (!Number.isFinite(f.x)) f.x = 0
		if (!Number.isFinite(f.y)) f.y = 0
		if (!Number.isFinite(f.scaleX)) f.scaleX = 1
		if (!Number.isFinite(f.scaleY)) f.scaleY = 1
		L.fill = f
	}
	if (patch.fadeOnEnd) L.fadeOnEnd = { ...(L.fadeOnEnd || { enabled: false, frames: 12 }), ...patch.fadeOnEnd }
	const { fill, fadeOnEnd, startBehaviour, ...rest } = patch
	Object.assign(L, rest)
	if ('startBehaviour' in patch) {
		if (startBehaviour === null || startBehaviour === 'inherit') delete L.startBehaviour
		else L.startBehaviour = startBehaviour
	}
}
