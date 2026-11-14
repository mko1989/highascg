/**
 * Screen timers — countdown CG templates owned by corner panel, not look layers (WO-210).
 *
 * Countdown templates are assigned to screens via the panel; a timer lives on layer 980+slot
 * per channel (band 980-989, below global border 998, above PIP ≤979). On/off = MIXER OPACITY,
 * never CLEAR (the producer persists until explicitly unassigned). Server registry is the
 * source of truth and is restored (re-ADD) on startup/reconnect.
 *
 * Band contract: 980-989 is reserved for screen timers. This band is NOT part of look layers
 * (which use 10-99 and 110-199 per look-layer-ranges.js isLookPhysicalLayer). Scene exit layers
 * and orphan sweeps never touch this band, so timers persist across takes and scene transitions.
 *
 * Pure model + persistence — all functions return AMCP line arrays; callers emit them.
 */

'use strict'

const persistence = require('../utils/persistence')
const { param } = require('../caspar/amcp-utils')
const clock = require('./screen-timer-clock')

/** Caspar CG template path — see template/countdown/countdown.html. */
const COUNTDOWN_CG_NAME = '"countdown/countdown"' // slash-containing template names must be quoted in AMCP (cf. scene-template-cg.js tpl)

/** CG sub-layer index (scene take always uses sublayer 0; screen timers use it too for consistency). */
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
 * Module-level registry: { timerId → { timerId, name, config, lastCmd, cmdAt, screens } }
 * Each screen entry: { [screenIdx] → { channel, layer, visible } }
 * @type {Map<string, object> | null}
 */
let _registry = null

/**
 * Load or reload the registry from persistence.
 * @returns {Map<string, object>}
 */
function loadRegistry() {
	if (_registry !== null) return _registry
	const stored = persistence.get('screenTimers')
	_registry = new Map()
	if (stored && typeof stored === 'object') {
		for (const [timerId, record] of Object.entries(stored)) {
			if (record && typeof record === 'object') {
				_registry.set(timerId, { ...record })
			}
		}
	}
	return _registry
}

/**
 * Persist the registry to disk.
 */
function _persistRegistry() {
	if (_registry === null) return
	persistence.set('screenTimers', Object.fromEntries(_registry))
}

/** The record for a timer id, created empty when a command arrives before any assign. */
function _ensureRecord(timerId) {
	let record = _registry.get(timerId)
	if (!record) {
		record = { timerId, name: '', config: {}, lastCmd: null, cmdAt: null, remainingSec: null, screens: {} }
		_registry.set(timerId, record)
	}
	return record
}

/**
 * CG ADD + MIXER OPACITY for one screen entry. The payload carries the record's count (running / paused), so a
 * fresh template instance — restart, cleared preview channel, PGM ↔ PRV move — shows what the panels show.
 */
function _addLines(record, entry) {
	const payload = { ...record.config, ...clock.resumeFields(record) }
	const opacity = entry.visible ? (Number.isFinite(entry.opacity) ? entry.opacity : 1) : 0
	return [
		`CG ${entry.channel}-${entry.layer} ADD ${CG_SUBLAYER} ${COUNTDOWN_CG_NAME} 1 ${param(JSON.stringify(payload))}`,
		`MIXER ${entry.channel}-${entry.layer} OPACITY ${opacity}`,
	]
}

/**
 * Find the lowest available slot (0-9) on a channel that is not in use.
 * @param {number} channel
 * @returns {number} slot 0-9, or -1 if all slots occupied
 */
function _findLowestFreeSlot(channel) {
	const usedSlots = new Set()
	for (const record of _registry.values()) {
		if (!record.screens || typeof record.screens !== 'object') continue
		for (const screenEntry of Object.values(record.screens)) {
			if (screenEntry && screenEntry.channel === channel && Number.isFinite(screenEntry.layer)) {
				const slot = screenEntry.layer - 980
				if (slot >= 0 && slot <= 9) usedSlots.add(slot)
			}
		}
	}
	for (let slot = 0; slot <= 9; slot++) {
		if (!usedSlots.has(slot)) return slot
	}
	return -1
}

/**
 * Assign a timer to a screen at the lowest available slot.
 * If already assigned to the same screen, updates config and emits CG UPDATE.
 *
 * @param {{timerId: string, name?: string, config?: object, screenIdx: number, channel: number}} opts
 * @returns {{ layer: number, lines: string[] }}
 */
