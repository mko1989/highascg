import * as audioMixerState from './audio-mixer-state.js'
import { isMediaOrFileSource } from '../components/scenes-shared.js'
import { sceneState } from './scene-state.js'
import { shortenMediaName } from './audio-mixer-ui.js'
import { settingsState } from './settings-state.js'
import { enumerateLiveAudioMixerSlots, readLiveAudioCasparSettings } from './live-audio-inputs.js'
import { listInputChannels, LIVE_AUDIO_INPUT_LAYER, liveAudioInputForSlot } from './input-channels.js'
import { timelineState } from './timeline-state.js'

/** Layers that expose a per-strip fader in the program mixer. */
export function layerHasMixerAudio(layer) {
	const src = layer?.source
	if (!src) return false
	if (isMediaOrFileSource(src)) return true
	return String(src.type || '').toLowerCase() === 'live_audio' && !!src.value
}

/** @param {object} row */
export function meterMetaForInputRow(row) {
	let sourceType = 'media'
	if (row?.liveAudioSlot != null || row?.isLiveInput) {
		sourceType = 'live_audio'
	} else if (row?.isTimelineClip) {
		sourceType = 'timeline'
	}
	const hostChannel =
		row?.hostChannel != null
			? row.hostChannel
			: row?.isLiveInput
				? row.ch
				: null
	return {
		muted: !!row?.muted,
		layer: row?.layer,
		ch: row?.ch,
		hostChannel,
		expectAudio: true,
		sourceType,
	}
}

/**
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {number} programCh
 * @param {number} mainIdx
 */
function resolveLiveSceneForProgram(stateStore, programCh, mainIdx) {
	const liveScenes = stateStore.getState()?.scene?.live || {}
	const entry = liveScenes[programCh] ?? liveScenes[String(programCh)]
	if (entry?.scene?.layers) {
		return { sceneId: entry.sceneId, scene: entry.scene }
	}
	const snap = sceneState.getLiveSceneSnapshot(mainIdx)
	if (snap?.layers?.length) {
		const sceneId = sceneState.getLiveSceneIdForMain(mainIdx) ?? sceneState.liveSceneIdByMain[mainIdx]
		return { sceneId, scene: snap }
	}
	return null
}

/**
 * Check if this channel is playing a timeline and get the timeline.
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {number} channel
 * @returns {object|null}
 */
function getActiveTimelineForChannel(stateStore, channel) {
	const pb = stateStore.getState()?.timeline?.playback
	if (!pb?.timelineId) return null
	// Check if this timeline is being sent to the given channel
	const sendTo = pb.sendTo
	if (!sendTo) return null
	const isProgram = sendTo.program === true
	if (!isProgram) return null
	const screenIdx = sendTo.screenIdx ?? 0
	const cm = stateStore.getState()?.channelMap || {}
	const programCh = Number(cm.programChannels?.[screenIdx])
	if (programCh !== Number(channel)) return null
	return timelineState.getTimeline(pb.timelineId)
}

/**
 * Build master + layer fader rows for program channels.
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {{ masterLabel: (ch: number, index: number) => string, labelMax?: number, labelTailChars?: number }} options
 */
