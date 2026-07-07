/**
 * Add a live audio input slot from Sources → Live modal (WO-53 dedicated host channel).
 */
import { api } from './api-client.js'
import { settingsState } from './settings-state.js'
import { markCasparRestartDirty } from './caspar-restart-hint.js'
import { refreshLiveAudioConfigured } from './live-audio-state.js'
import {
	buildLiveAudioConfigBody,
	LIVE_AUDIO_MAX_SLOTS,
	readLiveAudioCasparSettings,
} from './live-audio-inputs.js'
import { liveAudioInputForSlot } from './input-channels.js'
import { applyLiveAudioCapture } from './live-audio-routing.js'

/**
 * Pick the next slot for a new device: first empty within count, else append.
 * @param {ReturnType<typeof readLiveAudioCasparSettings>} ui
 * @param {string} device
 */
export function pickLiveAudioSlotForDevice(ui, device) {
	const dev = String(device || '').trim()
	if (!dev) throw new Error('Select a capture device')
	for (let i = 1; i <= ui.count; i++) {
		if (!String(ui.slots[i - 1] || '').trim()) return { slot: i, count: ui.count, slots: [...ui.slots] }
	}
	if (ui.count >= LIVE_AUDIO_MAX_SLOTS) {
		throw new Error(`Maximum ${LIVE_AUDIO_MAX_SLOTS} live audio inputs — remove one in Settings or Audio Mixer`)
	}
	const count = ui.count + 1
	const slots = [...ui.slots]
	slots[count - 1] = dev
	return { slot: count, count, slots }
}

function channelMapForLiveAudio(stateStore, livePayload) {
	return {
		...(stateStore.getState()?.channelMap || {}),
		liveAudioCount: livePayload?.liveAudioCount,
		liveAudioInputChannels: livePayload?.liveAudioInputChannels,
	}
}

/**
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {{ device: string }} payload
 */
export async function addLiveAudioInputSlot(stateStore, { device }) {
	const dev = String(device || '').trim()
	if (!dev) throw new Error('Select a capture device')

	await settingsState.load()
	const prevUi = readLiveAudioCasparSettings(settingsState.getSettings()?.casparServer || {})
	const { slot, count, slots } = pickLiveAudioSlotForDevice(prevUi, dev)
	const nextUi = { ...prevUi, count, slots: [...slots] }
	nextUi.slots[slot - 1] = dev

	await api.post('/api/audio/live-inputs/config', buildLiveAudioConfigBody(nextUi))
	await settingsState.load()

	const casparRestartNeeded = count > prevUi.count
	if (casparRestartNeeded) markCasparRestartDirty()

	let livePayload = await refreshLiveAudioConfigured(stateStore)
	let entry = liveAudioInputForSlot(channelMapForLiveAudio(stateStore, livePayload), slot)

	let hostLivePlay = null
	if (entry?.route && !casparRestartNeeded) {
		try {
			hostLivePlay = await applyLiveAudioCapture()
		} catch (e) {
			hostLivePlay = { ok: false, error: e?.message || String(e) }
		}
	}

	return {
		ok: true,
		slot,
		hostChannel: entry?.channel ?? null,
		route: entry?.route ?? null,
		casparRestartNeeded,
		pendingApply: casparRestartNeeded,
		hostLivePlay,
		liveAudioConfigured: livePayload,
	}
}
