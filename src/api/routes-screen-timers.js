/**
 * routes-screen-timers.js — Panel-owned screen timer control API (WO-210).
 *
 * Endpoints (all under /api/timers):
 *
 *   GET  /api/timers/list           — enumerate assigned timers + runtime state
 *   POST /api/timers/assign         — assign timer to screen at lowest free slot (980-989 band)
 *   POST /api/timers/unassign       — unassign timer from screen
 *   POST /api/timers/visible        — toggle visibility (MIXER OPACITY 0/1)
 *   POST /api/timers/cmd            — issue command (start|pause|reset) to all assigned screens
 *
 * Self-heal on CG UPDATE failure (403 — producer lost): re-ADD from registry, retry once.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const screenTimers = require('../engine/screen-timers')
const { getChannelMap } = require('../config/routing')

/** CG sub-layer index for consistency with scene take. */
const CG_SUBLAYER = 0

/** Caspar CG template path. */
const COUNTDOWN_CG_NAME = 'countdown/countdown'

/** Band guard: timers must use layers 980-989 only */
const TIMER_LAYER_MIN = 980
const TIMER_LAYER_MAX = 989

/**
 * Validate that a layer is within the timer band.
 * @param {number} layer
 * @returns {boolean}
 */
function isTimerLayer(layer) {
	return Number.isFinite(layer) && layer >= TIMER_LAYER_MIN && layer <= TIMER_LAYER_MAX
}

/**
 * Resolve program channel from screenIdx using routing.
 * @param {number} screenIdx — 0-based screen index
 * @param {object} ctx
 * @returns {number} program channel number, or null if invalid
 */
function resolveChannelFromScreenIdx(screenIdx, ctx) {
	if (!Number.isFinite(screenIdx) || screenIdx < 0) return null

	try {
		const routeMap = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
		if (!routeMap || !routeMap.programCh) return null

		// programCh is 1-indexed: programCh(1) is the first screen
		const ch = routeMap.programCh(screenIdx + 1)
		return Number.isFinite(ch) ? ch : null
	} catch {
		return null
	}
}

/**
 * GET handler — enumerate timers.
 * @param {string} p
 * @param {object} ctx
 * @returns {object | null}
 */
function handleGet(p, ctx) {
	if (p !== '/api/timers/list') return null

	const timers = screenTimers.listScreenTimers()
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, timers }),
	}
}

/**
 * POST handler — dispatch based on path.
 * @param {string} p
 * @param {string|object} body
 * @param {object} ctx
 * @returns {Promise<object | null>}
 */
async function handlePost(p, body, ctx) {
	const m = p.match(/^\/api\/timers\/(assign|unassign|visible|cmd)$/)
	if (!m) return null

	const b = parseBody(body)
	const cmd = m[1]
	let result

	if (cmd === 'assign') {
		result = await handleAssign(b, ctx)
	} else if (cmd === 'unassign') {
		result = handleUnassign(b, ctx)
	} else if (cmd === 'visible') {
		result = handleVisible(b, ctx)
	} else if (cmd === 'cmd') {
		result = await handleCmd(b, ctx)
	} else {
		result = { ok: false, error: 'Unknown command' }
	}

	return {
		status: result.ok ? 200 : 400,
		headers: JSON_HEADERS,
		body: jsonBody(result),
	}
}

/**
 * POST /api/timers/assign
 * @param {{timerId: string, name?: string, config?: object, screenIdx: number}} body
 * @param {object} ctx
 * @returns {object}
 */
