/**
 * WO-312 — replay live-input audio-only routes after a Caspar restart.
 *
 * The audio route matrix is config-persisted (`<kind>_input_<slot>_audio_targets`, 2d2e294) and
 * authoritative at take time (live-input-audio-policy.js). The route LAYERS that carry the audio
 * are not: they are AMCP state on the program channels, so they die with Caspar. Only the client
 * recreated them (a Ch button press → applyPgmRoutesForSlot), which means after a crash or an
 * apply-restart the matrix claimed "routed to Ch3" while nothing played there until an operator
 * toggled the button twice — and with the kiosk closed, never.
 *
 * This is the server-side replay, run from setupAllRouting on boot and on every reconnect.
 *
 * Scope note from the WO: ALSA `live_audio` slots keep their existing client-driven flow (their
 * targets live in localStorage, not config, so the server cannot honestly rebuild them). Only
 * kinds whose targets are config-persisted are replayed here — see POLICY_KINDS in
 * live-input-audio-policy.js. Migrating ALSA to config targets is the natural follow-up.
 */
'use strict'

const { getChannelMap } = require('../config/routing-map')
const { liveInputAudioTargets, liveInputAudioSendPolicy } = require('./live-input-audio-policy')
const {
	infoResponseToXml,
	foregroundProducerOnLayer,
	isRouteProducerFrom,
	parseRouteClip,
} = require('../caspar/channel-info-xml')

/**
 * PGM destination layer band for non-ALSA input kinds. MUST match
 * `INPUT_PGM_AUDIO_LAYER_BASE` in client/lib/live-audio-routing.js — if the two drift, the
 * server reasserts onto a layer the client does not manage and the operator gets a duplicate
 * signal it cannot turn off. A test pins the two together.
 */
const INPUT_PGM_AUDIO_LAYER_BASE = 320

/** Input kinds whose audio targets are config-persisted and therefore server-replayable. */
const REPLAYABLE_KINDS = new Set(['decklink', 'v4l2'])

/**
 * @param {string} kind
 * @param {number} slot 1-based
 */
function pgmDestLayerForInput(kind, slot) {
	return INPUT_PGM_AUDIO_LAYER_BASE + Math.max(1, parseInt(String(slot), 10) || 1)
}

/**
 * Audio-only means OPACITY 0 on the route layer — the signal is on the bus, the picture is not.
 * Mirrors the client's `liveUi.pgmAudioOnly !== false` default.
 * @param {object} config
 */
function isPgmAudioOnly(config) {
	const cs = config?.casparServer && typeof config.casparServer === 'object' ? config.casparServer : config || {}
	const v = cs.live_audio_pgm_audio_only
	return !(v === false || v === 'false' || v === 0)
}

/**
 * Pure: what SHOULD be playing, from config alone. No AMCP, no I/O.
 *
 * @param {object} config
 * @returns {Array<{kind: string, slot: number, route: string, srcChannel: number, srcLayer: number|null,
 *   channel: number, layer: number, audioOnly: boolean, policy: string}>}
 */
function buildLiveInputRouteReassertPlan(config) {
	let inputChannels = []
	try {
		inputChannels = getChannelMap(config || {})?.inputChannels || []
	} catch {
		return []
	}
	const audioOnly = isPgmAudioOnly(config)
	const out = []
	for (const entry of Array.isArray(inputChannels) ? inputChannels : []) {
		const kind = String(entry?.kind || '')
		if (!REPLAYABLE_KINDS.has(kind)) continue
		const slot = parseInt(String(entry?.slot), 10)
		if (!Number.isFinite(slot) || slot < 1) continue

		// 'never' means the input must not reach any bus — replaying its routes would be the
		// exact doubling the policy exists to prevent.
		const policy = liveInputAudioSendPolicy(config, kind, slot)
		if (policy === 'never') continue

		// The route comes from the channel map, never hardcoded (WO-312).
		const route = String(entry?.route || '').trim()
		const parsed = parseRouteClip(route)
		if (!parsed) continue

		const layer = pgmDestLayerForInput(kind, slot)
		for (const target of liveInputAudioTargets(config, kind, slot)) {
			const ch = parseInt(String(target), 10)
			if (!Number.isFinite(ch) || ch < 1) continue
			// A route must never feed the channel it is sourced from.
			if (ch === parsed.channel) continue
			out.push({
				kind,
				slot,
				route,
				srcChannel: parsed.channel,
				srcLayer: parsed.layer,
				channel: ch,
				layer,
				audioOnly,
				policy,
			})
		}
	}
	return out
}

/**
 * AMCP for one planned route. Same sequence the client uses (live-audio-routing.js
 * playRouteOnChannel): STOP and CLEAR first so a stale producer on the layer releases before the
 * new one is built.
 * @param {{channel: number, layer: number, route: string, audioOnly: boolean}} item
 * @returns {string[]}
 */
function amcpForPlannedRoute(item) {
	const cl = `${item.channel}-${item.layer}`
	const cmds = [`STOP ${cl}`, `MIXER ${cl} CLEAR`, `PLAY ${cl} ${item.route}`]
	if (item.audioOnly) cmds.push(`MIXER ${cl} OPACITY 0`)
	return cmds
}

/**
 * Replay the plan against Caspar, skipping anything already playing.
 * @param {object} self app context
 * @returns {Promise<{planned: number, played: number, alreadyPlaying: number, failed: object[], skipped?: string}>}
 */
async function reassertLiveInputAudioRoutes(self) {
	const result = { planned: 0, played: 0, alreadyPlaying: 0, failed: [] }
	if (!self?.amcp || self.amcp.isConnected === false) return { ...result, skipped: 'amcp_disconnected' }

	const plan = buildLiveInputRouteReassertPlan(self.config)
	result.planned = plan.length
	if (!plan.length) return result

	// One INFO per target channel, not per route — several inputs commonly land on one bus.
	/** @type {Map<number, string>} */
	const infoByChannel = new Map()
	for (const item of plan) {
		if (infoByChannel.has(item.channel)) continue
		try {
			infoByChannel.set(item.channel, infoResponseToXml(await self.amcp.raw(`INFO ${item.channel}`)))
		} catch {
			infoByChannel.set(item.channel, '')
		}
	}

	for (const item of plan) {
		try {
			// Idempotent: an unreadable INFO parses to null, which is UNKNOWN — fall through and
			// replay rather than assume the route is missing OR present.
			const fg = await foregroundProducerOnLayer(infoByChannel.get(item.channel) || '', item.layer)
			if (isRouteProducerFrom(fg, item.srcChannel, item.srcLayer)) {
				result.alreadyPlaying++
				continue
			}
			for (const cmd of amcpForPlannedRoute(item)) await self.amcp.raw(cmd)
			result.played++
		} catch (e) {
			result.failed.push({
				kind: item.kind,
				slot: item.slot,
				channel: item.channel,
				layer: item.layer,
				message: e?.message || String(e),
			})
		}
	}

	if (result.played || result.failed.length) {
		self.log(
			result.failed.length ? 'warn' : 'info',
			`[Audio reassert] ${result.played} route(s) replayed, ${result.alreadyPlaying} already up, ${result.failed.length} failed (of ${result.planned} planned)`,
		)
	}
	self._liveInputRouteReassertStatus = { ...result, updatedAt: Date.now() }
	return result
}

module.exports = {
	INPUT_PGM_AUDIO_LAYER_BASE,
	REPLAYABLE_KINDS,
	pgmDestLayerForInput,
	isPgmAudioOnly,
	buildLiveInputRouteReassertPlan,
	amcpForPlannedRoute,
	reassertLiveInputAudioRoutes,
}
