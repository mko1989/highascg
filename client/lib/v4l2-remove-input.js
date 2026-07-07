/**
 * Remove a V4L2 / USB video input slot (Settings + live tile).
 */
import { api } from './api-client.js'
import { settingsState } from './settings-state.js'
import { markCasparRestartDirty } from './caspar-restart-hint.js'
import { refreshV4l2Configured } from './v4l2-input-state.js'
import { buildV4l2ConfigBody, readV4l2CasparSettings, V4L2_MAX_SLOTS } from './v4l2-inputs.js'
import { v4l2InputForSlot } from './input-channels.js'
import { stopHostChannelPlayback } from './extra-live-source-remove.js'

/**
 * @param {import('./state-store.js').StateStore | null} stateStore
 * @param {number} slot
 */
export async function removeV4l2InputSlot(stateStore, slot) {
	const s = Math.max(1, Math.min(V4L2_MAX_SLOTS, parseInt(String(slot ?? 1), 10) || 1))
	await settingsState.load()
	const prevUi = readV4l2CasparSettings(settingsState.getSettings()?.casparServer || {})
	const cm = stateStore?.getState?.()?.channelMap || {}
	const entry = v4l2InputForSlot(cm, s)
	if (entry?.channel != null) {
		await stopHostChannelPlayback({
			hostChannel: entry.channel,
			hostLayer: entry.layer ?? s,
		})
	}

	const slots = Array.isArray(prevUi.slots) ? [...prevUi.slots] : Array.from({ length: V4L2_MAX_SLOTS }, () => '')
	slots[s - 1] = ''
	let count = Math.max(0, Math.min(V4L2_MAX_SLOTS, prevUi.count || 0))
	while (count > 0 && !String(slots[count - 1] || '').trim()) count--

	const nextUi = { ...prevUi, slots, count }
	await api.post('/api/v4l2-inputs/config', buildV4l2ConfigBody(nextUi))
	await settingsState.load()
	if (count < prevUi.count) markCasparRestartDirty()

	const v4l2Configured = stateStore ? await refreshV4l2Configured(stateStore) : null
	return { ok: true, slot: s, casparRestartNeeded: count < prevUi.count, v4l2Configured }
}
