'use strict'

/**
 * WO-601 PIP overlays — preview-push "overlay" mode. A look whose only content change is `pipOverlays` (web
 * isGeometryOnlyPreview holds once overlays are stripped from both sides) gets the MIXER nudge + overlay CG
 * lines instead of a forceCut re-take, which LOADBG … SEEK 0 + PLAYs every clip of the look on each slider tick.
 * Mirrors the web's own push (scenes-preview-push-scene.js: unchanged clip → mixer + buildPipOverlayAmcpLinesAll
 * with the previous overlays) and the inspector's struct rule (inspector-pip-overlay.js: same types/sides in the
 * same order → update in place, otherwise remove the layer's slots + add all).
 */

const { pipOverlaysFromLayer } = require('../engine/pip-overlay-utils')
const { buildPipOverlayAmcpLinesAll, buildPipOverlayRemoveLines } = require('../engine/pip-overlay')
const { cropAdjustedFillForLayer } = require('../engine/layer-crop')

const stripPip = (scene) => ({ ...scene, layers: (scene?.layers || []).map((l) => ({ ...l, pipOverlays: [], pipOverlay: undefined })) })

/** The staged look differs from the edited one in overlays only (and in at least one overlay). */
function isOverlayOnlyChange(isGeometryOnlyPreview, buildSnapshot, sceneId, stagedScene, scene) {
	if (isGeometryOnlyPreview(buildSnapshot(String(sceneId), stagedScene), scene)) return false
	return isGeometryOnlyPreview(buildSnapshot(String(sceneId), stripPip(stagedScene)), stripPip(scene))
}

const shapeKey = (list) => list.map((o) => `${o.type}:${String(o.params?.side ?? 'outside').trim().toLowerCase()}`).join('|')

/**
 * Overlay lines for every sourced layer whose overlays changed (PRV is bank-less: logical = physical layer; WO-1073 PGM
 * passes `physOf` = the active bank's physical layer, so the lines address the slots the take put the overlays on).
 * Same types / sides in the same order → CG UPDATE in place, outside ones included (WO-1073 `outsideInPlace`).
 * @param {{ channel: number, layers: object[], stagedLayers: object[], fills: Map<number, object>, appCtx: object, physOf?: (ln: number) => number }} a
 */
function buildPreviewPipLines({ channel, layers, stagedLayers, fills, appCtx, physOf = (ln) => ln }) {
	const prevBy = new Map((stagedLayers || []).map((l) => [Number(l?.layerNumber), l]))
	const lines = []
	for (const layer of layers || []) {
		if (!layer?.source?.value) continue
		const ln = Number(layer.layerNumber)
		const prevLayer = prevBy.get(ln) || null
		const cur = pipOverlaysFromLayer(layer)
		const prev = pipOverlaysFromLayer(prevLayer)
		if (JSON.stringify(cur) === JSON.stringify(prev)) continue
		const f = fills.get(ln)
		if (!f) continue
		const same = cur.length === prev.length && shapeKey(cur) === shapeKey(prev)
		const pl = physOf(ln)
		if (!same) lines.push(...buildPipOverlayRemoveLines(channel, pl, null))
		if (cur.length > 0) {
			const fill = cropAdjustedFillForLayer(f, layer)
			lines.push(...buildPipOverlayAmcpLinesAll(cur, channel, pl, fill, appCtx, null, same ? prevLayer : null, layer.rotation ?? 0, { outsideInPlace: true }))
		}
	}
	return lines
}

/**
 * Send the overlay lines on the PRV take chain (never interleaves a queued take), re-checking the staged look.
 * @returns {Promise<{ ok: boolean, lines: number }>}
 */
async function pushPreviewPipOverlays(ctx, { sceneId, scene, staged, prvCh, mainIdx, canvas }) {
	const { chainSceneTakeWork, takeChainKeyForPreviewChannel, getRouteMap } = require('./routes-scene-shared')
	const { getResolvedFillForSceneLayer } = require('../engine/scene-native-fill')
	const liveSceneState = require('../state/live-scene-state')
	const incoming = canvas ? { composeCanvas: canvas } : null
	const fills = new Map()
	for (const l of scene.layers || []) {
		if (l?.source?.value) fills.set(Number(l.layerNumber), await getResolvedFillForSceneLayer(ctx, l, prvCh, incoming))
	}
	const lines = buildPreviewPipLines({ channel: prvCh, layers: scene.layers, stagedLayers: staged?.scene?.layers, fills, appCtx: ctx })
	let sent = false
	await chainSceneTakeWork(ctx, takeChainKeyForPreviewChannel(getRouteMap(ctx), prvCh, mainIdx), async () => {
		const now = liveSceneState.getChannel(prvCh)
		if (!now?.sceneId || String(now.sceneId) !== String(sceneId)) return
		if (lines.length) await ctx.amcp.batchSendChunked(lines, { skipMixerPreCommit: true, forceBatch: true })
		sent = true
	})
	return { ok: sent, lines: lines.length }
}

/**
 * WO-1073 — the PGM edit's overlay push: the look on air on program channel `pgmCh`. Runs on the program channel's take
 * chain (the key /api/scene/take and the PGM nudge use), re-checks that the look is still on air there, and reads the
 * ACTIVE bank inside the chain (a queued take may have flipped it): bank B overlays sit on the slots of layer + 100.
 * @returns {Promise<{ ok: boolean, lines: number, bank?: string }>} ok false = the look left air (nothing sent)
 */
async function pushPgmPipOverlays(ctx, { sceneId, scene, live, pgmCh, canvas }) {
	const { chainSceneTakeWork } = require('./routes-scene-shared')
	const { getResolvedFillForSceneLayer } = require('../engine/scene-native-fill')
	const { normalizeProgramLayerBank } = require('../engine/program-layer-bank')
	const { PGM_BANK_B_OFFSET } = require('../engine/look-layer-ranges')
	const liveSceneState = require('../state/live-scene-state')
	const incoming = canvas ? { composeCanvas: canvas } : null
	const fills = new Map()
	for (const l of scene.layers || []) {
		if (l?.source?.value) fills.set(Number(l.layerNumber), await getResolvedFillForSceneLayer(ctx, l, pgmCh, incoming))
	}
	let sent = null
	await chainSceneTakeWork(ctx, pgmCh, async () => {
		const now = liveSceneState.getChannel(pgmCh)
		if (!now?.sceneId || String(now.sceneId) !== String(sceneId)) return
		const bank = normalizeProgramLayerBank(ctx.programLayerBankByChannel?.[String(pgmCh)])
		const physOf = (ln) => (bank === 'b' ? ln + PGM_BANK_B_OFFSET : ln)
		const lines = buildPreviewPipLines({ channel: pgmCh, layers: scene.layers, stagedLayers: (now.scene || live?.scene)?.layers, fills, appCtx: ctx, physOf })
		if (lines.length) await ctx.amcp.batchSendChunked(lines, { skipMixerPreCommit: true, forceBatch: true })
		sent = { lines: lines.length, bank }
	})
	return sent ? { ok: true, ...sent } : { ok: false, lines: 0 }
}

module.exports = { isOverlayOnlyChange, buildPreviewPipLines, pushPreviewPipOverlays, pushPgmPipOverlays }
