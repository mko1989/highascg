/**
 * WO-572 Part C follow-up — deck card state/badge for audio-only looks, split out of
 * scene-list-column.js purely to stay under the repo's 500-line file cap.
 */

import { resolveAudioOnlyLookIdsForMain } from '../lib/scene-live-main-sync.js'

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
 * @param {HTMLElement} card
 * @param {{ audioOnly: boolean, audioOnlyLive: boolean, audioOnlyPreview: boolean }} state
 */
export function appendAudioOnlyBadge(card, { audioOnly, audioOnlyLive, audioOnlyPreview }) {
	if (!audioOnly) return
	const badge = document.createElement('span')
	badge.className = 'scenes-card__audio-only-badge'
	badge.textContent = '🔊'
	badge.title = audioOnlyLive
		? 'Audio-only look — playing now'
		: audioOnlyPreview
			? 'Audio-only look — staged on preview'
			: "Audio-only look — plays without touching this screen's video layers"
	card.appendChild(badge)
}
