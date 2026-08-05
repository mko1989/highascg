/**
 * Add a V4L2 / USB video input slot from Sources → Live modal (WO-121).
 */
import { api } from './api-client.js'
import { settingsState } from './settings-state.js'
import { markCasparRestartDirty } from './caspar-restart-hint.js'
import { refreshV4l2Configured } from './v4l2-input-state.js'
import {
	buildV4l2ConfigBody,
	readV4l2CasparSettings,
	V4L2_MAX_SLOTS,
} from './v4l2-inputs.js'
import { v4l2InputForSlot } from './input-channels.js'

/**
 * @param {ReturnType<typeof readV4l2CasparSettings>} ui
 * @param {string} device
 */
export function pickV4l2SlotForDevice(ui, device) {
	const dev = String(device || '').trim()
	if (!dev) throw new Error('Select a capture device')
	for (let i = 1; i <= ui.count; i++) {
		if (!String(ui.slots[i - 1] || '').trim()) return { slot: i, count: ui.count, slots: [...ui.slots] }
	}
	if (ui.count >= V4L2_MAX_SLOTS) {
		throw new Error(`Maximum ${V4L2_MAX_SLOTS} USB video inputs — remove one from its input tile in the device view`)
	}
	const count = ui.count + 1
	const slots = [...ui.slots]
	slots[count - 1] = dev
	return { slot: count, count, slots }
}

function channelMapForV4l2(stateStore, livePayload) {
	return {
		...(stateStore.getState()?.channelMap || {}),
		v4l2InputCount: livePayload?.v4l2InputCount,
		v4l2InputChannels: livePayload?.v4l2InputChannels,
	}
}

/**
 * @param {import('./state-store.js').StateStore} stateStore
 * @param {{ device: string, label?: string, format?: string, width?: number, height?: number, fps?: number, audio?: string }} payload
 */
export async function addV4l2InputSlot(stateStore, payload) {
	const dev = String(payload?.device || '').trim()
	if (!dev) throw new Error('Select a capture device')

	await settingsState.load()
	const prevUi = readV4l2CasparSettings(settingsState.getSettings()?.casparServer || {})
	const { slot, count, slots } = pickV4l2SlotForDevice(prevUi, dev)
	const nextUi = {
		...prevUi,
		count,
		slots: [...slots],
		labels: [...(prevUi.labels || Array(V4L2_MAX_SLOTS).fill(''))],
		formats: [...(prevUi.formats || Array(V4L2_MAX_SLOTS).fill('auto'))],
		widths: [...(prevUi.widths || Array(V4L2_MAX_SLOTS).fill(0))],
		heights: [...(prevUi.heights || Array(V4L2_MAX_SLOTS).fill(0))],
		fps: [...(prevUi.fps || Array(V4L2_MAX_SLOTS).fill(0))],
		audio: [...(prevUi.audio || Array(V4L2_MAX_SLOTS).fill('none'))],
	}
	nextUi.slots[slot - 1] = dev
	if (payload?.label) nextUi.labels[slot - 1] = String(payload.label).trim()
	if (payload?.format) nextUi.formats[slot - 1] = String(payload.format).trim()
	if (payload?.width) nextUi.widths[slot - 1] = Number(payload.width) || 0
	if (payload?.height) nextUi.heights[slot - 1] = Number(payload.height) || 0
	if (payload?.fps) nextUi.fps[slot - 1] = Number(payload.fps) || 0
	if (payload?.audio) nextUi.audio[slot - 1] = String(payload.audio).trim()

	await api.post('/api/v4l2-inputs/config', buildV4l2ConfigBody(nextUi))
	await settingsState.load()

	const casparRestartNeeded = count > prevUi.count
	if (casparRestartNeeded) markCasparRestartDirty()

	let livePayload = await refreshV4l2Configured(stateStore)
	let entry = v4l2InputForSlot(channelMapForV4l2(stateStore, livePayload), slot)

	let hostLivePlay = null
	if (entry?.route && !casparRestartNeeded) {
		try {
			hostLivePlay = await api.post('/api/v4l2-inputs/apply', {})
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
		v4l2Configured: livePayload,
	}
}
