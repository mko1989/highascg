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
				(x) =>
					Number(x?.hostChannel ?? x?.inputsChannel) === Number(ch) &&
					(x?.routeType === role || x?.hostRole === role),
			) || null
		)
	}
	return null
}

/**
 * Token stored on recordOutputs[].source / streamingChannel.videoSource when cabled from a host destination.
 * @param {object} dest
 * @returns {string}
 */
export function hostChannelVideoSourceToken(dest) {
	const ch = parseInt(String(dest?.casparChannel ?? dest?.pgmChannel ?? ''), 10)
	if (Number.isFinite(ch) && ch >= 1) return `channel_${ch}`
	return 'program_1'
}
