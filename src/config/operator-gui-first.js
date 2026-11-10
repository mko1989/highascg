'use strict'

/**
 * WO-868 — "Operator GUI first": ONE machine-local switch (`casparServer.operator_gui_first`, default off) that makes the
 * operator GUI Caspar channel 1 (every other channel moves up by one: 2-3 PGM1/PRV1, 4-5 PGM2/PRV2 …) and puts the
 * operator monitor at x=0 (the screens follow it to the right). Screen numbers (`program_N`, `screen_N_*`,
 * `mainScreenIndex`) never change; only Caspar channel numbers and X positions do.
 *
 * Off (or the key absent) is exactly the legacy numbering and layout. The flag is read from the nested app config
 * (`casparServer.operator_gui_first`) and from the flat generator config (top-level `operator_gui_first`).
 *
 * Projects store channel numbers verbatim (`route://N`), so each project file carries the scheme it was written in:
 * `channelScheme: 'operator-first-v1'` while the switch is on, no key (= legacy) while it is off.
 * src/engine/project-channel-scheme.js converts between the two.
 */

const { channelsWhereCabledEnabled, localScreens, screenChannels } = require('./screen-channels')
const { notHereError } = require('./not-here')

const CHANNEL_SCHEME_FIRST = 'operator-first-v1'
const CHANNEL_SCHEME_LEGACY = 'legacy'
const FLAG_KEY = 'operator_gui_first'

/** @param {unknown} v */
function truthy(v) {
	return v === true || v === 'true' || v === 1 || v === '1'
}

/**
 * @param {object | null | undefined} config app config (nested casparServer) or flat generator config
 * @returns {boolean}
 */
function isOperatorGuiFirst(config) {
	if (!config || typeof config !== 'object') return false
	const cs = config.casparServer && typeof config.casparServer === 'object' ? config.casparServer : null
	if (cs && Object.prototype.hasOwnProperty.call(cs, FLAG_KEY)) return truthy(cs[FLAG_KEY])
	return truthy(config[FLAG_KEY])
}

/**
 * Shallow copy of an app config with the flag set (true) or removed (false — absent is the legacy default, so the
 * off state never adds a key anywhere).
 * @param {object} config
 * @param {boolean} on
 */
function withOperatorGuiFirst(config, on) {
	const cs = { ...((config && config.casparServer) || {}) }
	if (on) cs[FLAG_KEY] = true
	else delete cs[FLAG_KEY]
	const next = { ...(config || {}), casparServer: cs }
	if (!on && Object.prototype.hasOwnProperty.call(next, FLAG_KEY)) delete next[FLAG_KEY]
	return next
}

/** @param {object} config */
function channelSchemeFor(config) {
	return isOperatorGuiFirst(config) ? CHANNEL_SCHEME_FIRST : CHANNEL_SCHEME_LEGACY
}

/**
 * The channel a request without an explicit `channel` means: PGM of Screen 1. Off, that is the literal 1 it always
 * was; on, channel 1 is the operator GUI, so it is the first program channel of the live map.
 * @param {object | null | undefined} configOrCtx app config, or a ctx carrying `.config`
 * @returns {number}
 */
function defaultProgramChannel(configOrCtx) {
	const config = configOrCtx && typeof configOrCtx === 'object' && configOrCtx.config && typeof configOrCtx.config === 'object' ? configOrCtx.config : configOrCtx
	let map
	try {
		map = isOperatorGuiFirst(config) || channelsWhereCabledEnabled(config) ? require('./routing').getChannelMap(config) : null
	} catch {
		map = null
	}
	/* WO-1029 C1b: while holes can exist, "PGM of Screen 1" is the FIRST SCREEN ON THIS SERVER (said explicitly);
	 * none here → NOT_HERE (never 1: that is the operator GUI, nor another box's screen). */
	if (map?.channelsWhereCabled === true) {
		const first = localScreens(map)[0]
		if (first == null) throw notHereError(0)
		return screenChannels(map, first).pgm
	}
	if (!isOperatorGuiFirst(config) || !map) return 1
	const ch = parseInt(String(screenChannels(map, 0).pgm ?? ''), 10)
	return Number.isFinite(ch) && ch >= 1 ? ch : 1
}

module.exports = {
	defaultProgramChannel,
	CHANNEL_SCHEME_FIRST,
	CHANNEL_SCHEME_LEGACY,
	isOperatorGuiFirst,
	withOperatorGuiFirst,
	channelSchemeFor,
}
