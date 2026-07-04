/**
 * Derive per-main PGM/PRV look ids from authoritative scene.live channel map.
 * Keep in sync with src/engine/scene-live-main-sync.js (WO-63).
 */

export const MAX_MAINS = 4

/**
 * @param {Record<string, { sceneId?: string }>} channels
 * @param {{ programChannels?: number[], previewChannels?: number[] }} channelMap
 * @param {(id: string) => boolean} sceneExists
 * @param {{ liveSceneIdByMain?: (string|null)[], previewSceneIdByMain?: (string|null)[] }} [prev]
 * @returns {{ liveSceneIdByMain: (string|null)[], previewSceneIdByMain: (string|null)[], changed: boolean, previewChanged: boolean }}
 */
export function syncMainSlotsFromSceneLive(channels, channelMap, sceneExists, prev = {}) {
	const liveSceneIdByMain = [...(prev.liveSceneIdByMain || [null, null, null, null])]
	const previewSceneIdByMain = [...(prev.previewSceneIdByMain || [null, null, null, null])]
	while (liveSceneIdByMain.length < MAX_MAINS) liveSceneIdByMain.push(null)
	while (previewSceneIdByMain.length < MAX_MAINS) previewSceneIdByMain.push(null)

	const programs = Array.isArray(channelMap?.programChannels) ? channelMap.programChannels : []
	const previews = Array.isArray(channelMap?.previewChannels) ? channelMap.previewChannels : []
	let changed = false
	let previewChanged = false

	for (let idx = 0; idx < MAX_MAINS && idx < programs.length; idx++) {
		const pgmCh = programs[idx]
		const pgmSidRaw = pgmCh != null ? String(channels[String(pgmCh)]?.sceneId || '').trim() : ''
		const nextLive = pgmSidRaw && sceneExists(pgmSidRaw) ? pgmSidRaw : null
		if (liveSceneIdByMain[idx] !== nextLive) {
			liveSceneIdByMain[idx] = nextLive
			changed = true
		}

		const prvCh = previews[idx]
		const hasSeparatePrv =
			prvCh != null && Number(prvCh) > 0 && Number(prvCh) !== Number(pgmCh)
		if (!hasSeparatePrv) continue

		const prvSidRaw = String(channels[String(prvCh)]?.sceneId || '').trim()
		const nextPreview = prvSidRaw && sceneExists(prvSidRaw) ? prvSidRaw : null
		if (previewSceneIdByMain[idx] !== nextPreview) {
			previewSceneIdByMain[idx] = nextPreview
			changed = true
			previewChanged = true
		}
	}

	return { liveSceneIdByMain, previewSceneIdByMain, changed, previewChanged }
}

/**
 * Read PGM/PRV look ids for one main directly from scene.live (authoritative for deck UI).
 *
 * @param {number} mainIdx
 * @param {Record<string, { sceneId?: string }>} sceneLive
 * @param {{ programChannels?: number[], previewChannels?: number[] }} channelMap
 * @param {(id: string) => boolean} sceneExists
 * @param {{ getLiveSceneIdForMain?: (idx: number) => string | null, getPreviewSceneIdForMain?: (idx: number) => string | null }} [sceneStateFallback]
 * @returns {{ pgmLookId: string | null, prvLookId: string | null }}
 */
export function resolveBusLookIdsForMain(mainIdx, sceneLive, channelMap, sceneExists, sceneStateFallback) {
	const idx = Math.max(0, parseInt(String(mainIdx), 10) || 0)
	const programs = Array.isArray(channelMap?.programChannels) ? channelMap.programChannels : []
	const previews = Array.isArray(channelMap?.previewChannels) ? channelMap.previewChannels : []
	const pgmCh = programs[idx]
	const prvCh = previews[idx]
	const hasSeparatePrv =
		prvCh != null && Number(prvCh) > 0 && Number(prvCh) !== Number(pgmCh)

	const live = sceneLive && typeof sceneLive === 'object' ? sceneLive : {}
	const pgmSidRaw = pgmCh != null ? String(live[String(pgmCh)]?.sceneId || '').trim() : ''
	let pgmLookId = pgmSidRaw && sceneExists(pgmSidRaw) ? pgmSidRaw : null

	let prvLookId = null
	if (hasSeparatePrv) {
		const prvSidRaw = String(live[String(prvCh)]?.sceneId || '').trim()
		prvLookId = prvSidRaw && sceneExists(prvSidRaw) ? prvSidRaw : null
	}

	if (!pgmLookId && sceneStateFallback) {
		const liveFn = sceneStateFallback.getLiveSceneIdForMain
		if (typeof liveFn === 'function') {
			const sid = liveFn.call(sceneStateFallback, idx)
			pgmLookId = sid != null && sceneExists(String(sid)) ? String(sid) : null
		}
	}
	if (hasSeparatePrv && !prvLookId && sceneStateFallback) {
		const previewFn = sceneStateFallback.getPreviewSceneIdForMain
		if (typeof previewFn === 'function') {
			const sid = previewFn.call(sceneStateFallback, idx)
			prvLookId = sid != null && sceneExists(String(sid)) ? String(sid) : null
		}
	}

	if (prvLookId && pgmLookId && prvLookId === pgmLookId) prvLookId = null
	return { pgmLookId, prvLookId }
}

/**
 * Whether this main has a look staged on PRV (server scene.live or client preview slot).
 * Uses the PRV channel entry directly so a look on PGM+PRV still counts as clearable preview.
 * @param {number} mainIdx
 * @param {Record<string, { sceneId?: string }>} sceneLive
 * @param {{ programChannels?: number[], previewChannels?: number[] }} channelMap
 * @param {(id: string) => boolean} sceneExists
 * @param {{ getPreviewSceneIdForMain?: (idx: number) => string | null }} [sceneStateFallback]
 * @returns {boolean}
 */
export function hasPreviewLookForMain(mainIdx, sceneLive, channelMap, sceneExists, sceneStateFallback) {
	const idx = Math.max(0, parseInt(String(mainIdx), 10) || 0)
	const programs = Array.isArray(channelMap?.programChannels) ? channelMap.programChannels : []
	const previews = Array.isArray(channelMap?.previewChannels) ? channelMap.previewChannels : []
	const pgmCh = programs[idx]
	const prvCh = previews[idx]
	const hasSeparatePrv =
		prvCh != null && Number(prvCh) > 0 && Number(prvCh) !== Number(pgmCh)
	if (!hasSeparatePrv) return false

	const live = sceneLive && typeof sceneLive === 'object' ? sceneLive : {}
	const prvSidRaw = String(live[String(prvCh)]?.sceneId || '').trim()
	if (prvSidRaw && sceneExists(prvSidRaw)) return true

	const sid = sceneStateFallback?.getPreviewSceneIdForMain?.(idx)
	return sid != null && String(sid).trim() !== '' && sceneExists(String(sid))
}