function handleAssign(body, ctx) {
	try {
		const { timerId, name, config, screenIdx } = body

		if (!timerId) return { ok: false, error: 'timerId required' }
		if (!Number.isFinite(screenIdx)) return { ok: false, error: 'screenIdx required' }

		const channel = resolveChannelFromScreenIdx(screenIdx, ctx)
		if (channel === null) return { ok: false, error: `Invalid screenIdx: ${screenIdx}` }

		const { layer, lines } = screenTimers.assignTimerToScreen({
			timerId,
			name,
			config,
			screenIdx,
			channel,
		})

		// Band guard: validate layer before sending
		if (!isTimerLayer(layer)) {
			const msg = `[screen-timers] BAND VIOLATION: assign produced layer ${layer} outside 980-989`
			if (typeof ctx.log === 'function') ctx.log('warn', msg)
			return { ok: false, error: msg }
		}

		// Send AMCP lines
		if (lines.length > 0) {
			if (ctx.amcp && typeof ctx.amcp.batchSendChunked === 'function') {
				// Use batch send for multiple lines
				ctx.amcp.batchSendChunked(lines, { skipMixerPreCommit: true }).catch((e) => {
					if (typeof ctx.log === 'function') {
						ctx.log('warn', `[screen-timers] assign batch failed: ${e?.message || e}`)
					}
				})
			}
		}

		return { ok: true, layer, screenIdx, channel }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

/**
 * POST /api/timers/unassign
 * @param {{timerId: string, screenIdx: number}} body
 * @param {object} ctx
 * @returns {object}
 */
function handleUnassign(body, ctx) {
	try {
		const { timerId, screenIdx } = body

		if (!timerId) return { ok: false, error: 'timerId required' }
		if (!Number.isFinite(screenIdx)) return { ok: false, error: 'screenIdx required' }

		const { lines } = screenTimers.unassignTimer({ timerId, screenIdx })

		// Send AMCP lines
		if (lines.length > 0) {
			if (ctx.amcp && typeof ctx.amcp.raw === 'function') {
				// Use raw send for single line (CG CLEAR)
				for (const line of lines) {
					ctx.amcp.raw(line).catch((e) => {
						if (typeof ctx.log === 'function') {
							ctx.log('warn', `[screen-timers] unassign clear failed: ${e?.message || e}`)
						}
					})
				}
			}
		}

		return { ok: true, timerId, screenIdx }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

/**
 * POST /api/timers/visible
 * @param {{timerId: string, screenIdx: number, visible: boolean}} body
 * @param {object} ctx
 * @returns {object}
 */
function handleVisible(body, ctx) {
	try {
		const { timerId, screenIdx, visible } = body

		if (!timerId) return { ok: false, error: 'timerId required' }
		if (!Number.isFinite(screenIdx)) return { ok: false, error: 'screenIdx required' }
		if (typeof visible !== 'boolean') return { ok: false, error: 'visible must be boolean' }

		const { lines } = screenTimers.setTimerVisible({ timerId, screenIdx, visible })

		// Send AMCP lines
		if (lines.length > 0) {
			if (ctx.amcp && typeof ctx.amcp.raw === 'function') {
				// Use raw send for single line (MIXER OPACITY)
				for (const line of lines) {
					ctx.amcp.raw(line).catch((e) => {
						if (typeof ctx.log === 'function') {
							ctx.log('warn', `[screen-timers] visible update failed: ${e?.message || e}`)
						}
					})
				}
			}
		}

		return { ok: true, timerId, screenIdx, visible }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

/**
 * POST /api/timers/cmd
 * Issue a command (start|pause|reset) to all assigned screens for a timer.
 * If CG UPDATE fails with 403, self-heal: re-ADD and retry once.
 *
 * @param {{timerId: string, cmd: string}} body
 * @param {object} ctx
 * @returns {Promise<object>}
 */
async function handleCmd(body, ctx) {
	try {
		const { timerId, cmd } = body

		if (!timerId) return { ok: false, error: 'timerId required' }
		if (!cmd || typeof cmd !== 'string') return { ok: false, error: 'cmd required (start|pause|reset)' }

		if (!['start', 'pause', 'reset'].includes(cmd)) {
			return { ok: false, error: `Invalid cmd: ${cmd}` }
		}

		// Record the command in the registry
		screenTimers.recordTimerCmd(timerId, cmd)

		// Get the timer record to find all assigned screens
		const timers = screenTimers.listScreenTimers()
		const record = timers.find((r) => r.timerId === timerId)
		if (!record || !record.screens || Object.keys(record.screens).length === 0) {
			return { ok: false, error: `Timer ${timerId} not assigned to any screens` }
		}

		// Prepare CG UPDATE payload
		const payload = JSON.stringify({ cmd })

		// Send updates to all assigned screens
		let healed = false
		const failedScreens = []

		for (const [screenIdxStr, screenEntry] of Object.entries(record.screens)) {
			const { channel, layer } = screenEntry

			try {
				// First attempt: CG UPDATE
				await ctx.amcp.cg.cgUpdate(channel, layer, CG_SUBLAYER, payload)
			} catch (e) {
				const errMsg = e?.message || String(e)

				// Check if it's a 403 (producer lost)
				if (errMsg.includes('403') || errMsg.includes('producer')) {
					// Self-heal: re-ADD the timer
					try {
						const reAddLines = screenTimers.linesForReAdd(channel).filter(
							(line) => line.includes(`${channel}-${layer}`)
						)

						if (reAddLines.length > 0 && ctx.amcp && typeof ctx.amcp.batchSendChunked === 'function') {
							await ctx.amcp.batchSendChunked(reAddLines, { skipMixerPreCommit: true })
							healed = true
						}

						// Retry the UPDATE once
						await ctx.amcp.cg.cgUpdate(channel, layer, CG_SUBLAYER, payload)
					} catch (retryErr) {
						failedScreens.push({
							screenIdx: parseInt(screenIdxStr, 10),
							channel,
							layer,
							error: retryErr?.message || String(retryErr),
							healed: true,
						})

						if (typeof ctx.log === 'function') {
							ctx.log(
								'warn',
								`[screen-timers] cmd ${cmd} healed retry failed ch=${channel} layer=${layer}: ${retryErr?.message || retryErr}`,
							)
						}
					}
				} else {
					failedScreens.push({
						screenIdx: parseInt(screenIdxStr, 10),
						channel,
						layer,
						error: errMsg,
						healed: false,
					})

					if (typeof ctx.log === 'function') {
						ctx.log(
							'warn',
							`[screen-timers] cmd ${cmd} failed ch=${channel} layer=${layer}: ${errMsg}`,
						)
					}
				}
			}
		}

		if (failedScreens.length > 0) {
			return {
				ok: false,
				error: `Command failed on ${failedScreens.length} screen(s)`,
				timerId,
				cmd,
				failed: failedScreens,
				healed,
			}
		}

		return { ok: true, timerId, cmd, healed }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

module.exports = { handleGet, handlePost }
