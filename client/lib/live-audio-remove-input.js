/**
 * Remove a live audio input slot (Settings + live tile).
 */
import { api } from './api-client.js'
import { settingsState } from './settings-state.js'
import { markCasparRestartDirty } from './caspar-restart-hint.js'
import { refreshLiveAudioConfigured } from './live-audio-state.js'
import { buildLiveAudioConfigBody, readLiveAudioCasparSettings, LIVE_AUDIO_MAX_SLOTS } from './live-audio-inputs.js'
import { liveAudioInputForSlot } from './input-channels.js'
import { clearMultiPlayTargets, clearPlayTarget, getMultiPlayTargets } from './live-audio-play-targets.js'
import { clearRouteFromChannel } from './live-audio-routing.js'
import { stopHostChannelPlayback } from './extra-live-source-remove.js'

/**
 * @param {import('./state-store.js').StateStore | null} stateStore
 * @param {number} slot
 */
export async function removeLiveAudioInputSlot(stateStore, slot) {
	const s = Math.max(1, Math.min(LIVE_AUDIO_MAX_SLOTS, parseInt(String(slot ?? 1), 10) || 1))
	await settingsState.load()
	const prevUi = readLiveAudioCasparSettings(settingsState.getSettings()?.casparServer || {})
	const cm = stateStore?.getState?.()?.channelMap || {}
	const entry = liveAudioInputForSlot(cm, s)

	const multiTargets = getMultiPlayTargets(s)
	for (const t of multiTargets) {
		await clearRouteFromChannel(t.channel, t.layer).catch(() => {})
	}
	clearMultiPlayTargets(s)
	clearPlayTarget(s)

	if (entry?.channel != null) {
		await stopHostChannelPlayback({
			hostChannel: entry.channel,
			hostLayer: entry.layer ?? s,
		})
	}

	const slots = Array.isArray(prevUi.slots) ? [...prevUi.slots] : Array.from({ length: LIVE_AUDIO_MAX_SLOTS }, () => '')
	slots[s - 1] = ''
	let count = Math.max(0, Math.min(LIVE_AUDIO_MAX_SLOTS, prevUi.count || 0))
	while (count > 0 && !String(slots[count - 1] || '').trim()) count--

	const nextUi = {
		...prevUi,
		slots,
		count,
		hostChannelEnabled: count > 0 ? true : prevUi.hostChannelEnabled,
	}
	await api.post('/api/audio/live-inputs/config', buildLiveAudioConfigBody(nextUi))
	await settingsState.load()
	if (count < prevUi.count) markCasparRestartDirty()

	const liveAudioConfigured = stateStore ? await refreshLiveAudioConfigured(stateStore) : null
	return { ok: true, slot: s, casparRestartNeeded: count < prevUi.count, liveAudioConfigured }
}
