'use strict'

/**
 * WO-1029 B2 — a program line this server must not send (the cluster master forwards that screen to it right now, or
 * the old hot-backup pair's leader drives it) is REFUSED, never answered with a made-up `202 OK`. The refusal is one
 * typed error (`code: 'AIR_HELD'`, `drivenBy`), and every route turns it into
 * `409 { error: 'Screen N is driven by <master> (linked servers)', drivenBy }`. Nothing a refused action would have
 * recorded (playback tracker, live store, test card flag) is recorded: the error stops the caller before that.
 *
 * WO-1029 B4 — a batch is decided per line (`withAirGate`): the lines this server drives go out, the held ones are
 * listed in `refused`; only a batch with nothing left to send rejects.
 *
 * WO-1029 phase 2a — a second kind of refusal, same path: `code: 'REMOTE_SCREEN'`, a non-master pressing on its copy
 * channel of a screen cabled only on other servers (`owners`): `409 { error: 'Screen N is on <server>: drive it there
 * or from the master', code, owners }`. Never answered ok for a press that showed nowhere.
 */

const { JSON_HEADERS, jsonBody } = require('../api/response')

class AirHeldError extends Error {
	/** @param {{ channel: number, screen?: number, drivenBy: string }} held  @param {object[]} [refused] */
	constructor(held, refused) {
		const what = held.screen ? `Screen ${held.screen}` : `Channel ${held.channel}`
		const remote = held.code === 'REMOTE_SCREEN'
		super(remote ? `${what} is on ${held.drivenBy}: drive it there or from the master` : `${what} is driven by ${held.drivenBy} (linked servers)`)
		this.code = remote ? 'REMOTE_SCREEN' : 'AIR_HELD'
		this.statusCode = 409
		this.channel = held.channel
		this.screen = held.screen || null
		this.drivenBy = held.drivenBy
		if (remote) this.owners = Array.isArray(held.owners) ? held.owners : []
		if (refused) this.refused = refused
	}
}

const isAirHeld = (e) => !!e && (e.code === 'AIR_HELD' || e.code === 'REMOTE_SCREEN')

/** The route answer for a refusal (an AirHeldError, or the `{ channel, screen, drivenBy }` it is made from). */
function airHeldReply(e, extra) {
	const err = isAirHeld(e) ? e : new AirHeldError(e)
	const body = { error: err.message, code: err.code, drivenBy: err.drivenBy, channel: err.channel }
	if (err.owners) body.owners = err.owners
	if (err.refused) body.refused = err.refused
	return { status: 409, headers: JSON_HEADERS, body: jsonBody({ ...body, ...(extra || {}) }) }
}

/** `{ send, refused: [{ line, channel, screen, drivenBy }] }` — never throws (no replication module = send all). */
function partitionLines(ctx, lines) {
	try {
		return require('./amcp-fanout').partitionAirHeld(ctx, lines)
	} catch {
		return { send: [...lines], refused: [] }
	}
}

/**
 * Runs `run(lines)` with the held lines taken out (B4). Nothing held → `run(lines)` unchanged. All held → rejects
 * AirHeldError. Some held → the rest runs and its result carries `refused` and `okAll: false`.
 * @param {object} connection AMCP connection context (config, log)
 * @param {string[]} lines
 * @param {(lines: string[]) => Promise<object>} run
 */
function withAirGate(connection, lines, run) {
	const { send, refused } = partitionLines(connection, lines)
	if (!refused.length) return run(lines)
	connection?.log?.('info', `[cluster] ${refused.length} program line(s) refused: ${refused[0].drivenBy} drives that screen (WO-1029)`)
	if (!send.length) return Promise.reject(new AirHeldError(refused[0], refused))
	return run(send).then((r) => ({ ...(r || {}), okAll: false, refused }))
}

module.exports = { AirHeldError, isAirHeld, airHeldReply, withAirGate, partitionLines }
