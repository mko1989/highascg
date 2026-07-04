'use strict'

const { scheduleProjectSyncBroadcast } = require('./routes-data')
const { resolveSceneById, loadFullProject, persistProject } = require('../engine/project-scenes')

/**
 * Build/dispatch one inspector effect by type.
 * @param {import('../caspar/amcp-client').AmcpClient} amcp
 */
async function applyInspectorEffect(amcp, channel, layer, body) {
	const type = String(body?.effectType || body?.type || '').trim().toLowerCase()
	const p = body?.params && typeof body.params === 'object' ? body.params : {}
	const duration = body?.duration
	const tween = body?.tween
	const defer = body?.defer
	switch (type) {
		case 'blend_mode':
			return amcp.mixer.mixerBlend(channel, layer, p.mode)
		case 'brightness':
			return amcp.mixer.mixerBrightness(channel, layer, p.value, duration, tween, defer)
		case 'contrast':
			return amcp.mixer.mixerContrast(channel, layer, p.value, duration, tween, defer)
		case 'saturation':
			return amcp.mixer.mixerSaturation(channel, layer, p.value, duration, tween, defer)
		case 'levels':
			return amcp.mixer.mixerLevels(channel, layer, {
				minIn: p.minIn,
				maxIn: p.maxIn,
				gamma: p.gamma,
				minOut: p.minOut,
				maxOut: p.maxOut,
				duration,
				tween,
				defer,
			})
		case 'chroma_key':
			return amcp.mixer.mixerChroma(channel, layer, {
				key: p.key,
				threshold: p.threshold,
				softness: p.softness,
				spill: p.spill,
				blur: p.blur,
			})
		case 'crop':
			return amcp.mixer.mixerCrop(channel, layer, p.left, p.top, p.right, p.bottom, duration, tween, defer)
		case 'clip_mask':
			return amcp.mixer.mixerClip(channel, layer, p.left, p.top, p.width, p.height, duration, tween, defer)
		case 'perspective':
			return amcp.mixer.mixerPerspective(
				channel,
				layer,
				p.ulX,
				p.ulY,
				p.urX,
				p.urY,
				p.lrX,
				p.lrY,
				p.llX,
				p.llY,
				duration,
				tween,
				defer,
			)
		case 'grid':
			return amcp.mixer.mixerGrid(channel, layer, p.resolution, duration, tween, defer)
		case 'keyer':
			return amcp.mixer.mixerKeyer(channel, layer, p.enabled ? 1 : 0)
		case 'rotation':
			return amcp.mixer.mixerRotation(channel, layer, p.degrees, duration, tween, defer)
		case 'anchor':
			return amcp.mixer.mixerAnchor(channel, layer, p.x, p.y, duration, tween, defer)
		default:
			throw new Error(`Unknown inspector effectType: ${type || '(empty)'}`)
	}
}

const activeInteractionArCache = {}

function getCachedAr(lookId, layerIdx, currentAr) {
	const key = `${lookId}_${layerIdx}`
	const cached = activeInteractionArCache[key]
	if (cached) {
		clearTimeout(cached.timer)
		cached.timer = setTimeout(() => {
			delete activeInteractionArCache[key]
		}, 500)
		return cached.ar
	}

	const timer = setTimeout(() => {
		delete activeInteractionArCache[key]
	}, 500)
	activeInteractionArCache[key] = { ar: currentAr, timer }
	return currentAr
}

