'use strict'

/**
 * WO-1063 — the PIP overlays (border, edge strip, shadow…) of a followed layer move with it. The PGM mixer nudge
 * (routes-preview-nudge.js) only moves the layer itself, and a look layer made from a switcher layer is an empty
 * placeholder: its overlays ARE the picture, so without this nothing visibly followed (box 13.11).
 *
 * Every overlay is updated IN PLACE (CG UPDATE with the new inner rectangle + its MIXER FILL): a move never re-adds
 * the template, which would restart an edge strip's run on every step of a drag.
 */

const { pipOverlaysFromLayer, buildPipOverlayUpdateLines, PIP_OVERLAY_MAX_STACK } = require('../engine/pip-overlay')
const { PGM_BANK_B_OFFSET } = require('../engine/look-layer-ranges')

/**
 * @param {{ channel: number, layers: object[], fills: Map<number, object>, bank: string, appCtx: object }} a
 *   layers: the moved live rows; fills: layerNumber → resolved content fill on that channel
 * @returns {string[]} AMCP lines ([] when no moved layer carries an overlay)
 */
function overlayFollowLines({ channel, layers, fills, bank, appCtx }) {
	const lines = []
	for (const layer of layers || []) {
		const overlays = pipOverlaysFromLayer(layer)
		const f = fills.get(Number(layer?.layerNumber))
		if (!overlays.length || !f) continue
		const phys = Number(layer.layerNumber) + (bank === 'b' ? PGM_BANK_B_OFFSET : 0)
		const max = Number.isFinite(PIP_OVERLAY_MAX_STACK) ? PIP_OVERLAY_MAX_STACK : overlays.length
		for (let i = 0; i < overlays.length && i < max; i++) {
			if (!overlays[i]?.type) continue
			lines.push(...buildPipOverlayUpdateLines(channel, phys, overlays[i], f, appCtx, i, null, layer.rotation ?? 0, overlays))
		}
	}
	return lines
}

/**
 * Send the overlay lines for the moved layers on the PGM take chain (behind any queued take; dropped when the look
 * left air meanwhile). The active bank is read inside the chain, like the nudge.
 * @returns {Promise<number>} lines sent
 */
async function moveOverlaysOnPgm(ctx, { sceneId, channel, layers, canvas }) {
	if (!(layers || []).some((l) => pipOverlaysFromLayer(l).length)) return 0
	const { chainSceneTakeWork } = require('../api/routes-scene-shared')
	const { getResolvedFillForSceneLayer } = require('../engine/scene-native-fill')
	const { cropAdjustedFillForLayer } = require('../engine/layer-crop')
	const { normalizeProgramLayerBank } = require('../engine/program-layer-bank')
	const liveSceneState = require('../state/live-scene-state')
	const incoming = canvas ? { composeCanvas: canvas } : null
	const fills = new Map()
	for (const l of layers) {
		fills.set(Number(l.layerNumber), cropAdjustedFillForLayer(await getResolvedFillForSceneLayer(ctx, l, channel, incoming), l))
	}
	let sent = 0
	await chainSceneTakeWork(ctx, channel, async () => {
		const now = liveSceneState.getChannel(channel)
		if (!now?.sceneId || String(now.sceneId) !== String(sceneId)) return
		const bank = normalizeProgramLayerBank(ctx.programLayerBankByChannel?.[String(channel)])
		const lines = overlayFollowLines({ channel, layers, fills, bank, appCtx: ctx })
		if (!lines.length) return
		await ctx.amcp.batchSendChunked(lines, { skipMixerPreCommit: true })
		await ctx.amcp.raw(`MIXER ${channel} COMMIT`)
		sent = lines.length
	})
	return sent
}

module.exports = { overlayFollowLines, moveOverlaysOnPgm }
