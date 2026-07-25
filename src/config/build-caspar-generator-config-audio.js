'use strict'

const { channelCountFromLayout, normalizeProgramLayout, maxProgramLayout } = require('./audio-channel-layouts')
const { destinationsFromConfig, destinationAudioLayoutsByMain } = require('./screen-destinations')

/**
 * Device View destination `audioLayout` → `screen_N_audio_layout` for Caspar PGM bus width.
 * @param {Record<string, unknown>} merged
 * @param {Record<string, unknown>} appConfig
 */
function applyDestinationAudioLayoutsToScreens(merged, appConfig) {
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	const byMain = destinationAudioLayoutsByMain(appConfig || {})
	for (let n = 1; n <= sc; n++) {
		const layout = byMain[n - 1] != null ? normalizeProgramLayout(String(byMain[n - 1])) : 'stereo'
		merged[`screen_${n}_audio_layout`] = layout
	}
}

function applyAudioOutputOverridesToScreens(merged, appConfig) {
	const audioOutputs = Array.isArray(appConfig?.audioOutputs) ? appConfig.audioOutputs : []
	const destinations = destinationsFromConfig(appConfig || {})
	const edges = Array.isArray(appConfig?.deviceGraph?.edges) ? appConfig.deviceGraph.edges : []

	// Map each cabled audio output to the corresponding screen in Caspar (Device View).
	audioOutputs.forEach((out) => {
		if (!out || typeof out !== 'object') return
		if (out.enabled === false || out.enabled === 'false') return
		const id = String(out.id || '').trim()
		if (!id) return
		const consumerType = String(out.type || 'portaudio').toLowerCase()
		const deviceName = String(out.deviceName || '').trim()
		// OpenAL default sink uses empty device name → bare `<system-audio />`; PortAudio needs a device.
		if (consumerType !== 'system-audio' && !deviceName) return

		// Find edge pointing to this audio output
		const edge = edges.find((e) => String(e.sinkId) === id)
		if (!edge) return

		// Source is likely a destination feed: dst_in_DESTID
		const srcId = String(edge.sourceId)
		let destId = ''
		if (srcId.startsWith('dst_in_')) {
			destId = srcId.slice('dst_in_'.length)
		}

		const dest = destinations.find((d) => String(d.id) === destId)
		if (!dest) return

		const isMv = String(dest.mode || '') === 'multiview'
		const idx = Number.isFinite(Number(dest.mainScreenIndex)) ? Number(dest.mainScreenIndex) : 0
		const prefix = isMv ? 'multiview_' : `screen_${idx + 1}_`

		if (consumerType === 'system-audio') {
			merged[`${prefix}system_audio_enabled`] = true
			merged[`${prefix}system_audio_device_name`] = deviceName
			// If this is a main screen and we enabled system audio via cabling,
			// make sure we don't accidentally enable PortAudio fallback if not cabled.
			if (!merged[`${prefix}portaudio_consumers`]) {
				merged[`${prefix}portaudio_enabled`] = false
			}
		} else {
			// PortAudio
			if (!merged[`${prefix}portaudio_consumers`]) {
				merged[`${prefix}portaudio_consumers`] = []
			}
			merged.caspar_global_portaudio = true

			const layout = normalizeProgramLayout(String(out.channelLayout || 'stereo'))
			const chCount = channelCountFromLayout(layout)

			const consumer = {
				deviceName: out.deviceName,
				hostApi: out.hostApi || 'auto',
				outputChannels: chCount,
				audioLayout: layout,
				bufferFrames: parseInt(String(out.bufferFrames), 10) || 128,
				latencyMs: parseInt(String(out.latencyMs), 10) || 40,
				fifoMs: parseInt(String(out.fifoMs), 10) || 50,
				autoTune: out.autoTuneLatency !== false && out.autoTuneLatency !== 'false',
			}

			merged[`${prefix}portaudio_consumers`].push(consumer)
			merged[`${prefix}portaudio_enabled`] = true

			// PortAudio consumer width must match PGM `<channel-layout>` on the cabled program channel.
			if (!isMv) {
				const layoutKey = `screen_${idx + 1}_audio_layout`
				const current = normalizeProgramLayout(String(merged[layoutKey] || 'stereo'))
				merged[layoutKey] = maxProgramLayout(current, layout)
			}
		}

		// Ensure we are in custom_live profile if we are using either PortAudio or System Audio device names
		if (merged.caspar_build_profile === 'stock' || !merged.caspar_build_profile) {
			merged.caspar_build_profile = 'custom_live'
		}
	})

	reconcileCustomLivePortAudioVsOpenAl(merged)
	assignStereoBusPatchesOnScreens(merged)
}

/**
 * When several stereo PortAudio outputs share one PGM channel, map each device to the next bus pair (1+2, 3+4, …).
 * @param {Record<string, unknown>} merged
 */
function assignStereoBusPatchesOnScreens(merged) {
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	for (let n = 1; n <= sc; n++) {
		const list = merged[`screen_${n}_portaudio_consumers`]
		if (!Array.isArray(list) || list.length <= 1) continue
		let nextMixCh = 1
		for (const c of list) {
			if (!c || typeof c !== 'object') continue
			const outCh = parseInt(String(c.outputChannels || 2), 10) || 2
			if (outCh !== 2) {
				nextMixCh += outCh
				continue
			}
			if (nextMixCh > 15) break
			const patch = c.audioPatch && typeof c.audioPatch === 'object' ? c.audioPatch : {}
			if (Object.keys(patch).length === 0) {
				c.audioPatch = { '1-2': `${nextMixCh}-${nextMixCh + 1}` }
			}
			nextMixCh += 2
		}
	}
}

/**
 * `mergeAudioRoutingIntoConfig` runs before device-graph PortAudio wiring. When this pass adds
 * `<portaudio/>` consumers, OpenAL `<system-audio>` on the same program channel must be off —
 * otherwise Caspar can end up with two real-world sinks (silent/wrong device, flaky meters).
 * @param {Record<string, unknown>} merged
 */
function reconcileCustomLivePortAudioVsOpenAl(merged) {
	const profile = String(merged.caspar_build_profile || 'stock').toLowerCase()
	if (profile !== 'custom_live') return
	const globalPa = merged.caspar_global_portaudio === true || merged.caspar_global_portaudio === 'true'
	const sc = Math.min(16, Math.max(1, parseInt(String(merged.screen_count || 4), 10) || 4))
	for (let n = 1; n <= sc; n++) {
		const pref = `screen_${n}_`
		const paEn = merged[`${pref}portaudio_enabled`] === true || merged[`${pref}portaudio_enabled`] === 'true'
		const list = merged[`${pref}portaudio_consumers`]
		const hasList = Array.isArray(list) && list.length > 0
		if (hasList || (globalPa && paEn)) {
			merged[`${pref}system_audio_enabled`] = false
		}
	}
}

module.exports = { applyDestinationAudioLayoutsToScreens, applyAudioOutputOverridesToScreens }
