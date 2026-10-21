'use strict'

const routingMap = require('./routing-map')
const { listConfiguredLiveAudioSlots, resolveLiveAudioRouteString, liveAudioPgmLayerForSlot } = require('./live-audio-input')
const { isPgmAudioOnly, amcpForPlannedRoute } = require('../engine/live-input-route-reassert')
const { playLiveAlsaClipWithRecovery } = require('../audio/live-audio-health')
const { listConfiguredV4l2Slots } = require('../capture/v4l2-input-config')
const { playV4l2ClipWithRecovery } = require('../capture/v4l2-input-health')

async function setupLiveAudioInputs(self) {
	const { count, slots } = listConfiguredLiveAudioSlots(self.config)
	const playable = slots.filter((s) => Number.isFinite(Number(s.channel)))
	if (!self.amcp || count <= 0 || playable.length === 0) {
		self._liveAudioInputsStatus = {
			updatedAt: Date.now(),
			enabled: false,
			reason: !self.amcp ? 'amcp_disconnected' : count <= 0 ? 'live_audio_disabled' : 'no_inputs_channel',
		}
		return
	}
	// WO-53: each ALSA input plays on its own cheap channel so its audio meter is isolated.
	const failed = []
	let playOk = 0
	for (const slot of playable) {
		const res = await playLiveAlsaClipWithRecovery(self, slot, { log: true })
		if (res.ok) playOk++
		else {
			failed.push({
				slot: slot.slot,
				channel: slot.channel,
				layer: slot.layer,
				clip: slot.clip,
				message: res.reason || 'play_failed',
			})
		}
	}
	self._liveAudioInputsStatus = {
		updatedAt: Date.now(),
		enabled: true,
		requestedSlots: count,
		scheduledPlays: playable.length,
		playSucceeded: playOk,
		slots: playable.map((s) => ({ slot: s.slot, channel: s.channel, layer: s.layer, clip: s.clip, route: s.route })),
		failed,
	}
	self.log('info', `Live ALSA inputs: ${playOk}/${playable.length} PLAY on dedicated channel(s) ${playable.map((s) => s.channel).join(', ')}`)
}

async function setupV4l2Inputs(self) {
	const { count, slots } = listConfiguredV4l2Slots(self.config)
	const playable = slots.filter((s) => Number.isFinite(Number(s.channel)))
	if (!self.amcp || count <= 0 || playable.length === 0) {
		self._v4l2InputsStatus = {
			updatedAt: Date.now(),
			enabled: false,
			reason: !self.amcp ? 'amcp_disconnected' : count <= 0 ? 'v4l2_inputs_disabled' : 'no_device_configured',
		}
		return
	}
	const failed = []
	let playOk = 0
	for (const slot of playable) {
		const res = await playV4l2ClipWithRecovery(self, slot, { log: true })
		if (res.ok) playOk++
		else {
			failed.push({
				slot: slot.slot,
				channel: slot.channel,
				layer: slot.layer,
				device: slot.device,
				message: res.reason || 'play_failed',
			})
		}
	}
	self._v4l2InputsStatus = {
		updatedAt: Date.now(),
		enabled: true,
		requestedSlots: count,
		scheduledPlays: playable.length,
		playSucceeded: playOk,
		slots: playable.map((s) => ({
			slot: s.slot,
			channel: s.channel,
			layer: s.layer,
			device: s.device,
			label: s.label,
			clip: s.clip,
			route: s.route,
		})),
		failed,
	}
	self.log('info', `V4L2 inputs: ${playOk}/${playable.length} PLAY on dedicated channel(s) ${playable.map((s) => s.channel).join(', ')}`)
}

/**
 * Put each ALSA slot's persisted PGM routes on air. Boot/connect obeys `live_audio_pgm_always_on`; `force` (the Live
 * Audio Mixer's Save & Apply) routes the saved selection regardless — that used to be a second, client-side PLAY loop.
 * @param {object} self
 * @param {{ force?: boolean }} [opts]
 */
async function setupLiveAudioPgmRoutes(self, opts = {}) {
	if (!self.amcp) return
	const alwaysOn =
		routingMap.readCasparSetting(self.config, 'live_audio_pgm_always_on') !== false &&
		routingMap.readCasparSetting(self.config, 'live_audio_pgm_always_on') !== 'false'
	if (!alwaysOn && !opts.force) return
	const { slots } = listConfiguredLiveAudioSlots(self.config)
	if (!slots.length) return

	// Audio-only defaults ON, as everywhere else (reassert, routing store, web modal) — boot used to default it off.
	const audioOnly = isPgmAudioOnly(self.config)
	const routes = []

	// WO-571: each slot routes only to its own persisted `pgmChannels` selection (the Live Audio
	// Mixer's per-slot "Route to program" buttons) — never blanket-routed to every PGM screen
	// regardless of what's selected. A slot with none selected stays off PGM entirely.
	for (const slot of slots) {
		if (!slot.pgmChannels.length) continue
		const route = slot.route || resolveLiveAudioRouteString(self.config, slot.slot)
		if (!route) continue
		const layer = liveAudioPgmLayerForSlot(self.config, slot.slot)
		if (layer == null) {
			self.log('warn', `Live audio PGM route skipped slot ${slot.slot}: its layer exceeds audio track range 1–9`)
			continue
		}
		for (const pgmCh of slot.pgmChannels) {
			try {
				for (const c of amcpForPlannedRoute({ channel: pgmCh, layer, route, audioOnly })) await self.amcp.raw(c)
				routes.push({ channel: pgmCh, layer, route, audioOnly })
			} catch (e) {
				self.log('warn', `Live audio PGM route ${pgmCh}-${layer} ${route}: ${e?.message || e}`)
			}
		}
	}
	if (routes.length) {
		const chs = [...new Set(routes.map((r) => r.channel))].join(', ')
		self.log('info', `Live ALSA: routed ${slots.length} input(s) to PGM channel(s) ${chs} (${routes.length} route(s))`)
	}
	if (self._liveAudioInputsStatus) {
		self._liveAudioInputsStatus.pgmRoutes = routes
	}
}

module.exports = {
	setupLiveAudioInputs,
	setupV4l2Inputs,
	setupLiveAudioPgmRoutes,
}
