/**
 * Per-slot play routing for live ALSA inputs.
 * Persisted in localStorage until the server stores play targets on slots.
 */
import { liveAudioInputForSlot } from './input-channels.js'

const LS_KEY = 'highascg_live_audio_play_targets'
const LS_MULTI_KEY = 'highascg_live_audio_play_targets_multi'

/** Previous default was 9 + slot (L10 for slot 1) — remap on read so saved targets don't collide with video. */
function migrateLegacyLayer(slot, layer) {
	const n = Math.max(1, parseInt(String(slot), 10) || 1)
	const ln = parseInt(String(layer), 10)
	if (!Number.isFinite(ln)) return n
	if (ln === 9 + n) return n
	return ln
}

/**
 * @returns {Record<string, { channel: number, layer: number, label?: string }>}
 */
export function getAllPlayTargets() {
	try {
		const raw = localStorage.getItem(LS_KEY)
		const parsed = raw ? JSON.parse(raw) : {}
		return parsed && typeof parsed === 'object' ? parsed : {}
	} catch {
		return {}
	}
}

/**
 * @param {number} slot - 1-based
 */
export function getPlayTarget(slot) {
	const key = String(Math.max(1, parseInt(String(slot), 10) || 1))
	const row = getAllPlayTargets()[key]
	if (!row || typeof row !== 'object') return null
	const channel = parseInt(String(row.channel), 10)
	const layer = parseInt(String(row.layer), 10)
	if (!Number.isFinite(channel) || channel < 1 || !Number.isFinite(layer) || layer < 1) return null
	const slotNum = Math.max(1, parseInt(String(slot), 10) || 1)
	const migratedLayer = migrateLegacyLayer(slotNum, layer)
	return {
		channel,
		layer: migratedLayer,
		label: String(row.label || '').trim() || undefined,
	}
}

/**
 * @param {number} slot
 * @param {{ channel: number, layer: number, label?: string }} target
 */
export function setPlayTarget(slot, target) {
	const key = String(Math.max(1, parseInt(String(slot), 10) || 1))
	const all = getAllPlayTargets()
	all[key] = {
		channel: Math.max(1, parseInt(String(target.channel), 10) || 1),
		layer: Math.max(1, parseInt(String(target.layer), 10) || 1),
		label: String(target.label || '').trim() || undefined,
	}
	try {
		localStorage.setItem(LS_KEY, JSON.stringify(all))
	} catch {
		/* ignore */
	}
}

/**
 * @param {number} slot
 */
export function clearPlayTarget(slot) {
	const key = String(Math.max(1, parseInt(String(slot), 10) || 1))
	const all = getAllPlayTargets()
	delete all[key]
	try {
		localStorage.setItem(LS_KEY, JSON.stringify(all))
	} catch {
		/* ignore */
	}
}

/**
 * Multi-destination routing: one live audio slot can be routed to multiple Caspar channel/layers.
 * Stored as: { [slotNumber]: Array<{ channel:number, layer:number }> }
 *
 * This is purely client routing state; actual Caspar playback is started/stopped by the UI.
 * @param {number} slot - 1-based
 * @returns {{ channel: number, layer: number }[]}
 */
export function getMultiPlayTargets(slot) {
	const key = String(Math.max(1, parseInt(String(slot), 10) || 1))
	try {
		const raw = localStorage.getItem(LS_MULTI_KEY)
		const j = raw ? JSON.parse(raw) : {}
		const arr = j && typeof j === 'object' ? j[key] : null
		if (!Array.isArray(arr)) return []
		return arr
			.map((t) => {
				if (!t || typeof t !== 'object') return null
				const ch = Math.max(1, parseInt(String(t.channel), 10) || 0)
				const ln = Math.max(1, parseInt(String(t.layer), 10) || 0)
				if (!Number.isFinite(ch) || !Number.isFinite(ln)) return null
				return { channel: ch, layer: ln }
			})
			.filter(Boolean)
	} catch {
		return []
	}
}

/**
 * @param {number} slot - 1-based
 * @param {{ channel: number, layer: number }[]} targets
 */
export function setMultiPlayTargets(slot, targets) {
	const key = String(Math.max(1, parseInt(String(slot), 10) || 1))
	const cleaned = Array.isArray(targets) ? targets : []
	const uniq = []
	const seen = new Set()
	for (const t of cleaned) {
		if (!t || typeof t !== 'object') continue
		const ch = Math.max(1, parseInt(String(t.channel), 10) || 0)
		const ln = Math.max(1, parseInt(String(t.layer), 10) || 0)
		if (!Number.isFinite(ch) || !Number.isFinite(ln)) continue
		const k = `${ch}-${ln}`
		if (seen.has(k)) continue
		seen.add(k)
		uniq.push({ channel: ch, layer: ln })
	}
	try {
		const raw = localStorage.getItem(LS_MULTI_KEY)
		const j = raw ? JSON.parse(raw) : {}
		const all = j && typeof j === 'object' ? j : {}
		all[key] = uniq
		localStorage.setItem(LS_MULTI_KEY, JSON.stringify(all))
	} catch {
		/* ignore */
	}
}

/**
 * @param {number} slot - 1-based
 */
export function clearMultiPlayTargets(slot) {
	const key = String(Math.max(1, parseInt(String(slot), 10) || 1))
	try {
		const raw = localStorage.getItem(LS_MULTI_KEY)
		const j = raw ? JSON.parse(raw) : {}
		const all = j && typeof j === 'object' ? j : {}
		delete all[key]
		localStorage.setItem(LS_MULTI_KEY, JSON.stringify(all))
	} catch {
		/* ignore */
	}
}


/**
 * @param {object | null | undefined} channelMap
 * @param {number} slot
 */
export function defaultPlayTarget(channelMap, slot) {
	const n = Math.max(1, parseInt(String(slot), 10) || 1)
	const entry = liveAudioInputForSlot(channelMap, n)
	if (entry) {
		return {
			channel: entry.channel,
			layer: entry.layer,
			label: entry.label || `Live audio ${n}`,
		}
	}
	const programChannels =
		Array.isArray(channelMap?.programChannels) && channelMap.programChannels.length
			? channelMap.programChannels
			: [1]
	const channel = programChannels[0] ?? 1
	return { channel, layer: n, label: `Live audio ${n}` }
}

/**
 * @param {object | null | undefined} channelMap
 * @param {number} slot
 */
export function resolvePlayTarget(channelMap, slot) {
	return getPlayTarget(slot) || defaultPlayTarget(channelMap, slot)
}
