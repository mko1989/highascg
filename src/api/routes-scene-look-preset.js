'use strict'

/**
 * WO-601 — POST /api/scene/look-preset/recall { id, target?: 'preview'|'program', forceCut?, useGlobalTransition? }
 *
 * Recall a look preset (a named screen → look bookmark, `scenes.lookPresets`, client-owned like the rest of the deck):
 * every item goes through the take-look path for its own screen, all at once (WO-150 B150.6: screens take together,
 * not one after another's transition). `useGlobalTransition` (program, not a cut) replaces each look's own transition
 * with the deck default, as the web preset card's "Take (global)" does (B150.5). Web: scenes-editor-logic.js
 * runLookRecall. Saving / overwriting / deleting a preset is a deck edit and travels with the deck sync.
 */

const path = require('path')
const { pathToFileURL } = require('url')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

const REPO_ROOT = path.join(__dirname, '..', '..')

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

/**
 * Pure (web lookRecallItemsFromPreset): the preset's { mainIdx, sceneId } items whose look still exists; a legacy
 * single-look preset ({ sceneId, targetMain }) is one item. Mains clamp to 0–3 like the web. WO-781: a destination
 * saved while empty ({ mainIdx, empty: true }) stays an item — recall leaves it empty again (E2 preset semantics).
 * @param {object} preset
 * @param {(id: string) => boolean} exists
 */
function recallItems(preset, exists) {
	const main = (v) => {
		const m = Number(v)
		return Number.isFinite(m) && m >= 0 && m <= 3 ? Math.floor(m) : 0
	}
	const items = []
	for (const it of Array.isArray(preset?.items) ? preset.items : []) {
		const sid = String(it?.sceneId || '').trim()
		if (sid && exists(sid)) items.push({ mainIdx: main(it.mainIdx), sceneId: sid })
		else if (!sid && it?.empty === true) items.push({ mainIdx: main(it.mainIdx), sceneId: '', empty: true })
	}
	if (items.length) return items
	const sid = String(preset?.sceneId || '').trim()
	return sid && exists(sid) ? [{ mainIdx: main(preset.targetMain), sceneId: sid }] : []
}

/** The deck default transition with its duration resolved at screen 1's fps (web getResolvedGlobalDefaultTransition). */
async function globalTransition(scenes, fps) {
	const t = scenes?.globalDefaultTransition && typeof scenes.globalDefaultTransition === 'object' ? scenes.globalDefaultTransition : {}
	const td = await import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', 'transition-duration.js')).href)
	return { type: 'MIX', tween: 'linear', ...t, duration: td.resolveTransitionDuration(t.duration, fps) }
}

/**
 * @param {unknown} body
 * @param {object} ctx
 * @param {{ project?: () => object, takeLook?: Function, resolveSceneById?: Function, fps?: number }} [deps]
 */
async function handleLookPresetRecall(body, ctx, deps = {}) {
	const b = parseBody(body) || {}
	const id = String(b.id || '').trim()
	if (!id) return out(400, { ok: false, error: 'id required' })
	const project = deps.project ? deps.project() : require('../engine/project-scenes').loadFullProject()
	const scenes = project?.scenes && typeof project.scenes === 'object' ? project.scenes : {}
	// The live deck (scene_deck_sync) is newer than the autosave; fall back to the stored project.
	const list = Array.isArray(ctx?.sceneDeck?.lookPresets) ? ctx.sceneDeck.lookPresets : scenes.lookPresets || []
	const preset = list.find((p) => p && String(p.id) === id)
	if (!preset) return out(404, { ok: false, error: `look preset ${id} not found` })
	const resolve = deps.resolveSceneById || ((sid) => require('../engine/project-scenes-transform').resolveLiveSceneById(ctx, sid))
	const items = recallItems(preset, (sid) => !!resolve(sid))
	if (!items.length) return out(409, { ok: false, error: `look preset "${preset.name || id}" has no look left` })

	const target = b.target === 'program' ? 'program' : 'preview'
	const forceCut = target === 'program' && b.forceCut === true
	let transitionOverride = null
	if (target === 'program' && !forceCut && b.useGlobalTransition === true) {
		const fps = deps.fps ?? require('../engine/scene-take-payload').withProgramResolutions(require('../config/routing').getChannelMap(ctx?.config || {}) || {}, ctx)?.programResolutions?.[0]?.fps ?? 50
		transitionOverride = await globalTransition(scenes, fps)
	}
	const takeLook = deps.takeLook || ((tb) => require('./routes-scene-take-look').handleTakeLook(tb, ctx))
	const clearDest = deps.clearDestination || ((m, t, cut) => clearDestination(ctx, m, t, cut))
	const results = await Promise.all(
		items.map(async (it) => {
			const res = it.empty
				? await clearDest(it.mainIdx, target, forceCut)
				: await takeLook({ sceneId: it.sceneId, mainIdx: it.mainIdx, target, forceCut, ...(transitionOverride ? { transitionOverride } : {}) })
			let err = null
			if (res?.status >= 400) {
				try {
					err = JSON.parse(res.body)?.error || `HTTP ${res.status}`
				} catch {
					err = `HTTP ${res.status}`
				}
			}
			return { ...it, status: res?.status ?? 0, error: err }
		}),
	)
	const failed = results.filter((r) => r.error)
	return out(failed.length === results.length ? 502 : 200, { ok: failed.length === 0, target, items: results })
}

/**
 * WO-781: an empty destination of the preset — PRV recall clears that screen's PRV (the deck's blank click), PGM
 * recall fades it to black like the deck's FTB (0.5 s at the screen's fps; a cut is 0 frames).
 */
async function clearDestination(ctx, mainIdx, target, cut) {
	if (target === 'preview') return require('./routes-scene').handlePreviewLiveClear({ mainIndex: mainIdx }, ctx)
	const map = require('../engine/scene-take-payload').withProgramResolutions(require('../config/routing').getChannelMap(ctx?.config || {}) || {}, ctx)
	const fps = map?.programResolutions?.[mainIdx]?.fps ?? 50
	return require('./routes-ftb').handlePost('/api/ftb', { screenIdx: mainIdx, durationFrames: cut ? 0 : Math.round(0.5 * fps), framerate: fps }, ctx)
}

module.exports = { handleLookPresetRecall, recallItems }