export function collectProgramAudioRows(stateStore, { masterLabel, labelMax = 22, labelTailChars = 3 }) {
	const cm = stateStore.getState()?.channelMap || {}
	const programChannels =
		Array.isArray(cm.programChannels) && cm.programChannels.length > 0 ? cm.programChannels : [1]

	const rows = []
	programChannels.forEach((ch, i) => {
		const key = `pgm:${ch}`
		const v = audioMixerState.getMasterVolume(key)
		rows.push({ key, ch, label: masterLabel(ch, i), v, isMaster: true })

		// T183.3: Check if a timeline is active on this channel
		const activeTimeline = getActiveTimelineForChannel(stateStore, ch)
		if (activeTimeline?.layers && Array.isArray(activeTimeline.layers)) {
			// Render strips for timeline layers (physical layers 210+)
			const TIMELINE_LAYER_BASE = 210
			activeTimeline.layers.forEach((tlLayer, tlLayerIdx) => {
				if (!tlLayer || !tlLayer.clips) return
				// Get the first clip (or we could show multiple clips per layer, but for now show one per layer)
				const clip = tlLayer.clips[0]
				if (!clip) return
				const physicalLayer = TIMELINE_LAYER_BASE + tlLayerIdx
				const lKey = `pgm:${ch}:layer:${physicalLayer}`
				const clipName = clip.name || `Clip ${tlLayerIdx + 1}`
				const shortName = shortenMediaName(clipName, { max: labelMax, tailChars: labelTailChars })
				rows.push({
					key: lKey,
					ch,
					layer: physicalLayer,
					label: shortName,
					labelTitle: `${clipName} (Timeline layer)`,
					v: clip.volume != null ? clip.volume : 1,
					muted: !!clip.muted,
					isMaster: false,
					audioRoute: clip.audioRoute || '1+2',
					sceneId: null,
					isTimelineClip: true,
				})
			})
		} else {
			// T183.2: No timeline active on this channel, show live scene strips but filter out timeline sources
			const liveSceneData = resolveLiveSceneForProgram(stateStore, ch, i)
			if (liveSceneData?.scene?.layers) {
				liveSceneData.scene.layers.forEach((layer) => {
					// Skip timeline source layers to avoid showing stale look data
					if (layer.source?.type === 'timeline') return
					if (!layerHasMixerAudio(layer)) return
					const ln = layer.layerNumber
					const src = layer.source
					const ty = String(src?.type || '').toLowerCase()
					let fullName = String(src?.value || '').split('/').pop() || ''
					let shortName = shortenMediaName(fullName, { max: labelMax, tailChars: labelTailChars })
					if (ty === 'live_audio') {
						fullName = src?.label || `Live audio ${src?.value || ''}`
						shortName = shortenMediaName(fullName, { max: labelMax, tailChars: labelTailChars })
					}
					const liveSlot = ty === 'live_audio' ? parseInt(String(src?.value || ''), 10) : NaN
					const hostEntry = Number.isFinite(liveSlot) ? liveAudioInputForSlot(cm, liveSlot) : null
					const lKey = `pgm:${ch}:layer:${ln}`
					rows.push({
						key: lKey,
						ch,
						layer: ln,
						label: `L${ln} · ${shortName}`,
						labelTitle: `L${ln}: ${fullName}`,
						v: layer.volume != null ? layer.volume : 1,
						muted: !!layer.muted,
						isMaster: false,
						audioRoute: layer.audioRoute || '1+2',
						sceneId: liveSceneData.sceneId,
						...(Number.isFinite(liveSlot)
							? { liveAudioSlot: liveSlot, hostChannel: hostEntry?.channel ?? null }
							: {}),
					})
				})
			}
		}
	})

	const liveAudioConfigured = stateStore.getState()?.liveAudioConfigured
	const casparUi = readLiveAudioCasparSettings(settingsState.getSettings()?.casparServer || {})
	const liveAudioSlots = enumerateLiveAudioMixerSlots(cm, liveAudioConfigured, casparUi)
	const rowKeys = new Set(rows.map((r) => r.key))
	for (const slotRow of liveAudioSlots) {
		const { channel, layer: ln, slot: s, label: fullName } = slotRow
		const lKey = `pgm:${channel}:layer:${ln}`
		if (rowKeys.has(lKey)) continue
		rowKeys.add(lKey)
		const shortName = shortenMediaName(fullName, { max: labelMax, tailChars: labelTailChars })
		rows.push({
			key: lKey,
			ch: channel,
			layer: ln,
			label: shortName,
			labelTitle: `${fullName} (Live audio · Ch ${channel} L${ln})`,
			v: audioMixerState.getMasterVolume(lKey),
			muted: audioMixerState.getMuted(lKey),
			isMaster: false,
			audioRoute: '1+2',
			sceneId: null,
			liveAudioSlot: s,
			hostChannel: channel,
		})
	}

	return {
		programChannels,
		rows,
		mastersList: rows.filter((r) => r.isMaster),
		inputsList: rows.filter((r) => !r.isMaster),
	}
}

/**
 * Isolated VU meter rows for dedicated live input channels (WO-53).
 * @param {object | null | undefined} channelMap
 */
export function collectLiveInputMeterRows(channelMap) {
	return listInputChannels(channelMap)
		.filter((entry) => entry.kind === 'live_audio')
		.map((entry) => {
			const key = `input:${entry.channel}`
			const layer = entry.layer ?? LIVE_AUDIO_INPUT_LAYER
			return {
				key,
				ch: entry.channel,
				layer,
				label: entry.label || `Live audio ${entry.slot}`,
				labelTitle: `Ch ${entry.channel} · L${layer} — ${entry.route || ''}`,
				v: audioMixerState.getMasterVolume(key),
				muted: audioMixerState.getMuted(key),
				isMaster: false,
				isLiveInput: true,
				inputKind: entry.kind,
				slot: entry.slot,
				hostChannel: entry.channel,
			}
		})
}