/**
 * Device View Caspar restart dirty policy (WO-81).
 * Keep in sync with src/streaming/caspar-restart-dirty-policy.js (smoke tests).
 */

/** Settings slices that only affect runtime AMCP consumers — not generated Caspar XML. */
const RUNTIME_ONLY_PATCH_KEYS = new Set(['streamOutputs', 'recordOutputs'])

/**
 * @param {Record<string, unknown>} patch
 * @returns {boolean}
 */
export function settingsPatchAffectsCasparRestart(patch) {
	if (!patch || typeof patch !== 'object') return false
	for (const key of Object.keys(patch)) {
		if (RUNTIME_ONLY_PATCH_KEYS.has(key)) continue
		if (key === 'streamingChannel') {
			const sc = patch.streamingChannel
			if (!sc || typeof sc !== 'object') continue
			if ('enabled' in sc) return true
			if (sc.videoMode != null || sc.dedicatedOutputChannel != null) return true
			continue
		}
		if (key === 'deviceGraph' || key === 'screenDestinations' || key === 'casparServer') return true
		if (key.startsWith('screen_') || key.startsWith('multiview_')) return true
	}
	return false
}

/**
 * @param {{ kind?: string } | null | undefined} sinkConn
 * @returns {boolean}
 */
export function cableSinkAffectsCasparRestart(sinkConn) {
	const kind = String(sinkConn?.kind || '')
	if (kind === 'stream_out' || kind === 'record_out') return false
	if (kind === 'v4l2_out') return false
	return true
}
