/**
 * Host destination utility helpers extracted from device-view-host-channels.
 */

/**
 * @param {object | null | undefined} dest
 * @returns {number | null}
 */
export function decklinkSlotFromHostDestination(dest) {
	const slot = parseInt(String(dest?.inputSlot ?? ''), 10)
	if (Number.isFinite(slot) && slot >= 1) return slot
	const m = String(dest?.id || '').match(/^host_decklink_input_(\d+)$/)
	return m ? parseInt(m[1], 10) || null : null
}

/**
 * @param {object | null | undefined} dest
 * @returns {number | null}
 */
export function liveAudioSlotFromHostDestination(dest) {
	const slot = parseInt(String(dest?.inputSlot ?? ''), 10)
	if (Number.isFinite(slot) && slot >= 1) return slot
	const m = String(dest?.id || '').match(/^host_live_audio_input_(\d+)$/)
	return m ? parseInt(m[1], 10) || null : null
}

/**
 * @param {object | null | undefined} dest
 * @returns {number | null}
 */
export function v4l2SlotFromHostDestination(dest) {
	const slot = parseInt(String(dest?.inputSlot ?? ''), 10)
	if (Number.isFinite(slot) && slot >= 1) return slot
	const m = String(dest?.id || '').match(/^host_v4l2_input_(\d+)$/)
	return m ? parseInt(m[1], 10) || null : null
}

/**
 * @param {object | null | undefined} dest
 * @param {string} role
 * @param {number | undefined} ch
 * @param {object[]} extraLive
 * @returns {object | null}
 */
export function findExtraLiveSourceForHostDestination(dest, role, ch, extraLive) {
	const list = Array.isArray(extraLive) ? extraLive : []
	if (role === 'decklink_input') {
		const slot = decklinkSlotFromHostDestination(dest)
		if (slot != null) {
			const bySlot = list.find((x) => x?.routeType === 'decklink' && Number(x.decklinkSlot) === slot)
			if (bySlot) return bySlot
		}
		if (ch != null) {
			return list.find((x) => x?.routeType === 'decklink' && Number(x.inputsChannel) === Number(ch)) || null
		}
		return null
	}
	const sid = String(dest?.sourceId || '').trim()
	if (sid) {
		const byId = list.find((x) => String(x?.sourceId || '').trim() === sid)
		if (byId) return byId
	}
	if (ch != null) {
		return (
			list.find(
				(x) => Number(x?.hostChannel ?? x?.inputsChannel) === Number(ch) && (x?.routeType === role || x?.hostRole === role)
			) || null
		)
	}
	return null
}

/* WO-378: `hostChannelVideoSourceToken()` lived here and was never called by anything (it was
 * re-exported once and that was all) — the `channel_<N>` token it invented is now produced
 * SERVER-side from the graph edge itself (src/config/device-graph-output-mapping.js), which is the
 * only place that knows which cable won. Removed rather than left as a second, drifting source of
 * the same string. */
