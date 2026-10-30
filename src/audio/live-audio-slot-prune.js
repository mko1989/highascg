'use strict'

/**
 * WO-845: a removed live-audio slot must not keep its persisted PGM route selection.
 *
 * `live_audio_input_<n>_pgm_channels` is authoritative once present (WO-571: '' = "route to nothing", absent =
 * the legacy blanket always-on routing). The clients re-send the old selection of a slot the operator just removed
 * (web: live-audio-remove-input.js keeps `routeTargets[s-1]`; Godot likewise), the server stored it as given, and
 * the NEXT capture device put in that slot went straight onto PGM without the operator choosing it.
 *
 * Applied to the merged `casparServer` settings of POST /api/audio/live-inputs/config: a slot that ends the save
 * with no capture device, or beyond `live_audio_input_count`, has its route selection reset to '' (none). The
 * AMCP STOP of the live routes is stopDroppedLiveAudioPgmRoutes' job (it diffs the configs before/after).
 *
 * @param {Record<string, unknown>} cs  merged casparServer settings (mutated)
 * @param {number} [maxSlots]
 * @returns {number[]} the slots whose selection was cleared
 */
function clearRemovedSlotPgmRoutes(cs, maxSlots = 8) {
	const count = Math.min(maxSlots, Math.max(0, parseInt(String(cs.live_audio_input_count ?? 0), 10) || 0))
	const cleared = []
	for (let i = 1; i <= maxSlots; i++) {
		const pgmKey = `live_audio_input_${i}_pgm_channels`
		const had = String(cs[pgmKey] ?? '').trim() !== ''
		if (!had) continue
		const hasDevice = String(cs[`live_audio_input_${i}_device`] ?? '').trim() !== ''
		if (i <= count && hasDevice) continue
		cs[pgmKey] = ''
		cleared.push(i)
	}
	return cleared
}

/**
 * Owner 30.10: "the live audio was added with both outputs already enabled, not good for live show." A slot that
 * gains a capture device in this save (no device before, or beyond the old count) and has no route selection in the
 * body is pinned to '' — the operator routes it to PGM on purpose. Without the key the slot fell back to the legacy
 * blanket `live_audio_pgm_always_on` routing (WO-571) and went straight onto every PGM screen.
 *
 * @param {Record<string, unknown>} prevCs  casparServer settings before the save
 * @param {Record<string, unknown>} cs  merged settings (mutated)
 * @param {Record<string, unknown>} body  the POST body (an explicit selection in it wins)
 * @param {number} [maxSlots]
 * @returns {number[]} the new slots left unrouted
 */
function newSlotsRouteNowhere(prevCs, cs, body, maxSlots = 8) {
	const countOf = (c) => Math.min(maxSlots, Math.max(0, parseInt(String(c.live_audio_input_count ?? 0), 10) || 0))
	const live = (c, i) => i <= countOf(c) && String(c[`live_audio_input_${i}_device`] ?? '').trim() !== ''
	const pinned = []
	for (let i = 1; i <= maxSlots; i++) {
		const pgmKey = `live_audio_input_${i}_pgm_channels`
		if (body[pgmKey] != null || live(prevCs, i) || !live(cs, i)) continue
		cs[pgmKey] = ''
		pinned.push(i)
	}
	return pinned
}

/** Both rules for POST /api/audio/live-inputs/config; returns the log lines (empty when nothing changed). */
function pruneSlotPgmRoutes(prevCs, cs, body) {
	const cleared = clearRemovedSlotPgmRoutes(cs)
	const unrouted = newSlotsRouteNowhere(prevCs, cs, body)
	return [
		...(cleared.length ? [`cleared PGM route selection of removed slot(s) ${cleared.join(', ')}`] : []),
		...(unrouted.length ? [`new slot(s) ${unrouted.join(', ')} start unrouted`] : []),
	]
}

module.exports = { clearRemovedSlotPgmRoutes, newSlotsRouteNowhere, pruneSlotPgmRoutes }
