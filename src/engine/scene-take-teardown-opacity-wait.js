/**
 * WO-540 §6 option B — verify a fade actually finished before tearing the outgoing layer down,
 * instead of trusting a duration computed from the channel's DECLARED framerate.
 *
 * Root cause this guards against (measured live, `work/work-orders/540_...md`): channel 1 was
 * observed running at ~25fps while declaring 50, so a 25-frame fade "needed" 500ms by the
 * declared rate but took 1000ms on the wire. The teardown STOPped the outgoing producer at ~62%
 * through the dissolve — invisible on the log (STOP removes the producer, not the transform, so
 * the mixer's own opacity numbers keep counting down after the picture is gone) but a hard cut on
 * the monitor. `fadeMs` is a fine estimate when the channel is healthy; this module exists for
 * when it silently isn't — a rate error would otherwise reproduce this exact class of fault for
 * ANY reason a channel ever ticks slower than it claims, not just this one incident.
 *
 * Deliberately fails OPEN: any query error, a disconnected socket, or an unparseable response
 * gives up on the extra wait immediately and lets the caller's original `teardownWait` govern —
 * this must never be able to hang or delay a take beyond its bound.
 */

'use strict'

const OPACITY_SETTLED_EPSILON = 0.02
const POLL_INTERVAL_MS = 40

function parseOpacityResponse(data) {
	const text = Array.isArray(data) ? data.join('\n') : String(data ?? '')
	const m = text.match(/-?\d+(?:\.\d+)?/)
	return m ? parseFloat(m[0]) : null
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll `MIXER <channel>-<layer> OPACITY` until it reaches `target` (within epsilon) or `maxWaitMs`
 * elapses. Returns immediately (no query at all) if `maxWaitMs <= 0`.
 * @param {object} amcp
 * @param {number} channel
 * @param {number} physicalLayer
 * @param {number} target
 * @param {number} maxWaitMs
 * @returns {Promise<void>}
 */
async function waitForOpacitySettled(amcp, channel, physicalLayer, target, maxWaitMs) {
	if (!amcp || !(maxWaitMs > 0) || !Number.isFinite(physicalLayer)) return
	const deadline = Date.now() + maxWaitMs
	for (;;) {
		let value
		try {
			const res = await amcp._send(`MIXER ${channel}-${physicalLayer} OPACITY`, 'MIXER')
			value = parseOpacityResponse(res?.data)
		} catch (_) {
			return // query failed (timeout, disconnect, malformed reply) — give up, don't hang the take
		}
		if (value == null || Math.abs(value - target) <= OPACITY_SETTLED_EPSILON) return
		const remaining = deadline - Date.now()
		if (remaining <= 0) return
		await sleep(Math.min(POLL_INTERVAL_MS, remaining))
	}
}

module.exports = { waitForOpacitySettled, parseOpacityResponse, OPACITY_SETTLED_EPSILON }
