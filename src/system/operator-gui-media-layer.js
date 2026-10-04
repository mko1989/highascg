/**
 * WO-592 — media-inspector preview cell on the operator-GUI channel. Split from
 * operator-gui-channel.js (500-line limit). The cell plan carries a `media: true` entry on the
 * fixed MEDIA_PREVIEW_LAYER; its producer is LOADed/driven by src/api/routes-media-preview.js, so
 * the layout apply only positions it (MIXER FILL) and clears it once the client withdraws the cell.
 */
'use strict'

const { MEDIA_PREVIEW_LAYER } = require('./operator-gui-channel-geometry')

/** Per-channel: did the last applied plan carry a media cell? */
const mediaCellLiveByChannel = new Map()

/**
 * @param {Array<{media?: boolean}>} plan
 * @returns {{ routes: Array<object>, media: Array<object> }}
 */
function splitMediaPreviewEntries(plan) {
	const routes = []
	const media = []
	for (const entry of Array.isArray(plan) ? plan : []) (entry?.media ? media : routes).push(entry)
	return { routes, media }
}

/**
 * Media cells are per-client and transient: never persist them into `operatorGuiLayout` / the
 * project, and never broadcast them as shared compose layout (a remote client would sync a tile to it).
 * @param {Array<{role?: string}>} cells
 */
function persistableCells(cells) {
	return (Array.isArray(cells) ? cells : []).filter((c) => c?.role !== 'media')
}

/**
 * FILL the media layer while a media cell is reported; STOP + MIXER CLEAR it on the
 * present → absent transition only (so a compose-only report racing a fresh LOAD never kills it).
 * @param {{ amcp: object, log?: Function }} ctx
 * @param {number} ch
 * @param {Array<{x: number, y: number, w: number, h: number}>} mediaEntries
 */
async function applyMediaPreviewLayer(ctx, ch, mediaEntries) {
	const entry = mediaEntries[0]
	if (entry) {
		mediaCellLiveByChannel.set(ch, true)
		try {
			await ctx.amcp.mixerFill(ch, MEDIA_PREVIEW_LAYER, entry.x, entry.y, entry.w, entry.h)
		} catch (e) {
			ctx.log?.('warn', `operator-gui: media preview FILL ${ch}-${MEDIA_PREVIEW_LAYER} failed: ${e?.message || e}`)
		}
		return
	}
	if (!mediaCellLiveByChannel.get(ch)) return
	mediaCellLiveByChannel.set(ch, false)
	await clearMediaPreviewLayer(ctx, ch)
}

/** @param {{ amcp: object }} ctx @param {number} ch */
async function clearMediaPreviewLayer(ctx, ch) {
	try {
		await ctx.amcp.stop(ch, MEDIA_PREVIEW_LAYER)
	} catch (_) {
		/* layer may already be empty */
	}
	try {
		await ctx.amcp.mixerClear(ch, MEDIA_PREVIEW_LAYER)
	} catch (_) {
		/* best-effort hygiene */
	}
}

function resetMediaPreviewLayerStateForTests() {
	mediaCellLiveByChannel.clear()
}

module.exports = {
	splitMediaPreviewEntries,
	persistableCells,
	applyMediaPreviewLayer,
	clearMediaPreviewLayer,
	resetMediaPreviewLayerStateForTests,
}
