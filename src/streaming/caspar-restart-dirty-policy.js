'use strict'

/** Settings slices that only affect runtime AMCP consumers — not generated Caspar XML (WO-81). */
const RUNTIME_ONLY_PATCH_KEYS = new Set(['streamOutputs', 'recordOutputs'])

/**
 * Whether a settings patch from Device View should orange Apply Caspar config.
 * @param {Record<string, unknown>} patch
 * @returns {boolean}
 */
function settingsPatchAffectsCasparRestart(patch) {
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
 * Whether cabling to this sink requires Caspar config regen / restart.
 * @param {{ kind?: string } | null | undefined} sinkConn
 * @returns {boolean}
 */
function cableSinkAffectsCasparRestart(sinkConn) {
	const kind = String(sinkConn?.kind || '')
	if (kind === 'stream_out' || kind === 'record_out') return false
	return true
}

module.exports = {
	settingsPatchAffectsCasparRestart,
	cableSinkAffectsCasparRestart,
}
