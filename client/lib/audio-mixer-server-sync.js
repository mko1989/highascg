/**
 * WO-604 slice 2 — keep the web console's mixer cache (audio-mixer-state.js) on the server's state, so the web and
 * the Godot client show one mixer. GET /api/audio/mixer on every WS (re)connect, then the `audioMixer` change
 * broadcast (app-ws-handlers.js → stateStore.applyChange). Strips are synced in place — never a re-render, which
 * would rebuild a fader under the operator's pointer — and a fader being dragged keeps its own value.
 */

import { api } from './api-client.js'
import * as audioMixerState from './audio-mixer-state.js'
import { syncAllSolosUI, syncFaderUIFromGain, syncMuteUI } from '../components/audio-mixer-panel-sync.js'

/** The last snapshot applied — only keys whose server value changed are touched on screen. */
let prev = { gains: {}, muted: {}, solos: [] }

/** Apply a server snapshot to the cache and to the strips on screen. @param {unknown} snap */
export function applyServerMixer(snap) {
	const j = snap && typeof snap === 'object' ? /** @type {any} */ (snap) : {}
	const next = {
		gains: j.gains && typeof j.gains === 'object' ? j.gains : {},
		muted: j.muted && typeof j.muted === 'object' ? j.muted : {},
		solos: Array.isArray(j.solos) ? j.solos : [],
	}
	audioMixerState.ingestServerMixer(next)
	const before = prev
	prev = next
	if (typeof document === 'undefined') return
	// Look-owned strips keep volume / mute on the look; the server never stores their keys, so they never change here.
	for (const key of Object.keys(next.gains)) {
		if (before.gains[key] === next.gains[key]) continue
		const dragging = [...document.querySelectorAll(`input[type="range"][data-key="${CSS.escape(key)}"]`)].some((f) => f.matches(':active'))
		if (!dragging) syncFaderUIFromGain(key, audioMixerState.getMasterVolume(key))
	}
	for (const key of new Set([...Object.keys(before.muted), ...Object.keys(next.muted)])) {
		if ((before.muted[key] === true) !== (next.muted[key] === true)) syncMuteUI(key, next.muted[key] === true)
	}
	syncAllSolosUI() // always: an optimistic local toggle the server refused must go dark again
}

/** Re-read the server's mixer state (after a refused write, so an optimistic toggle does not stick). */
export async function resyncAudioMixer() {
	await pull()
}

async function pull() {
	try {
		const r = await api.get('/api/audio/mixer')
		if (r && typeof r === 'object') applyServerMixer(r)
	} catch (e) {
		console.warn('[AudioMixer] server mixer state unavailable:', e?.message || e)
	}
}

/**
 * @param {{ ws: { on: (type: string, fn: (data: any) => void) => void }, stateStore: { on: (path: string, fn: (v: any) => void) => void } }} deps
 */
export function bindAudioMixerServer({ ws, stateStore }) {
	ws.on('state', () => void pull())
	stateStore.on('audioMixer', (value) => applyServerMixer(value))
	void pull()
}
