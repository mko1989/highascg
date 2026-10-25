'use strict'

/**
 * WO-623 B (WO-598 thin client) — POST /api/scene/new-look { mainIdx, mainScope?, source? }
 *
 * Builds (does not store) the look the web creates for the deck "+" tile (client/components/scene-list-column.js →
 * sceneState.addScene) and for a media drop on blank deck space (scenes-editor-deck-drop.js: addScene, then addLayer +
 * setLayerSource + native fill per payload): scene-state.js addScene's object — migrateScene({ id: newId(),
 * name: `Look ${count + 1}`, layers: [], mainScope, defaultTransition: { ...defaultTransition(), ...global } }) — with
 * the dropped source as its first layer, built by the same code as POST /api/scene/new-layer. The client appends the
 * look and saves it like any edit (deck sync → autosave).
 *
 * `count` is the server's live deck (scene_deck_sync snapshots), else the stored project; the global default
 * transition is the stored project's `scenes.globalDefaultTransition`.
 *
 * WO-762 (owner 25.10): a look made from a dropped media file is named after the file, no folder, no extension
 * ("projects/show/KV LOOP.mp4" → "KV LOOP"); other sources and "+" keep `Look N+1`.
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { libs, buildLayerForSource } = require('./routes-scene-new-layer')

/** @param {{ type?: unknown, value?: unknown } | null} src */
function mediaLookName(src) {
	if (!src || String(src.type || '') !== 'media') return ''
	const file = String(src.value || '').split(/[\\/]/).pop() || ''
	return file.replace(/\.[A-Za-z0-9]{2,5}$/, '').trim()
}

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

/**
 * @param {unknown} body
 * @param {object} ctx
 * @param {object} [deps] tests: projectScenes() → envelope, plus buildLayerForSource's deps
 */
async function handleNewLook(body, ctx, deps = {}) {
	const b = parseBody(body)
	const src = b.source && typeof b.source === 'object' ? b.source : null
	if (src && !String(src.value || '').trim()) return out(400, { ok: false, error: 'source.value required' })
	if (src && String(src.type || '') === 'timer') return out(400, { ok: false, error: 'timers do not make a look (web deck drop rule)' })
	const mainIdx = Number.isFinite(Number(b.mainIdx)) ? Math.max(0, Math.floor(Number(b.mainIdx))) : 0
	const scopeIn = b.mainScope != null ? String(b.mainScope) : String(mainIdx)
	const mainScope = scopeIn === 'all' ? 'all' : /^[0-3]$/.test(scopeIn) ? scopeIn : '0'

	const env = deps.projectScenes ? deps.projectScenes() : require('../engine/project-scenes-load').loadProjectScenes()
	const snaps = ctx?.sceneDeck?.sceneSnapshots
	const count = Array.isArray(snaps) && snaps.length ? snaps.length : Array.isArray(env?.scenes) ? env.scenes.length : 0
	const global = env?.globalDefaultTransition && typeof env.globalDefaultTransition === 'object' ? env.globalDefaultTransition : {}

	const { helpers } = await libs()
	const look = helpers.migrateScene({
		id: helpers.newId(),
		name: mediaLookName(src) || `Look ${count + 1}`,
		layers: [],
		mainScope,
		defaultTransition: { ...helpers.defaultTransition(), ...global },
	})
	let contentResolution = null
	if (src) {
		const r = await buildLayerForSource(ctx, look, src, mainIdx, deps)
		if (r.error) return out(r.status, { ok: false, error: r.error })
		look.layers = [r.layer]
		contentResolution = r.contentResolution
	}
	return out(200, { ok: true, look, mainIdx, contentResolution })
}

module.exports = { handleNewLook, mediaLookName }
