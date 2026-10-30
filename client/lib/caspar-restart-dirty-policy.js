/**
 * Device View Caspar restart dirty policy (WO-81; end-state decision matrix WO-172 T172.3).
 * This is the only copy: the server-side twin (src/streaming/caspar-restart-dirty-policy.js) was
 * never required by anything and had diverged from this one (v4l2_out branch, mode-aware stream_out,
 * WO-172) — removed in WO-831.
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
