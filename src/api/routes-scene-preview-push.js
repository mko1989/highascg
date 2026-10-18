'use strict'

/**
 * WO-598 C2 — POST /api/scene/preview-push { sceneId, mainIdx? }
 *
 * Re-push a stored look that is being EDITED onto its main's PRV bus, by id. The server owns the decision
 * the web editor makes in the browser today (components/scenes-preview-runtime.js → pushSceneToPreviewImpl):
 *   - the look is already staged on PRV and only geometry / opacity / rotation / crop changed
 *     (client/lib/scenes-preview-snapshot.js isGeometryOnlyPreview — the web's own rule, imported) →
 *     MIXER-only via the existing /api/preview/mixer-nudge handler (same fill math as the take pipeline,
 *     staleness-guarded, queued on the per-channel take chain); the staged payload is then refreshed;
 *   - anything else (clip, loop, audio, PIP, layers added/removed, another look staged) → the existing
 *     take-look path, target preview + forceCut (what the web uses for deck recall).
 * No new AMCP builder. PGM-only mains have no PRV bus → nothing to push (mode 'none').
 */

const path = require('path')
const { pathToFileURL } = require('url')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { REPO_ROOT } = require('../repo-paths')

const NUDGE_MAX_LAYERS = 12
let _snap = null

async function snapshotLib() {
	if (!_snap) _snap = await import(pathToFileURL(path.join(REPO_ROOT, 'client', 'lib', 'scenes-preview-snapshot.js')).href)
	return _snap
}

function out(status, payload) {
	return { status, headers: JSON_HEADERS, body: jsonBody(payload) }
}

/** @returns {Promise<'nudge'|'take'>} */
async function decidePreviewPush(staged, scene, sceneId) {
	if (!staged || String(staged.sceneId || '') !== String(sceneId) || !staged.scene) return 'take'
	const sourced = (scene.layers || []).filter((l) => l?.source?.value)
	if (sourced.length === 0 || sourced.length > NUDGE_MAX_LAYERS) return 'take'
	const { buildPreviewContentSnapshot, isGeometryOnlyPreview } = await snapshotLib()
	const prev = buildPreviewContentSnapshot(String(sceneId), staged.scene)
	return isGeometryOnlyPreview(prev, scene) ? 'nudge' : 'take'
}

function parseRes(res) {
	try {
		return typeof res?.body === 'string' ? JSON.parse(res.body) : res?.body || {}
	} catch {
		return {}
	}
}

/**
 * @param {unknown} body
 * @param {object} ctx
 * @param {object} [deps] injectable for tests: resolveSceneById, getChannelMap, getStaged, nudge, takeLook, registerStaged
 */
async function handlePreviewPush(body, ctx, deps = {}) {
	const b = parseBody(body)
	const sceneId = String(b.sceneId || '').trim()
	if (!sceneId) return out(400, { ok: false, error: 'sceneId required' })
	const { resolveLiveSceneById } = require('../engine/project-scenes-transform')
	const scene = deps.resolveSceneById ? deps.resolveSceneById(sceneId) : resolveLiveSceneById(ctx, sceneId)
	if (!scene) return out(404, { ok: false, error: `look ${sceneId} not found in the stored project` })

	const getMap = deps.getChannelMap || require('../config/routing').getChannelMap
	const map = getMap(ctx?.config || {}, ctx?.switcherOutputBusByChannel) || {}
	const scope = parseInt(String(scene.mainScope ?? ''), 10)
	const mainIdx = Number.isFinite(Number(b.mainIdx)) ? Math.max(0, Math.floor(Number(b.mainIdx))) : Number.isFinite(scope) ? scope : 0
	const pgmCh = Number(map.programChannels?.[mainIdx] ?? map.playbackChannels?.[mainIdx])
	const prvCh = Number(map.previewChannels?.[mainIdx])
	if (!(Number.isFinite(prvCh) && prvCh > 0 && prvCh !== pgmCh)) {
		return out(200, { ok: true, mode: 'none', reason: 'pgm_only', mainIdx })
	}

	const getStaged = deps.getStaged || ((ch) => require('../state/live-scene-state').getChannel(ch))
	const staged = getStaged(prvCh)
	const mode = await decidePreviewPush(staged, scene, sceneId)

	const takeLook = deps.takeLook || ((tb) => require('./routes-scene-take-look').handleTakeLook(tb, ctx))
	if (mode === 'nudge') {
		const nudge = deps.nudge || ((nb) => require('./routes-preview-nudge').handlePreviewMixerNudge(nb, ctx))
		const res = { w: map.programResolutions?.[mainIdx]?.w, h: map.programResolutions?.[mainIdx]?.h }
		const nb = {
			sceneId,
			mainIndex: mainIdx,
			layers: (scene.layers || []).filter((l) => l?.source?.value),
			...(Number(res.w) > 0 && Number(res.h) > 0 ? { composeCanvas: { w: Number(res.w), h: Number(res.h) } } : {}),
		}
		const nr = await nudge(nb)
		const parsed = parseRes(nr)
		if (nr?.status === 200 && parsed.ok === true) {
			const register = deps.registerStaged || (async () => registerStagedScene(ctx, scene, map, mainIdx, prvCh))
			await register()
			return out(200, { ok: true, mode: 'nudge', mainIdx, previewChannel: prvCh, lines: parsed.lines ?? null })
		}
		/* staged look changed between our read and the chain → converge with a full push */
	}
	const tr = await takeLook({ sceneId, mainIdx, target: 'preview', forceCut: true })
	const parsed = parseRes(tr)
	return out(tr?.status || 500, { ...parsed, ok: tr?.status === 200 && parsed.ok !== false, mode: 'take', mainIdx, previewChannel: prvCh })
}

/** After a nudge the live map must describe the edited look (geometry included) — like a take would. */
async function registerStagedScene(ctx, scene, map, mainIdx, prvCh) {
	const { buildServerIncomingScene } = require('../engine/scene-take-payload')
	const { stripEphemeralTakeFields } = require('./routes-scene-shared')
	const liveSceneState = require('../state/live-scene-state')
	const incoming = await buildServerIncomingScene(scene, { mainIdx, channelMap: map, pgmOnly: false })
	await liveSceneState.setChannel(prvCh, { sceneId: String(scene.id), scene: stripEphemeralTakeFields(incoming) })
}

module.exports = { handlePreviewPush, decidePreviewPush, NUDGE_MAX_LAYERS }
