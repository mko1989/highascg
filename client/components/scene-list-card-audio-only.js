/**
 * WO-572 Part C follow-up — deck card state and stop control for audio-only looks, split out of
 * scene-list-column.js purely to stay under the repo's 500-line file cap.
 */

import { resolveAudioOnlyLookIdsForMain } from '../lib/scene-live-main-sync.js'
import { api } from '../lib/api-client.js'

/**
 * @param {object} sc — the look/scene this card renders
 * @param {number} col — main/screen index
 * @param {object} cm — channel map
 * @param {() => Record<string, { sceneId?: string }>} getLiveAudioOnly
 * @param {(id: string) => boolean} sceneExists
 * @returns {{ audioOnly: boolean, audioOnlyLive: boolean, audioOnlyPreview: boolean }}
 */
export function resolveAudioOnlyCardState(sc, col, cm, getLiveAudioOnly, sceneExists) {
	const audioOnly = !!sc.audioOnlyLook
	if (!audioOnly) return { audioOnly: false, audioOnlyLive: false, audioOnlyPreview: false }
	// Audio-only looks live in a SEPARATE map (scene.liveAudioOnly) — deliberately distinct
	// classes/ring color from the video look's --live/--preview so operators never read "this
	// audio-only card is live" as "this replaced the screen".
	const ids = resolveAudioOnlyLookIdsForMain(col, getLiveAudioOnly() || {}, cm, sceneExists)
	const audioOnlyLive = ids.pgmLookId === sc.id
	const audioOnlyPreview = !audioOnlyLive && ids.prvLookId === sc.id
	return { audioOnly, audioOnlyLive, audioOnlyPreview }
}

/** @param {{ audioOnly: boolean, audioOnlyLive: boolean, audioOnlyPreview: boolean }} state */
export function audioOnlyCardClasses({ audioOnly, audioOnlyLive, audioOnlyPreview }) {
	return (
		(audioOnly ? ' scenes-card--audio-only' : '') +
		(audioOnlyLive ? ' scenes-card--audio-live' : '') +
		(audioOnlyPreview ? ' scenes-card--audio-preview' : '')
	)
}

/**
 * WO-572: audio-only cards get a ■ Stop in place of CUT (a cut means nothing for audio). Without
 * it there was no deck control to stop a playing audio-only look at all — taking one only ever
 * started it, and the sole Stop lived in the compact mixer row.
 * @param {HTMLElement} footer
 * @param {{ audioOnly: boolean, audioOnlyLive: boolean, audioOnlyPreview: boolean }} state
 * @returns {boolean} true when the CUT button should be dropped for this card
 */
export function appendAudioOnlyStopButton(footer, { audioOnly, audioOnlyLive, audioOnlyPreview }) {
	if (!audioOnly) return false
	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'scenes-btn scenes-btn--sm scenes-btn--icon'
	btn.dataset.action = 'audio-stop'
	btn.textContent = '■'
	btn.title = 'Stop this audio-only look'
	btn.setAttribute('aria-label', 'Stop audio-only look')
	btn.disabled = !audioOnlyLive && !audioOnlyPreview
	footer.appendChild(btn)
	return true
}

/**
 * Stop the audio-only look on this main's PGM (live) or PRV (staged) channel.
 * @param {{ audioOnlyLive: boolean }} state
 * @param {number} col
 * @param {{ programChannels?: number[], previewChannels?: number[] }} cm
 */
export async function stopAudioOnlyForCard(state, col, cm) {
	const ch = Number((state.audioOnlyLive ? cm?.programChannels : cm?.previewChannels)?.[col])
	if (!Number.isFinite(ch) || ch < 1) return
	await api.post('/api/scene/audio-only/stop', { channel: ch })
}
