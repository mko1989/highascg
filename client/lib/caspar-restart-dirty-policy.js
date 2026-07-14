/**
 * Device View Caspar restart dirty policy (WO-81; end-state decision matrix WO-172 T172.3).
 * Keep in sync with src/streaming/caspar-restart-dirty-policy.js (smoke tests) — note this copy
 * has diverged (v4l2_out branch, mode-aware stream_out) as of WO-172; the sibling file is out of
 * WO-172's touch scope and was left as-is (see WO-172 work log).
 *
 * WO-172 T172.3 decision matrix (A172.2):
 *  - stream_out / record_out cabling, "attach" mode (streamingChannel.dedicatedOutputChannel is not
 *    true): NOT dirty. device-view-apply.js's (now fixed) sync writes videoSource/recordOutputs[].source
 *    live; the next Start/ADD reads fresh config — no restart needed.
 *  - stream_out cabling, "dedicated" mode (streamingChannel.dedicatedOutputChannel === true): DIRTY.
 *    The dedicated encode-bus `PLAY route://<src>` binding is only (re-)issued by setupAllRouting on
 *    boot/reconnect (src/config/routing-setup.js:328-340) — a config write alone does not move it.
 *  - record_out cabling: NEVER dirty, regardless of streamingChannel.dedicatedOutputChannel — record
 *    has no "dedicated channel" concept; resolveRecordSourceChannel always resolves straight to a
 *    program/preview/multiview bus from fresh config at record-start.
 *  - v4l2_out (virtual camera) cabling: never dirty — same live-resolve-at-start pattern.
 *  - Everything else (DeckLink/GPU/screen output, encoder-only streamOutputs/recordOutputs settings
 *    excluded): unchanged from WO-81.
 */

/** Settings slices that only affect runtime AMCP consumers — not generated Caspar XML. */
const RUNTIME_ONLY_PATCH_KEYS = new Set(['streamOutputs', 'recordOutputs'])

/**
 * @param {{ streamingChannel?: { dedicatedOutputChannel?: boolean | string } } | null | undefined} settings
 * @returns {boolean}
 */
export function isStreamingDedicatedOutputChannel(settings) {
	const sc = settings && typeof settings === 'object' ? settings.streamingChannel : null
	if (!sc || typeof sc !== 'object') return false
	return sc.dedicatedOutputChannel === true || sc.dedicatedOutputChannel === 'true'
}

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
 * @param {{ dedicatedStreamingChannel?: boolean }} [opts] - WO-172 T172.3: pass
 *   `isStreamingDedicatedOutputChannel(currentSettings)` here so `stream_out` cabling is mode-aware.
 * @returns {boolean}
 */
export function cableSinkAffectsCasparRestart(sinkConn, opts = {}) {
	const kind = String(sinkConn?.kind || '')
	if (kind === 'stream_out') return !!opts.dedicatedStreamingChannel
	if (kind === 'record_out') return false
	if (kind === 'v4l2_out') return false
	return true
}
