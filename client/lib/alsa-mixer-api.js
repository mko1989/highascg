/**
 * ALSA hardware mixer (amixer / alsamixer) — server-backed on Linux playout hosts.
 * @see to_server/ALSA_MIXER_API.md
 *
 * Expected API:
 *   GET  /api/audio/alsa-mixer?card=0[&refresh=1]
 *   POST /api/audio/alsa-mixer  { card, name?, index?, percent?, value?, mute?, item? }
 */
import { api } from './api-client.js'

/**
 * @param {number} [card]
 * @param {{ refresh?: boolean }} [opts]
 */
export async function fetchAlsaMixer(card = 0, opts = {}) {
	const q = new URLSearchParams({ card: String(Math.max(0, parseInt(String(card), 10) || 0)) })
	if (opts.refresh) q.set('refresh', '1')
	return api.get(`/api/audio/alsa-mixer?${q}`)
}

/**
 * @param {{ card: number, name?: string, index?: number, percent?: number, value?: number, mute?: boolean, item?: string }} body
 */
export async function setAlsaMixerControl(body) {
	return api.post('/api/audio/alsa-mixer', body)
}

/**
 * @param {unknown} payload
 * @returns {{ card: number, cards: { card: number, name?: string }[], controls: object[] }}
 */
export function normalizeAlsaMixerPayload(payload) {
	const p = payload && typeof payload === 'object' ? payload : {}
	const cards = Array.isArray(p.cards)
		? p.cards
				.map((c) => {
					if (!c || typeof c !== 'object') return null
					const card = parseInt(String(c.card ?? c.index ?? ''), 10)
					if (!Number.isFinite(card) || card < 0) return null
					return { card, name: String(c.name || c.label || `Card ${card}`).trim() }
				})
				.filter(Boolean)
		: []
	const card = parseInt(String(p.card ?? cards[0]?.card ?? '0'), 10) || 0
	let controls = []
	if (Array.isArray(p.controls)) controls = p.controls
	else if (Array.isArray(p.elements)) controls = p.elements
	else if (p.playback || p.capture) {
		controls = [...(Array.isArray(p.playback) ? p.playback : []), ...(Array.isArray(p.capture) ? p.capture : [])]
	}
	return { card, cards, controls: controls.filter((c) => c && typeof c === 'object') }
}

/**
 * @param {object} ctrl
 * @param {'playback' | 'capture' | 'all'} view
 */
export function alsaControlMatchesView(ctrl, view) {
	if (view === 'all') return true
	const ty = String(ctrl.type || '').toLowerCase()
	if (ty === 'boolean' || ty === 'switch' || ty === 'enum' || ty === 'enumerated') return true
	const cap = ctrl.capture === true || ctrl.isCapture === true
	const play = ctrl.playback === true || ctrl.isPlayback === true
	if (cap || play) {
		if (view === 'capture') return cap
		return play
	}
	const name = String(ctrl.name || ctrl.id || '').toLowerCase()
	if (view === 'capture') {
		return /capture|mic|input|adc|record/.test(name)
	}
	return !/capture|mic|input|adc|record/.test(name) || /playback|output|dac|master|speaker|headphone|pcm/.test(name)
}

/**
 * @param {object} ctrl
 */
export function alsaControlPercent(ctrl) {
	const min = Number(ctrl.min ?? 0)
	const max = Number(ctrl.max ?? 100)
	const raw = ctrl.percent ?? ctrl.value ?? ctrl.volume
	const n = parseFloat(String(raw))
	if (!Number.isFinite(n)) return 0
	if (max > min && n >= min && n <= max) {
		return Math.round(((n - min) / (max - min)) * 100)
	}
	if (n >= 0 && n <= 100) return Math.round(n)
	return Math.max(0, Math.min(100, Math.round(n)))
}

/** @param {() => void | Promise<void>} fn @param {number} [ms] */
export function debounceAlsaSet(fn, ms = 100) {
	let timer = null
	return () => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			timer = null
			void fn()
		}, ms)
	}
}
