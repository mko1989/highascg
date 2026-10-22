'use strict'

/**
 * WO-601 lower-third inspector (Godot thin client) — POST /api/scene/lower-third
 * { sceneId, layerNumber, action, config?, mainIdx? }, computed with the web's own lower-third-cg-data.js:
 *
 * - resolve → { config, templateId, templateName, fonts, debounceMs } (resolveLayerLowerThirdConfig of the look layer)
 * - update  { config } → CG UPDATE through /api/lower-thirds/update (no-op until the LT was loaded, as on the web)
 * - play    { config } → web runPlayAction: playing on this layer → stop; loaded → update + play; else load + update + play
 * - clear   → /api/lower-thirds/clear
 *
 * Routing = the web inspector's: the look's edit bus (PRV of its main, PGM when the main has no PRV), logical
 * layer = the look layer, templateHostLayer 1. "Already on this layer" compares the LT state of THAT channel by
 * LOGICAL layer — the web compared GET /active (channel-less → channel 1's state) against the host layer (700+),
 * so its Play never animated out (WO-601 side finding).
 */

const path = require('path')
const { pathToFileURL } = require('url')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { REPO_ROOT } = require('../repo-paths')
const { studioLtDefaults } = require('../cg-studio/studio-lt-defaults')

let _lib = null
async function ltLib() {
	if (!_lib) _lib = await import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', 'lower-third-cg-data.js')).href)
	return _lib
}

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

/** Edit bus of the look's main: PRV when it exists and differs from PGM, else PGM. */
function editBusChannel(map, mainIdx) {
	const pgm = Number(map.programChannels?.[mainIdx] ?? map.playbackChannels?.[mainIdx])
	const prv = Number(map.previewChannels?.[mainIdx])
	if (Number.isFinite(prv) && prv > 0 && prv !== pgm) return prv
	return Number.isFinite(pgm) && pgm > 0 ? pgm : null
}

async function handleSceneLowerThird(body, ctx, deps = {}) {
	const b = parseBody(body)
	const sceneId = String(b.sceneId || '').trim()
	const ln = Number(b.layerNumber)
	const action = String(b.action || '')
	if (!sceneId || !Number.isFinite(ln)) return out(400, { ok: false, error: 'sceneId and layerNumber required' })
	const scene = deps.resolveScene ? deps.resolveScene(sceneId) : require('../engine/project-scenes-transform').resolveLiveSceneById(ctx, sceneId)
	if (!scene) return out(404, { ok: false, error: `look ${sceneId} not found` })
	const layer = (scene.layers || []).find((l) => Number(l?.layerNumber) === ln)
	const lib = await ltLib()
	if (!layer || !lib.isLowerThirdSource(layer.source)) return out(404, { ok: false, error: `layer ${ln} is not a lower third` })
	const templateId = lib.deriveTemplateId(layer.source.value)
	// WO-663: a studio export with no operator config opens and plays with its baked text + look
	const studio = lib.isStudioLowerThirdSource(layer.source) ? (deps.studioLtDefaults || studioLtDefaults)(templateId) : null
	const stored = lib.resolveLayerLowerThirdConfig(layer) || (studio ? { ...lib.DEFAULT_LOWER_THIRD_CONFIG, ...studio } : null)

	if (action === 'resolve') {
		const lt = deps.lowerThirds || require('./routes-lower-thirds')
		const tr = lt.handleGet('/api/lower-thirds/templates', ctx)
		const templates = JSON.parse(tr?.body || '{}').templates || []
		const found = templates.find((t) => t.id === templateId)
		return out(200, {
			ok: true,
			config: stored,
			templateId,
			templateName: found ? found.name : templateId || '(none)',
			fonts: lib.LOWER_THIRD_FONT_OPTIONS.map((f) => ({ id: f.id, label: f.label })),
			debounceMs: lib.LOWER_THIRD_CG_UPDATE_DEBOUNCE_MS,
		})
	}

	const getMap = deps.getChannelMap || require('../config/routing').getChannelMap
	const map = getMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel) || {}
	const scope = parseInt(String(scene.mainScope ?? ''), 10)
	const mainIdx = Number.isFinite(Number(b.mainIdx)) ? Math.max(0, Math.floor(Number(b.mainIdx))) : Number.isFinite(scope) ? scope : 0
	const channel = editBusChannel(map, mainIdx)
	if (!channel) return out(200, { ok: false, reason: 'no_channel', mainIdx })
	const routing = { channel, layer: ln, templateHostLayer: 1 }
	const config = { ...lib.DEFAULT_LOWER_THIRD_CONFIG, ...(b.config && typeof b.config === 'object' ? b.config : stored) }
	const payload = lib.buildLowerThirdApiPayload(config, routing)
	const post = deps.post || ((p, pb) => require('./routes-lower-thirds').handlePost(p, pb, ctx))
	const sent = []
	const call = async (p, pb) => {
		sent.push(p.split('/').pop())
		await post(`/api/lower-thirds/${p}`, pb)
	}

	if (action === 'update') await call('update', payload)
	else if (action === 'clear') await call('clear', routing)
	else if (action === 'play') {
		const st = (deps.ltState || ctx?._lowerThirdByChannel || {})[String(channel)]
		const here = st && Number(st.logicalLayer) === ln
		if (here && st.playing) await call('stop', routing)
		else {
			if (!(here && st.templateId)) await call('load', { templateId, ...payload })
			await call('update', payload)
			await call('play', payload)
		}
	} else return out(400, { ok: false, error: `unknown action ${action}` })
	return out(200, { ok: true, action, channel, sent })
}

module.exports = { handleSceneLowerThird, editBusChannel }