function assignTimerToScreen(opts) {
	const { timerId, name, config, screenIdx, channel } = opts || {}
	if (!timerId) throw new Error('timerId required')
	if (!Number.isFinite(channel)) throw new Error('channel required')
	if (!Number.isFinite(screenIdx)) throw new Error('screenIdx required')

	loadRegistry()

	let record = _registry.get(timerId)

	// Check if already assigned to this screen
	if (record && record.screens && record.screens[String(screenIdx)]) {
		const existing = record.screens[String(screenIdx)]
		if (existing.channel === channel) {
			// Re-assign to same screen: merge config and emit CG UPDATE
			if (name !== undefined) record.name = name
			const prevDurationSec = Number(record.config?.durationSec)
			if (config !== undefined) {
				record.config = { ...record.config, ...config }
			}

			// A duration change must land on the LIVE countdown now, not just seed the next Start, or a running/overrun
			// timer keeps ticking from its stale anchor. WO-601: only a CHANGED one — every settings save re-sends the
			// whole config (saveTimerConfigPatch), which restarted running timers and reset paused ones.
			const changingDuration = config && Object.prototype.hasOwnProperty.call(config, 'durationSec') &&
				Number(config.durationSec) !== prevDurationSec && (record.config.mode || 'duration') === 'duration'
			if (changingDuration && record.lastCmd === 'start') {
				record.cmdAt = Date.now()
				record.remainingSec = null
			} else if (changingDuration && record.lastCmd === 'pause') {
				record.remainingSec = Number(record.config.durationSec) || 0
			}

			const lines = []
			// Every update re-states the record's count (running: start from where it is now; paused: the frozen
			// value), so a screen that drifted from the record — or lost its producer — is pulled back onto it.
			const cgPayload = { ...record.config, ...clock.resumeFields(record) }
			// The template re-anchors a running countdown on ANY payload that carries durationSec — so an unchanged one
			// stays out, or moving / restyling a timer on air restarts it on screen while the record keeps counting.
			if (!changingDuration) delete cgPayload.durationSec
			lines.push(`CG ${channel}-${existing.layer} UPDATE ${CG_SUBLAYER} ${param(JSON.stringify(cgPayload))}`)

			_persistRegistry()

			return { layer: existing.layer, lines }
		}
	}

	// Allocate a slot
	const slot = _findLowestFreeSlot(channel)
	if (slot < 0) throw new Error(`All slots occupied on channel ${channel}`)
	const layer = 980 + slot

	// Create or update record
	if (!record) {
		record = {
			timerId,
			name: name || '',
			config: config || {},
			lastCmd: null,
			cmdAt: null,
			screens: {},
		}
		_registry.set(timerId, record)
	} else {
		// Update name/config if provided
		if (name !== undefined) record.name = name
		if (config !== undefined) record.config = config
	}

	// Add this screen to the record
	record.screens[String(screenIdx)] = { channel, layer, visible: true, ...(opts.bus === 'prv' ? { bus: 'prv' } : {}) }
	const lines = _addLines(record, record.screens[String(screenIdx)])

	_persistRegistry()

	return { layer, lines }
}

/**
 * Move a timer between a screen's program and preview channel ("send to PRV to prepare", owner 14.11): the
 * producer is cleared on the channel it is on and added on the other one with the same config, count and
 * visibility. `channel` is the target bus's channel (the route resolves it).
 *
 * @param {{timerId: string, screenIdx: number, bus: 'pgm'|'prv', channel: number}} opts
 * @returns {{ layer: number, lines: string[] }}
 */
function moveTimerBus(opts) {
	const { timerId, screenIdx, bus, channel } = opts || {}
	if (!timerId) throw new Error('timerId required')
	if (bus !== 'pgm' && bus !== 'prv') throw new Error('bus must be pgm or prv')
	if (!Number.isFinite(channel)) throw new Error('channel required')
	loadRegistry()
	const entry = _registry.get(timerId)?.screens?.[String(screenIdx)]
	if (!entry) throw new Error(`Timer ${timerId} is not on screen ${screenIdx}`)
	if (entry.channel === channel) return { layer: entry.layer, lines: [] }
	const slot = _findLowestFreeSlot(channel)
	if (slot < 0) throw new Error(`All slots occupied on channel ${channel}`)
	const lines = isTimerLayer(entry.layer) ? [`CG ${entry.channel}-${entry.layer} CLEAR`] : []
	entry.channel = channel
	entry.layer = 980 + slot
	if (bus === 'prv') entry.bus = 'prv'
	else delete entry.bus
	lines.push(..._addLines(_registry.get(timerId), entry))
	_persistRegistry()
	return { layer: entry.layer, lines }
}

/**
 * Unassign a timer from a screen.
 * If no screens remain, the entire record is deleted.
 * Band-guarded: skips entry if layer outside 980-989 range.
 *
 * @param {{timerId: string, screenIdx: number}} opts
 * @returns {{ lines: string[] }}
 */
