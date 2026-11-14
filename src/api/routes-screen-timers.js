/**
 * routes-screen-timers.js — Panel-owned screen timer control API (WO-210).
 *
 * Endpoints (all under /api/timers):
 *
 *   GET  /api/timers/list           — enumerate assigned timers + runtime state
 *   GET  /api/timers/fonts          — font families installed on this machine (what the template can render)
 *   POST /api/timers/assign         — assign timer to screen at lowest free slot (980-989 band)
 *   POST /api/timers/unassign       — unassign timer from screen
 *   POST /api/timers/visible        — toggle visibility (MIXER OPACITY 0/1)
 *   POST /api/timers/bus            — move a timer to the screen's preview (`prv`) or program (`pgm`) channel
 *   POST /api/timers/cmd            — issue command (start|pause|reset) to all assigned screens
 *
 * Self-heal on CG UPDATE failure (403 — producer lost): re-ADD from registry, retry once.
 */

'use strict'

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const screenTimers = require('../engine/screen-timers')
const timerClock = require('../engine/screen-timer-clock')
const { getChannelMap } = require('../config/routing')
const { notHereFor } = require('./screen-not-here') // WO-1029 plan 07 C1c

/** CG sub-layer index for consistency with scene take. */
const CG_SUBLAYER = 0

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
 * Resolve a screen's program (default) or preview channel using routing.
 * @param {number} screenIdx — 0-based screen index
 * @param {object} ctx
 * @param {'pgm'|'prv'} [bus]
 * @returns {number} channel number, or null if invalid (a screen without a preview bus has no `prv` channel)
 */
function resolveChannelFromScreenIdx(screenIdx, ctx, bus) {
	if (!Number.isFinite(screenIdx) || screenIdx < 0) return null

	try {
		const routeMap = getChannelMap(ctx.config || {}, ctx.switcherOutputBusByChannel)
		if (!routeMap || !routeMap.programCh) return null

		// programCh / previewCh are 1-indexed: programCh(1) is the first screen
		const ch = bus === 'prv' ? routeMap.previewCh?.(screenIdx + 1) : routeMap.programCh(screenIdx + 1)
		return Number.isFinite(ch) ? ch : null
	} catch {
		return null
	}
}

let _fonts = { at: 0, list: [] }
/**
 * Font families installed on THIS machine (fontconfig) — the timer template is rendered here by Caspar's CEF, so a
 * family that is not installed silently falls back to the default sans ("most fonts come back to Arial", owner 14.11).
 * Cached 60 s: a font installed while the server runs shows up without a restart.
 * @returns {string[]}
 */
