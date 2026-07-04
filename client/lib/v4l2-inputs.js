/**
 * USB / V4L2 video inputs (WO-121).
 */
import { v4l2InputForSlot, listInputChannels } from './input-channels.js'

export const V4L2_MAX_SLOTS = 8

/**
 * @param {object | null | undefined} cs
 */
export function readV4l2CasparSettings(cs) {
	const c = cs && typeof cs === 'object' ? cs : {}
	const count = Math.max(0, Math.min(V4L2_MAX_SLOTS, parseInt(String(c.v4l2_input_count ?? '0'), 10) || 0))
	const slots = []
	for (let i = 1; i <= V4L2_MAX_SLOTS; i++) {
		slots.push(String(c[`v4l2_input_${i}_device`] ?? '').trim())
	}
	return {
		count,
		slots,
		captureBridge: c.v4l2_capture_bridge === true || c.v4l2_capture_bridge === 'true',
		inputsChannelMode: String(c.v4l2_input_channel_mode ?? c.inputs_channel_mode ?? '').trim(),
	}
}

/**
 * @param {object} ui
 */
export function buildV4l2ConfigBody(ui) {
	/** @type {Record<string, unknown>} */
	const body = {
		v4l2_input_count: ui.count,
		v4l2_capture_bridge: ui.captureBridge === true,
	}
	if (ui.inputsChannelMode) body.v4l2_input_channel_mode = ui.inputsChannelMode
	for (let i = 1; i <= V4L2_MAX_SLOTS; i++) {
		body[`v4l2_input_${i}_device`] = ui.slots[i - 1] || ''
		if (ui.labels?.[i - 1]) body[`v4l2_input_${i}_label`] = ui.labels[i - 1]
		if (ui.formats?.[i - 1]) body[`v4l2_input_${i}_format`] = ui.formats[i - 1]
		if (ui.widths?.[i - 1]) body[`v4l2_input_${i}_width`] = ui.widths[i - 1]
		if (ui.heights?.[i - 1]) body[`v4l2_input_${i}_height`] = ui.heights[i - 1]
		if (ui.fps?.[i - 1]) body[`v4l2_input_${i}_fps`] = ui.fps[i - 1]
		if (ui.audio?.[i - 1]) body[`v4l2_input_${i}_audio`] = ui.audio[i - 1]
	}
	return body
}

/**
 * @param {object[]} devices
 * @returns {{ value: string, label: string, disabled?: boolean }[]}
 */
export function v4l2CaptureDeviceOptions(devices) {
	const list = Array.isArray(devices) ? devices : []
	const opts = [{ value: '', label: '(none)' }]
	for (const d of list) {
		if (!d?.path) continue
		const excluded = d.excludedReason || !d.captureCapable
		const label = excluded
			? `${d.name || d.path} — ${d.excludedReason || 'not capture'}`
			: `${d.name || d.path} (${d.path})`
		opts.push({
			value: d.stableId || d.path,
			label,
			disabled: !!excluded,
		})
	}
	return opts
}

/**
 * ALSA picker options for optional V4L2 audio mux (`none` + capture devices).
 * @param {Array<{ id?: string, name?: string, type?: string }>} devices
 * @returns {{ value: string, label: string }[]}
 */
export function v4l2AlsaDeviceOptions(devices) {
	const out = [{ value: 'none', label: 'none (video only)' }]
	const seen = new Set(['none'])
	for (const d of devices || []) {
		if (!d || d.type !== 'alsa') continue
		const id = String(d.id || '').trim()
		if (!id || seen.has(id)) continue
		seen.add(id)
		const name = String(d.name || id).trim()
		const hw = id.replace(/^alsa:\/\//i, '')
		out.push({ value: hw, label: name === id ? hw : `${name} (${hw})` })
	}
	return out
}

export { v4l2InputForSlot, listInputChannels }

/**
 * @param {object | null | undefined} status
 * @param {number} slot
 * @returns {string}
 */
export function v4l2SlotStatusMessage(status, slot) {
	if (status == null || typeof status !== 'object') return ''
	if (status.enabled === false && status.reason === 'amcp_disconnected') return 'AMCP offline — USB input not started'
	const failed = Array.isArray(status.failed) ? status.failed.find((x) => x && Number(x.slot) === slot) : null
	if (failed) return (failed.message && String(failed.message)) || 'PLAY failed for this slot'
	if (status.playSucceeded != null && status.scheduledPlays > 0 && status.playSucceeded < status.scheduledPlays) {
		const slotFailed = status.failed?.some((x) => Number(x?.slot) === slot)
		if (slotFailed) return 'PLAY failed — try Apply PLAY in Settings'
	}
	return ''
}