function updateProjectStateFromSelection(ctx, property, value) {
	const vars = ctx.state ? ctx.state.variables : ctx.variables || {}
	const context = vars['ui_selection_context']
	const lookId = vars['ui_selection_look_id']
	const layerIdxStr = vars['ui_selection_look_layer_index']

	if (context !== 'scene_layer' || !lookId || layerIdxStr === '') {
		return null
	}

	const layerIdx = parseInt(layerIdxStr, 10)
	const project = loadFullProject()
	if (!project || !project.scenes || !Array.isArray(project.scenes.scenes)) {
		return null
	}

	const scene = project.scenes.scenes.find((s) => s.id === lookId)
	if (!scene || !Array.isArray(scene.layers) || layerIdx >= scene.layers.length) {
		return null
	}

	const layer = scene.layers[layerIdx]
	if (!layer) return null

	const freshScene = resolveSceneById(lookId) || ctx.sceneDeck?.sceneSnapshots?.find((s) => s.id === lookId)
	const freshLayer = freshScene?.layers?.[layerIdx]
	const baseLayer = freshLayer || layer

	const updatedValues = {}

	if (typeof property === 'object') {
		if (!layer.fill) layer.fill = {}

		let updatedScaleX = false
		let updatedScaleY = false

		for (const [k, v] of Object.entries(property)) {
			if (v === undefined) continue

			const baseVal = baseLayer.fill?.[k] != null ? parseFloat(baseLayer.fill[k]) : k.startsWith('scale') ? 1 : 0

			if (typeof v === 'string' && (v.startsWith('+') || v.startsWith('-'))) {
				const diff = parseFloat(v)
				if (!isNaN(diff) && !isNaN(baseVal)) {
					layer.fill[k] = Math.round((baseVal + diff) * 1000000) / 1000000
					if (freshLayer) {
						if (!freshLayer.fill) freshLayer.fill = {}
						freshLayer.fill[k] = layer.fill[k]
					}
					if (k === 'scaleX') updatedScaleX = true
					if (k === 'scaleY') updatedScaleY = true
				}
			} else if (v != null) {
				const val = parseFloat(v)
				if (!isNaN(val)) {
					layer.fill[k] = Math.round(val * 1000000) / 1000000
					if (freshLayer) {
						if (!freshLayer.fill) freshLayer.fill = {}
						freshLayer.fill[k] = layer.fill[k]
					}
					if (k === 'scaleX') updatedScaleX = true
					if (k === 'scaleY') updatedScaleY = true
				}
			}
			updatedValues[k] = layer.fill[k]
		}

		if (baseLayer.aspectLocked !== false) {
			const oldScaleX = baseLayer.fill?.scaleX != null ? parseFloat(baseLayer.fill.scaleX) : 1
			const oldScaleY = baseLayer.fill?.scaleY != null ? parseFloat(baseLayer.fill.scaleY) : 1

			const currentAr = oldScaleX > 0 ? oldScaleY / oldScaleX : 1
			const ar = getCachedAr(lookId, layerIdx, currentAr)

			if (updatedScaleX) {
				const newScaleX = layer.fill.scaleX
				layer.fill.scaleY = Math.round(newScaleX * ar * 1000000) / 1000000
				updatedValues.scaleY = layer.fill.scaleY
				if (freshLayer?.fill) freshLayer.fill.scaleY = layer.fill.scaleY
			} else if (updatedScaleY) {
				const newScaleY = layer.fill.scaleY
				layer.fill.scaleX = Math.round(newScaleY / ar * 1000000) / 1000000
				updatedValues.scaleX = layer.fill.scaleX
				if (freshLayer?.fill) freshLayer.fill.scaleX = layer.fill.scaleX
			}
		}
	} else {
		const baseVal = baseLayer[property] != null ? parseFloat(baseLayer[property]) : 1
		if (typeof value === 'string' && (value.startsWith('+') || value.startsWith('-'))) {
			const diff = parseFloat(value)
			if (!isNaN(diff) && !isNaN(baseVal)) {
				layer[property] = Math.round((baseVal + diff) * 1000000) / 1000000
				if (freshLayer) freshLayer[property] = layer[property]
			}
		} else if (value != null) {
			const val = parseFloat(value)
			if (!isNaN(val)) {
				layer[property] = Math.round(val * 1000000) / 1000000
				if (freshLayer) freshLayer[property] = layer[property]
			}
		}
		updatedValues[property] = layer[property]
	}

	if (ctx._projectSaveTimer) clearTimeout(ctx._projectSaveTimer)
	ctx._projectSaveTimer = setTimeout(() => {
		ctx._projectSaveTimer = null
		project.savedAt = new Date().toISOString()
		void persistProject(ctx, project, { writeAutosave: true, pushVolumes: false }).catch((e) => {
			if (typeof ctx.log === 'function') {
				ctx.log('warn', '[mixer] project persist failed: ' + (e?.message || e))
			}
		})
	}, 1000)

	if (typeof ctx._wsBroadcast === 'function') {
		ctx._wsBroadcast('mixer_update', {
			lookId,
			layerIdx,
			updatedValues,
		})

		scheduleProjectSyncBroadcast(ctx, project)
	}

	return {
		channel: parseInt(vars['ui_selection_look_preview_channel'], 10) || 1,
		layer: parseInt(vars['ui_selection_look_caspar_layer'], 10) || 10,
		updatedValues,
	}
}

module.exports = {
	applyInspectorEffect,
	updateProjectStateFromSelection,
}
