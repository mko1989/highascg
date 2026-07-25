/**
 * clearPreviewBusForMain, split out of scenes-preview-runtime.js: clear preview selection for one
 * main and stop look-stack layers on the mapped PRV channel.
 */

import { api } from '../lib/api-client.js'
import { postAmcpPreviewPipeline } from '../lib/amcp-preview-batch.js'
import { buildPipOverlayRemoveLines } from '../lib/pip-overlay-amcp.js'
import { chLayerAmcp } from './scenes-shared.js'
import {
	allMatrixLayersOnPreviewChannel,
	defaultLookLayersForSweep,
	getOccupiedPreviewLookLayersFromState,
	isPreviewBusAvailable,
	PREVIEW_SCENE_LAYER_MIN,
	TIMELINE_LAYER_BASE,
	TIMELINE_LAYER_CLEAR_COUNT,
} from '../lib/scenes-preview-look-stack.js'
import { clearPreviewLiveOnServer } from '../lib/scene-live-sync.js'

/**
 * @param {number} mIdx
 * @param {{ full?: boolean }} opts — `full`: also sweep timeline layers, deck decade slots, and all matrix layers on PRV (not only “last look” / occupied).
 * @param {{
 *   sceneState: object, stateStore: object, getChannelMap: () => object,
 *   waitForPreviewPushComplete: () => Promise<void>,
 *   physicalPgmChannelForMain: (mIdx: number) => number|null,
 *   physicalPrvChannelForMain: (mIdx: number) => number|null,
 *   borderPayloadForBorderLines: (gb: object, mirror: boolean) => object,
 *   borderMetaKey: (ch: number, layer: number) => string,
 *   GB_LAYER_PRV_MIRROR: number,
 *   lastGlobalBorderPushMeta: Map<string, object>,
 *   ctx: { lastPreviewLayers: Set<number>|null, lastPreviewContentSnapshot: object|null, lastPreviewChannel: number|null },
 * }} rt
 */
export async function clearPreviewBusForMainImpl(mIdx, opts, rt) {
	const {
		sceneState, stateStore, getChannelMap, waitForPreviewPushComplete,
		physicalPgmChannelForMain, physicalPrvChannelForMain,
		borderPayloadForBorderLines, borderMetaKey, GB_LAYER_PRV_MIRROR,
		lastGlobalBorderPushMeta, ctx,
	} = rt

	await waitForPreviewPushComplete()

	sceneState.setPreviewSceneId(null, mIdx)

	// Skip clear for PGM-only mains (no separate preview bus)
	const cm = getChannelMap()
	if (!isPreviewBusAvailable(cm, mIdx)) return

	const pgmCh = physicalPgmChannelForMain(mIdx)
	const prvCh = physicalPrvChannelForMain(mIdx)
	const separatePrv = !!(prvCh && pgmCh && prvCh !== pgmCh)
	if (!separatePrv || !prvCh) return

	const previewCh = prvCh
	let clearedViaServer = false
	try {
		const res = await clearPreviewLiveOnServer(mIdx, { sceneState, stateStore })
		clearedViaServer = !!(res?.cleared || res?.clearedAmcp)
	} catch (e) {
		console.warn('Clear preview: server clear failed, falling back to client AMCP:', e?.message || e)
	}

	if (!clearedViaServer) {
		const queue = []
		const occupied = getOccupiedPreviewLookLayersFromState(stateStore, previewCh)
		if (Number(ctx.lastPreviewChannel) === Number(previewCh) && ctx.lastPreviewLayers) {
			for (const n of ctx.lastPreviewLayers) {
				if (Number.isFinite(n) && n >= PREVIEW_SCENE_LAYER_MIN && n < 10000) occupied.add(n)
			}
		}
		if (opts.full) {
			for (const n of allMatrixLayersOnPreviewChannel(stateStore, previewCh)) occupied.add(n)
			for (let ti = 0; ti < TIMELINE_LAYER_CLEAR_COUNT; ti++) occupied.add(TIMELINE_LAYER_BASE + ti)
			for (const n of defaultLookLayersForSweep()) occupied.add(n)
		}

		for (const ln of [...occupied].sort((a, b) => a - b)) {
			const dl = chLayerAmcp(previewCh, ln)
			queue.push(`STOP ${dl}`, `MIXER ${dl} CLEAR`, ...buildPipOverlayRemoveLines(previewCh, ln, 10000))
		}

		const gb = sceneState.getGlobalBorderForScreen(mIdx)
		const mirror = gb?.mirrorBorderOnPrv === true
		const include997 =
			mirror || lastGlobalBorderPushMeta.has(borderMetaKey(previewCh, GB_LAYER_PRV_MIRROR))

		if (include997) {
			try {
				const borderRes = await api.post('/api/scene/border-lines', {
					channel: previewCh,
					layer: GB_LAYER_PRV_MIRROR,
					border: borderPayloadForBorderLines(gb, false),
					isUpdate: false,
				})
				const raw = borderRes?.lines
				if (Array.isArray(raw) && raw.length > 0) queue.push(...raw)
			} catch (e) {
				console.warn('Failed to clear PRV border mirror:', e?.message || e)
			}
			lastGlobalBorderPushMeta.delete(borderMetaKey(previewCh, GB_LAYER_PRV_MIRROR))
		}

		const commitLine = `MIXER ${previewCh} COMMIT`
		queue.push(commitLine)
		if (queue.some((l) => l !== commitLine)) {
			await postAmcpPreviewPipeline(queue)
		}
	}

	if (Number(ctx.lastPreviewChannel) === Number(previewCh)) {
		ctx.lastPreviewLayers = null
		ctx.lastPreviewContentSnapshot = null
		ctx.lastPreviewChannel = null
	}
}
