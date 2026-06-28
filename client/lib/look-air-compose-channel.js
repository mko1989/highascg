/**
 * Resolve Caspar compose-preview channel when a look is on PGM or PRV (WO-63).
 * Keep in sync with src/engine/look-air-compose-channel.js.
 */

import { resolveBusLookIdsForMain } from './scene-live-main-sync.js'

/**
 * @param {string} lookId
 * @param {number} mainIdx
 * @param {{ getScene?: (id: string) => object | null, getLiveSceneIdForMain?: (idx: number) => string | null, getPreviewSceneIdForMain?: (idx: number) => string | null }} sceneState
 * @param {{ programChannels?: number[], previewChannels?: number[] } | null | undefined} channelMap
 * @param {Record<string, { sceneId?: string }>} [sceneLive]
 * @returns {{ bus: 'pgm' | 'prv', channel: number } | null}
 */
export function resolveLookAirComposeChannel(lookId, mainIdx, sceneState, channelMap, sceneLive) {
	const id = String(lookId ?? '').trim()
	if (!id) return null

	const idx = Math.max(0, parseInt(String(mainIdx), 10) || 0)
	const pgmChRaw = channelMap?.programChannels?.[idx]
	const pgmCh = pgmChRaw != null ? Number(pgmChRaw) : NaN
	const prvChRaw = channelMap?.previewChannels?.[idx]
	const prvCh = prvChRaw != null ? Number(prvChRaw) : NaN
	const hasPrv = Number.isFinite(prvCh) && prvCh > 0 && prvCh !== pgmCh

	const sceneExists = (sid) => !!sceneState?.getScene?.(sid)
	const { pgmLookId, prvLookId } = resolveBusLookIdsForMain(
		idx,
		sceneLive || {},
		channelMap || {},
		sceneExists,
		sceneState,
	)

	if (pgmLookId === id && Number.isFinite(pgmCh) && pgmCh > 0) {
		return { bus: 'pgm', channel: pgmCh }
	}

	if (hasPrv && prvLookId === id) {
		return { bus: 'prv', channel: prvCh }
	}

	return null
}