function installedFonts(deps = {}) {
	const now = Date.now()
	if (!deps.run && now - _fonts.at < 60000) return _fonts.list
	let out = ''
	try {
		out = (deps.run || ((cmd, args) => require('child_process').execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 })))('fc-list', [':', 'family'])
	} catch {
		out = ''
	}
	// a line may hold aliases ("Nimbus Sans,Nimbus Sans L") — the first is the family name
	const list = [...new Set(String(out).split('\n').map((l) => l.split(',')[0].trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
	if (!deps.run) _fonts = { at: now, list }
	return list
}

/**
 * GET handler — enumerate timers.
 * @param {string} p
 * @param {object} ctx
 * @returns {object | null}
 */
function handleGet(p, ctx) {
	if (p === '/api/timers/fonts') return { status: 200, headers: JSON_HEADERS, body: jsonBody({ ok: true, fonts: installedFonts() }) }
	if (p !== '/api/timers/list') return null

	const timers = screenTimers.listScreenTimers()
	// A remote client (Companion, possibly on a different machine with a skewed clock) must
	// never subtract ITS OWN Date.now() from a `cmdAt` written by THIS server's clock — that
	// bakes clock drift straight into the displayed countdown. `serverNowMs` lets a client
	// measure the offset between the two clocks at poll time and correct for it instead.
	return {
		status: 200,
		headers: JSON_HEADERS,
		body: jsonBody({ ok: true, timers, serverNowMs: Date.now() }),
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
	const m = p.match(/^\/api\/timers\/(assign|unassign|visible|bus|cmd)$/)
	if (!m) return null

	const b = parseBody(body)
	const cmd = m[1]
	let result

	if (cmd !== 'cmd' && Number.isFinite(b.screenIdx)) {
		const nh = await notHereFor(ctx, { screenIdx: b.screenIdx }) // WO-1029 C1c: a screen of another server has no channel here
		if (nh) return nh
	}
	if (cmd === 'assign') {
		result = await handleAssign(b, ctx)
	} else if (cmd === 'unassign') {
		result = handleUnassign(b, ctx)
	} else if (cmd === 'visible') {
		result = handleVisible(b, ctx)
	} else if (cmd === 'bus') {
		result = handleBus(b, ctx)
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

		// a timer parked on the preview channel is updated there, not re-created on program
		const on = screenTimers.listScreenTimers().find((r) => r.timerId === timerId)?.screens?.[String(screenIdx)]
		const channel = resolveChannelFromScreenIdx(screenIdx, ctx, on?.bus === 'prv' ? 'prv' : 'pgm')
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
 * POST /api/timers/bus — park a timer on the screen's preview channel to prepare it, or send it (back) to program.
 * @param {{timerId: string, screenIdx: number, bus: 'pgm'|'prv'}} body
 * @param {object} ctx
 * @returns {object}
 */
function handleBus(body, ctx) {
	try {
		const { timerId, screenIdx, bus } = body
		if (!timerId) return { ok: false, error: 'timerId required' }
		if (!Number.isFinite(screenIdx)) return { ok: false, error: 'screenIdx required' }
		if (bus !== 'pgm' && bus !== 'prv') return { ok: false, error: 'bus must be pgm or prv' }
		const channel = resolveChannelFromScreenIdx(screenIdx, ctx, bus)
		if (channel === null) return { ok: false, error: bus === 'prv' ? 'This screen has no preview channel' : `Invalid screenIdx: ${screenIdx}` }
		const { layer, lines } = screenTimers.moveTimerBus({ timerId, screenIdx, bus, channel })
		if (lines.length > 0 && ctx.amcp && typeof ctx.amcp.batchSendChunked === 'function') {
			ctx.amcp.batchSendChunked(lines, { skipMixerPreCommit: true }).catch((e) => {
				if (typeof ctx.log === 'function') ctx.log('warn', `[screen-timers] bus move failed: ${e?.message || e}`)
			})
		}
		return { ok: true, timerId, screenIdx, bus, channel, layer }
	} catch (e) {
		return { ok: false, error: e?.message || String(e) }
	}
}

/**
 * POST /api/timers/visible
 *
 * WO-226 T226.1: optional `fadeFrames` (int 0-500, default 0) — when > 0 the emitted MIXER
 * line carries a fade duration + tween instead of an instant cut. Validated here so a bad
 * value never reaches the (still band-guarded) engine.
 *
 * Optional `opacity` (0-1): on-air opacity used while visible, persisted per screen entry
 * (inspector layer-opacity slider).
 *
 * @param {{timerId: string, screenIdx: number, visible: boolean, fadeFrames?: number, opacity?: number}} body
 * @param {object} ctx
 * @returns {object}
 */
function handleVisible(body, ctx) {
	try {
		const { timerId, screenIdx, visible, fadeFrames, opacity } = body

		if (!timerId) return { ok: false, error: 'timerId required' }
		if (!Number.isFinite(screenIdx)) return { ok: false, error: 'screenIdx required' }
		if (typeof visible !== 'boolean') return { ok: false, error: 'visible must be boolean' }

		let frames = 0
		if (fadeFrames !== undefined && fadeFrames !== null) {
			if (!Number.isFinite(fadeFrames) || !Number.isInteger(fadeFrames) || fadeFrames < 0 || fadeFrames > 500) {
				return { ok: false, error: 'fadeFrames must be an integer 0-500' }
			}
			frames = fadeFrames
		}

		let opacityVal
		if (opacity !== undefined && opacity !== null) {
			if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
				return { ok: false, error: 'opacity must be a number 0-1' }
			}
			opacityVal = opacity
		}

		const { lines } = screenTimers.setTimerVisible({ timerId, screenIdx, visible, fadeFrames: frames, opacity: opacityVal })

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

		return { ok: true, timerId, screenIdx, visible, fadeFrames: frames }
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

		const before = screenTimers.listScreenTimers().find((r) => r.timerId === timerId)
		// Start on a timer that is already running does not restart the record: the template ignores it too, so the
		// panels jumped back to the full time while the screen kept counting. It re-states the count instead (below).
		const alreadyRunning = cmd === 'start' && before?.lastCmd === 'start' && timerClock.isDurationMode(before)
		if (cmd === 'pause') {
			// FIX-5 (2026-07-15 review, timers finding 3): the true frozen remaining time is computed server-side,
			// BEFORE recording the pause, so the client mirror and a later 'start' resume use it.
			screenTimers.recordTimerPause(timerId, before ? timerClock.remainingNow(before) : 0)
		} else if (!alreadyRunning) {
			screenTimers.recordTimerCmd(timerId, cmd)
		}

		// Get the timer record to find all assigned screens
		const timers = screenTimers.listScreenTimers()
		const record = timers.find((r) => r.timerId === timerId)
		if (!record || !record.screens || Object.keys(record.screens).length === 0) {
			return { ok: false, error: `Timer ${timerId} not assigned to any screens` }
		}

		// CG UPDATE payload — a duration 'start' always names the seconds to count from (the paused value, the
		// full duration, or where a running timer is now), so the screen never starts from its own idea of them.
		const payload = JSON.stringify(
			cmd === 'start' && timerClock.isDurationMode(record) ? { cmd, remainingSec: timerClock.remainingNow(record) } : { cmd },
		)

		// Send updates to all assigned screens
		let healed = false
		const failedScreens = []

		for (const [screenIdxStr, screenEntry] of Object.entries(record.screens)) {
			const { channel, layer } = screenEntry

			// WO-219 band guard (review 2026-07-15: this path was missed) — timer commands may
			// NEVER target layers outside the timer band, even from a corrupted registry record.
			if (!isTimerLayer(layer)) {
				failedScreens.push({ screenIdx: screenIdxStr, error: `BAND VIOLATION: layer ${layer}` })
				continue
			}

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

module.exports = { handleGet, handlePost, installedFonts }
