'use strict'

/**
 * WO-801 — `POST /api/audio/monitor-source { pair }`: the headphone pair of the monitor output.
 *   pair 'mix'          → the OpenAL downmix (the config's consumer, today's behaviour)
 *   pair '1+2' … '15+16' → only that pair on the headphones (src/audio/monitor-pair.js)
 * Rides the existing monitor-source route (router.js is at its 500-line limit). The pair is kept in the console state
 * (`audioMixer.monitorPair`, broadcast) only after Caspar took it.
 */

const { JSON_HEADERS, jsonBody } = require('./response')
const mixerState = require('../audio/mixer-state')
const { isMonitorPair, applyMonitorPair, MONITOR_PAIRS } = require('../audio/monitor-pair')

/**
 * @param {object} ctx
 * @param {{ pair?: unknown }} b parsed body
 */
async function handleMonitorPair(ctx, b) {
	if (!isMonitorPair(b.pair)) {
		return { status: 400, headers: JSON_HEADERS, body: jsonBody({ error: `pair must be one of ${MONITOR_PAIRS.join(', ')}` }) }
	}
	const res = await applyMonitorPair(ctx, String(b.pair))
	if (res.ok) mixerState.setMonitorPair(ctx, res.pair)
	if (typeof ctx?.log === 'function') {
		ctx.log(res.ok ? 'info' : 'warn', `[Audio] monitor pair ${res.pair} on ch ${res.monitorCh ?? '-'}: ${res.ok ? 'ok' : res.error}`)
	}
	return { status: res.status, headers: JSON_HEADERS, body: jsonBody(res) }
}

module.exports = { handleMonitorPair }