function unassignTimer(opts) {
	const { timerId, screenIdx } = opts || {}
	if (!timerId) throw new Error('timerId required')
	if (!Number.isFinite(screenIdx)) throw new Error('screenIdx required')

	loadRegistry()

	const record = _registry.get(timerId)
	if (!record || !record.screens || !record.screens[String(screenIdx)]) {
		// Not assigned — return empty lines
		return { lines: [] }
	}

	const screenEntry = record.screens[String(screenIdx)]
	const { channel, layer } = screenEntry

	// Band guard: validate layer is within timer band
	if (!isTimerLayer(layer)) {
		console.warn(`[screen-timers] BAND VIOLATION: unassignTimer layer ${layer} outside 980-989 for timer ${timerId} screen ${screenIdx}`)
		return { lines: [] }
	}

	const lines = [`CG ${channel}-${layer} CLEAR`]

	// Remove this screen from the record
	delete record.screens[String(screenIdx)]

	// If no screens remain, delete the entire record
	const screenCount = Object.keys(record.screens).length
	if (screenCount === 0) {
		_registry.delete(timerId)
	}

	_persistRegistry()

	return { lines }
}

/**
 * Set visibility (opacity 0 or 1) for a timer on a screen.
 * Band-guarded: skips entry if layer outside 980-989 range.
 *
 * WO-226 T226.1: optional `fadeFrames` (int 0-500, default 0). When > 0, the OPACITY line
 * carries a fade duration + tween (`MIXER <ch>-<layer> OPACITY <0|1> <fadeFrames> linear`)
 * instead of the instant-cut form, so the timer inspector's Fade In / Fade Out buttons animate.
 *
 * Optional `opacity` (0-1, default keep stored / 1): the on-air opacity used when visible —
 * stored per screen entry so re-adds and look-visibility restores keep it (inspector's layer
 * opacity slider).
 *
 * @param {{timerId: string, screenIdx: number, visible: boolean, fadeFrames?: number, opacity?: number}} opts
 * @returns {{ lines: string[] }}
 */
function setTimerVisible(opts) {
	const { timerId, screenIdx, visible, fadeFrames, opacity: opacityIn } = opts || {}
	if (!timerId) throw new Error('timerId required')
	if (!Number.isFinite(screenIdx)) throw new Error('screenIdx required')
	if (typeof visible !== 'boolean') throw new Error('visible must be boolean')

	loadRegistry()

	const record = _registry.get(timerId)
	if (!record || !record.screens || !record.screens[String(screenIdx)]) {
		// Not assigned — no-op
		return { lines: [] }
	}

	const screenEntry = record.screens[String(screenIdx)]
	const { channel, layer } = screenEntry

	// Band guard: validate layer is within timer band
	if (!isTimerLayer(layer)) {
		console.warn(`[screen-timers] BAND VIOLATION: setTimerVisible layer ${layer} outside 980-989 for timer ${timerId} screen ${screenIdx}`)
		return { lines: [] }
	}

	// Update visibility (and, when given, the stored on-air opacity) in registry
	screenEntry.visible = visible
	if (Number.isFinite(opacityIn)) {
		screenEntry.opacity = Math.min(1, Math.max(0, opacityIn))
	}

	const opacity = visible ? (Number.isFinite(screenEntry.opacity) ? screenEntry.opacity : 1) : 0
	const frames =
		Number.isFinite(fadeFrames) && fadeFrames > 0 ? Math.round(Math.min(500, Math.max(0, fadeFrames))) : 0
	const lines = [
		frames > 0 ? `MIXER ${channel}-${layer} OPACITY ${opacity} ${frames} linear` : `MIXER ${channel}-${layer} OPACITY ${opacity}`,
	]

	_persistRegistry()

	return { lines }
}

/**
 * Record a command (start/pause/reset) issued to a timer.
 * Sets lastCmd and cmdAt = Date.now().
 *
 * @param {string} timerId
 * @param {string} cmd — 'start', 'pause', or 'reset'
 */
function recordTimerCmd(timerId, cmd) {
	if (!timerId) throw new Error('timerId required')

	loadRegistry()

	const record = _ensureRecord(timerId)

	record.lastCmd = cmd
	record.cmdAt = Date.now()
	// FIX-5 (2026-07-15 review, timers finding 3): 'reset' clears any frozen-pause remaining
	// value so the next 'start' begins fresh from the configured duration instead of resuming
	// a stale freeze. 'start'/other cmds intentionally leave remainingSec untouched — it stays
	// as the resume basis for computeDisplayTime / the CG resume payload until the next pause.
	if (cmd === 'reset') record.remainingSec = null

	_persistRegistry()
}

