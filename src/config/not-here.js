'use strict'

/**
 * WO-1029 plan 07 (C1b) — THE convention for "this screen is not on this server" (a HOLE in the channel map while
 * `cluster.channelsWhereCabled` is on; config/screen-channels.js).
 *
 * One shape, thrown: an engine call asked to act on ONE screen that has no channel here throws
 *
 *     Error { message: 'Screen <n> is not on this server', code: 'NOT_HERE', status: 409, screenIdx: <0-based> }
 *
 * built by `notHereError(screenIdx)` and recognised by `isNotHere(err)`. A route maps it to HTTP 409
 * `{ error, code: 'NOT_HERE', screenIdx }` (C1c; the dest.* relay replaces the 409 later, C6). It is never swallowed
 * into "use another screen's channel".
 *
 * Loops over screens ("all screens": FTB all, test card, zoom feeds, timeline sets, meters …) do NOT throw: they
 * visit `localScreens(map)` only — a hole is simply not part of "all" here.
 *
 * Flag off: no hole can exist, so nothing here is ever thrown.
 */

const NOT_HERE = 'NOT_HERE'

/** @param {number} screenIdx 0-based main screen index */
function notHereError(screenIdx) {
	const idx = Number(screenIdx)
	const e = new Error(`Screen ${Number.isInteger(idx) ? idx + 1 : '?'} is not on this server`)
	e.code = NOT_HERE
	e.status = 409
	e.screenIdx = Number.isInteger(idx) ? idx : null
	return e
}

const isNotHere = (e) => !!e && e.code === NOT_HERE

module.exports = { NOT_HERE, notHereError, isNotHere }
