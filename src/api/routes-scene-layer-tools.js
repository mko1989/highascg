'use strict'

/**
 * WO-601 (Godot inspector, WO-598 thin client) — layer helpers computed with the web's own pure modules:
 *
 * POST /api/scene/layer-fit { sceneId, layerNumber, contentFit?, mainIdx? } → { fill }
 *   = web inspector-fill.js reapplyLayerFrameForContentFit (refit the layer for its content sizing on the
 *   look's main canvas). Nothing is stored; the client patches + saves like any edit.
 * GET /api/scene/layer-options?mainIdx= → { programLayout, audioRoutes, sourceChannelSets }
 *   = web inspector-mixer.js route choices: resolveProgramLayoutForMain(settings, channelMap, main) →
 *   audioOutputRoutesForLayout(layout), with `settings` = exactly the GET /api/settings payload.
 * GET /api/scene/effect-registry → { effects, categories, pipOverlays, pipMaxStack } = web effect-registry.js
 *   MIXER_EFFECTS (types, defaults, param schemas) + EFFECT_CATEGORIES, and pip-overlay-registry.js PIP_OVERLAYS +
 *   PIP_OVERLAY_MAX_STACK — the Godot effects / PIP editors render from these.
 * POST /api/scene/layer-reload { sceneId, layerNumber, mainIdx? } → CALL <ch>-<layer> RELOAD on PRV when this look
 *   is staged there and on PGM when it is live (web inspector-html-template.js "Reload page"), with the server's
 *   real layers: template CG host (resolveTemplateCgHostLayer), HTML producer = look layer (+100 on PGM bank B).
 */

const path = require('path')
const { pathToFileURL } = require('url')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { REPO_ROOT } = require('../repo-paths')
const { fitFillForSource } = require('./routes-scene-new-layer')

/** inspector-mixer.js route-source channel sets (WO-…: route sources pick which source channels). */
const SOURCE_CHANNEL_SETS = ['all', '1+2', '3+4', '5+6', '7+8']

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

async function handleLayerFit(body, ctx, deps = {}) {
	const b = parseBody(body)
	const sceneId = String(b.sceneId || '').trim()
	const ln = Number(b.layerNumber)
	if (!sceneId || !Number.isFinite(ln)) return out(400, { ok: false, error: 'sceneId and layerNumber required' })
	const scene = deps.resolveScene ? deps.resolveScene(sceneId) : require('../engine/project-scenes-transform').resolveLiveSceneById(ctx, sceneId)
	if (!scene) return out(404, { ok: false, error: `look ${sceneId} not found` })
	const layer = (scene.layers || []).find((l) => Number(l?.layerNumber) === ln)
	if (!layer?.source?.value) return out(404, { ok: false, error: `layer ${ln} has no source` })
	const map = deps.getChannelMap ? deps.getChannelMap() : require('../config/routing').getChannelMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel) || {}
	const scope = parseInt(String(scene.mainScope ?? ''), 10)
	const mainIdx = Number.isFinite(Number(b.mainIdx)) ? Math.max(0, Math.floor(Number(b.mainIdx))) : Number.isFinite(scope) ? scope : 0
	const res = map.programResolutions?.[mainIdx] || map.programResolutions?.[0] || {}
	const canvas = { width: Number(res.w) > 0 ? Number(res.w) : 1920, height: Number(res.h) > 0 ? Number(res.h) : 1080 }
	const fit = await fitFillForSource(ctx, layer.source, b.contentFit || layer.contentFit || 'native', canvas, deps.mediaResolution)
	if (!fit.fill) return out(200, { ok: false, reason: 'resolution_unknown', fill: null })
	return out(200, { ok: true, fill: fit.fill, contentResolution: fit.contentResolution, mainIdx })
}

async function handleLayerOptions(query, ctx, deps = {}) {
	const mainIdx = Math.max(0, parseInt(String(query?.mainIdx ?? '0'), 10) || 0)
	let settings = deps.settings
	if (!settings) {
		const r = await require('./routes-settings').handleGet('/api/settings', ctx)
		settings = typeof r?.body === 'string' ? JSON.parse(r.body) : r?.body || {}
	}
	const load = (n) => import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', n)).href)
	const [layouts, routes] = await Promise.all([load('program-audio-layouts.js'), load('audio-routes.js')])
	const programLayout = layouts.resolveProgramLayoutForMain(settings, settings.channelMap || {}, mainIdx)
	return out(200, { ok: true, mainIdx, programLayout, audioRoutes: routes.audioOutputRoutesForLayout(programLayout), sourceChannelSets: SOURCE_CHANNEL_SETS })
}

async function handleEffectRegistry() {
	const load = (n) => import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', n)).href)
	const [reg, pip] = await Promise.all([load('effect-registry.js'), load('pip-overlay-registry.js')])
	return out(200, { ok: true, effects: reg.MIXER_EFFECTS, categories: reg.EFFECT_CATEGORIES, pipOverlays: pip.PIP_OVERLAYS, pipMaxStack: pip.PIP_OVERLAY_MAX_STACK })
}

async function handleLayerReload(body, ctx, deps = {}) {
	const b = parseBody(body)
	const sceneId = String(b.sceneId || '').trim()
	const ln = Number(b.layerNumber)
	if (!sceneId || !Number.isFinite(ln)) return out(400, { ok: false, error: 'sceneId and layerNumber required' })
	const scene = deps.resolveScene ? deps.resolveScene(sceneId) : require('../engine/project-scenes-transform').resolveLiveSceneById(ctx, sceneId)
	const layer = (scene?.layers || []).find((l) => Number(l?.layerNumber) === ln)
	if (!layer?.source?.value) return out(404, { ok: false, error: `layer ${ln} has no source` })
	const map = deps.getChannelMap ? deps.getChannelMap() : require('../config/routing').getChannelMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel) || {}
	const scope = parseInt(String(scene.mainScope ?? ''), 10)
	const mainIdx = Number.isFinite(Number(b.mainIdx)) ? Math.max(0, Math.floor(Number(b.mainIdx))) : Number.isFinite(scope) ? scope : 0
	const getStaged = deps.getStaged || ((ch) => require('../state/live-scene-state').getChannel(ch))
	const { resolveTemplateCgHostLayer } = require('../engine/cg-routing')
	const { PGM_BANK_B_OFFSET } = require('../engine/look-layer-ranges')
	const isTemplate = String(layer.source.type || '') === 'template'
	const targets = []
	for (const [ch, pgm] of [[Number(map.previewChannels?.[mainIdx]), false], [Number(map.programChannels?.[mainIdx]), true]]) {
		if (!(ch > 0) || targets.some((t) => t.ch === ch) || String(getStaged(ch)?.sceneId || '') !== sceneId) continue
		const bankB = pgm && String(ctx?.programLayerBankByChannel?.[String(ch)] || 'a').toLowerCase() === 'b'
		const phys = isTemplate ? resolveTemplateCgHostLayer(ln, String(layer.source.value)) : ln + (bankB ? PGM_BANK_B_OFFSET : 0)
		targets.push({ ch, layer: phys })
	}
	const raw = deps.raw || ((line) => ctx.amcp.raw(line))
	const lines = targets.map((t) => `CALL ${t.ch}-${t.layer} RELOAD`)
	for (const line of lines) {
		try {
			await raw(line)
		} catch (e) {
			ctx?.log?.('warn', `[layer-reload] ${line}: ${e?.message || e}`)
		}
	}
	return out(200, { ok: true, lines })
}

module.exports = { handleLayerFit, handleLayerOptions, handleEffectRegistry, handleLayerReload, SOURCE_CHANNEL_SETS }