/**
 * Record a pause with the server-computed, elapsed-adjusted remaining seconds (FIX-5,
 * 2026-07-15 review, timers finding 3 — "pause shows configured duration instead of frozen
 * remaining"). Unlike `recordTimerCmd`, this also persists `remainingSec` so the client's
 * mirror display and a later 'start' resume use the true frozen value instead of snapping back
 * to the full configured duration.
 *
 * @param {string} timerId
 * @param {number} remainingSec — server-computed remaining seconds at the moment of pause
 */
function recordTimerPause(timerId, remainingSec) {
	if (!timerId) throw new Error('timerId required')

	loadRegistry()

	const record = _ensureRecord(timerId)

	record.lastCmd = 'pause'
	record.cmdAt = Date.now()
	record.remainingSec = Number.isFinite(remainingSec) ? Math.max(0, remainingSec) : null

	_persistRegistry()
}

/**
 * List all registered screen timers (deep-copy safe).
 *
 * @returns {object[]}
 */
function listScreenTimers() {
	loadRegistry()

	return [..._registry.values()].map((record) => JSON.parse(JSON.stringify(record))) // deep copy
}

/**
 * Generate CG ADD and MIXER OPACITY lines to restore registered timers on startup/reconnect.
 * Optionally filter by channel.
 * Band-guarded: skips entries if layer outside 980-989 range.
 *
 * @param {number} [channel] — optional channel filter
 * @returns {string[]}
 */
function linesForReAdd(channel) {
	loadRegistry()

	const lines = []

	for (const record of _registry.values()) {
		if (!record.screens || typeof record.screens !== 'object') continue

		for (const screenEntry of Object.values(record.screens)) {
			if (!screenEntry || !Number.isFinite(screenEntry.channel) || !Number.isFinite(screenEntry.layer)) continue

			// Band guard: validate layer is within timer band
			if (!isTimerLayer(screenEntry.layer)) {
				console.warn(`[screen-timers] BAND VIOLATION: linesForReAdd layer ${screenEntry.layer} outside 980-989 for timer ${record.timerId}`)
				continue
			}

			// Filter by channel if specified
			if (channel !== undefined && screenEntry.channel !== channel) continue

			lines.push(..._addLines(record, screenEntry))
		}
	}

	return lines
}

/**
 * Apply a look-preset item's timersVisibility map (WO-840): for each assigned timer on the given channel
 * whose timerId is a key in timersVisibility, emit MIXER OPACITY lines and update registry.
 * Timers NOT mentioned in the map are left untouched.
 * Band-guarded: skips entries if layer outside 980-989 range.
 *
 * @param {number} channel
 * @param {object|null|undefined} timersVisibility — map of { [timerId]: boolean }
 * @returns {string[]}
 */
function linesForLookVisibility(channel, timersVisibility) {
	// Return empty array for null/undefined/non-object input
	if (!timersVisibility || typeof timersVisibility !== 'object') {
		return []
	}

	loadRegistry()

	const lines = []

	for (const record of _registry.values()) {
		if (!record.screens || typeof record.screens !== 'object') continue

		// Only process if this timer's ID is a key in the visibility map
		if (!(record.timerId in timersVisibility)) continue

		for (const screenEntry of Object.values(record.screens)) {
			if (!screenEntry || !Number.isFinite(screenEntry.channel) || !Number.isFinite(screenEntry.layer)) continue

			// Band guard: validate layer is within timer band
			if (!isTimerLayer(screenEntry.layer)) {
				console.warn(`[screen-timers] BAND VIOLATION: linesForLookVisibility layer ${screenEntry.layer} outside 980-989 for timer ${record.timerId}`)
				continue
			}

			// Only emit for the specified channel
			if (screenEntry.channel !== channel) continue

			const visible = timersVisibility[record.timerId]
			if (typeof visible !== 'boolean') continue

			// Update visibility in registry
			screenEntry.visible = visible

			const opacity = visible ? (Number.isFinite(screenEntry.opacity) ? screenEntry.opacity : 1) : 0
			lines.push(`MIXER ${channel}-${screenEntry.layer} OPACITY ${opacity}`)
		}
	}

	// Persist after mutations
	_persistRegistry()

	return lines
}

module.exports = {
	loadRegistry,
	assignTimerToScreen,
	unassignTimer,
	moveTimerBus,
	setTimerVisible,
	recordTimerCmd,
	recordTimerPause,
	listScreenTimers,
	linesForReAdd,
	linesForLookVisibility,
}
