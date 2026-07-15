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
	const obj = {}
	for (const [timerId, record] of _registry) {
		obj[timerId] = record
	}
	persistence.set('screenTimers', obj)
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
	const isNewRecord = !record

	// Check if already assigned to this screen
	if (record && record.screens && record.screens[String(screenIdx)]) {
		const existing = record.screens[String(screenIdx)]
		if (existing.channel === channel) {
			// Re-assign to same screen: merge config and emit CG UPDATE
			if (name !== undefined) record.name = name
			if (config !== undefined) {
				record.config = { ...record.config, ...config }
			}

			const lines = []
			const cgPayload = {
				...record.config,
			}
			// CG UPDATE with new config JSON payload
			lines.push(`CG ${channel}-${existing.layer} UPDATE ${CG_SUBLAYER} ${param(JSON.stringify(cgPayload))}`)

			_persistRegistry()

			return {
				layer: existing.layer,
				lines,
			}
		}
	}

	// Allocate a slot
	const slot = _findLowestFreeSlot(channel)
	if (slot < 0) {
		throw new Error(`All slots occupied on channel ${channel}`)
	}
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
	record.screens[String(screenIdx)] = {
		channel,
		layer,
		visible: true,
	}

	const lines = []

	// CG ADD line with JSON config payload
	const cgPayload = {
		...record.config,
	}
	lines.push(`CG ${channel}-${layer} ADD ${CG_SUBLAYER} ${COUNTDOWN_CG_NAME} 1 ${param(JSON.stringify(cgPayload))}`)

	// MIXER OPACITY 1 (visible on add)
	lines.push(`MIXER ${channel}-${layer} OPACITY 1`)

	_persistRegistry()

	return { layer, lines }
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
 * @param {{timerId: string, screenIdx: number, visible: boolean}} opts
 * @returns {{ lines: string[] }}
 */
function setTimerVisible(opts) {
	const { timerId, screenIdx, visible } = opts || {}
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

	// Update visibility in registry
	screenEntry.visible = visible

	const opacity = visible ? 1 : 0
	const lines = [`MIXER ${channel}-${layer} OPACITY ${opacity}`]

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

	let record = _registry.get(timerId)
	if (!record) {
		// Create minimal record if not exists
		record = {
			timerId,
			name: '',
			config: {},
			lastCmd: null,
			cmdAt: null,
			remainingSec: null,
			screens: {},
		}
		_registry.set(timerId, record)
	}

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

	let record = _registry.get(timerId)
	if (!record) {
		record = {
			timerId,
			name: '',
			config: {},
			lastCmd: null,
			cmdAt: null,
			remainingSec: null,
			screens: {},
		}
		_registry.set(timerId, record)
	}

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

	const result = []
	for (const record of _registry.values()) {
		// Deep copy to prevent external mutations
		result.push(JSON.parse(JSON.stringify(record)))
	}
	return result
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

			// CG ADD line with JSON config payload
			const cgPayload = { ...record.config }
			lines.push(`CG ${screenEntry.channel}-${screenEntry.layer} ADD ${CG_SUBLAYER} ${COUNTDOWN_CG_NAME} 1 ${param(JSON.stringify(cgPayload))}`)

			// MIXER OPACITY based on visible flag
			const opacity = screenEntry.visible ? 1 : 0
			lines.push(`MIXER ${screenEntry.channel}-${screenEntry.layer} OPACITY ${opacity}`)
		}
	}

	return lines
}

/**
 * Apply timersVisibility map for a look take: for each assigned timer on the given channel
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

			const opacity = visible ? 1 : 0
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
	setTimerVisible,
	recordTimerCmd,
	recordTimerPause,
	listScreenTimers,
	linesForReAdd,
	linesForLookVisibility,
}
