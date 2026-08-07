'use strict'

const { destinationsFromConfig } = require('./screen-destinations')
const { channelCountFromLayout, normalizeProgramLayout, maxProgramLayout } = require('./audio-channel-layouts')

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

function applyAudioOutputOverridesToScreens(merged, appConfig) {
	const audioOutputs = Array.isArray(appConfig?.audioOutputs) ? appConfig.audioOutputs : []
	const destinations = destinationsFromConfig(appConfig || {})
	const edges = Array.isArray(appConfig?.deviceGraph?.edges) ? appConfig.deviceGraph.edges : []

	audioOutputs.forEach((out) => {
		if (!out || typeof out !== 'object') return
		if (out.enabled === false || out.enabled === 'false') return
		const id = String(out.id || '').trim()
		if (!id) return
		const consumerType = String(out.type || 'portaudio').toLowerCase()
		const deviceName = String(out.deviceName || '').trim()
		if (consumerType !== 'system-audio' && !deviceName) return

		const edge = edges.find((e) => String(e.sinkId) === id)
		if (!edge) return

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
			if (!merged[`${prefix}portaudio_consumers`]) {
				merged[`${prefix}portaudio_enabled`] = false
			}
		} else {
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

			if (!isMv) {
				const layoutKey = `screen_${idx + 1}_audio_layout`
				const current = normalizeProgramLayout(String(merged[layoutKey] || 'stereo'))
				merged[layoutKey] = maxProgramLayout(current, layout)
			}
		}

		if (merged.caspar_build_profile === 'stock' || !merged.caspar_build_profile) {
			merged.caspar_build_profile = 'custom_live'
		}
	})

	reconcileCustomLivePortAudioVsOpenAl(merged)
	assignStereoBusPatchesOnScreens(merged)
}

module.exports = {
	applyAudioOutputOverridesToScreens,
	assignStereoBusPatchesOnScreens,
	reconcileCustomLivePortAudioVsOpenAl,
}
