/**
 * @file live-view.js
 * A reusable component that manages a WebRTC video stream for a given CasparCG channel.
 */

import { createLiveView } from '../lib/webrtc-client.js'
import { streamState } from '../lib/stream-state.js'

/**
 * Creates and mounts a live video stream.
 * 
 * @param {HTMLElement} container - The element to append the video to.
 * @param {string} streamName - e.g., 'pgm_1', 'prv_1', 'multiview'.
 * @returns {Object} - { destroy, updateStream }
 */
export function initLiveView(container, streamName) {
	let liveView = null
	let unsub = null

	function setup() {
		if (liveView) liveView.destroy()
		
		const isAudioFocused = streamState.activeAudioSource === streamName
		
		liveView = createLiveView(streamName, container, {
			audioEnabled: isAudioFocused
		})

		// Track audio focus changes
		if (!unsub) {
			unsub = streamState.subscribe((state) => {
				const focused = state.activeAudioSource === streamName
				const muted = state.monitoringMuted
				if (liveView) {
					liveView.setAudioEnabled(focused && !muted)
				}
			})
		}
	}

	if (streamName) setup()

	return {
		updateStream(newName) {
			if (newName === streamName) return
			streamName = newName
			setup()
		},
		destroy() {
			if (liveView) liveView.destroy()
			if (unsub) unsub()
		},
	}
}

/**
 * Compose / timeline preview: PRV and PGM WebRTC side-by-side (or stacked), not one video on top of the other.
 * @param {HTMLElement} prvContainer
 * @param {HTMLElement} pgmContainer
 * @returns {{ destroy: () => void }}
 */
export function initDualComposeLiveView(prvContainer, pgmContainer) {
	const prv = initLiveView(prvContainer, 'prv_1')
	const pgm = initLiveView(pgmContainer, 'pgm_1')
	return {
		kind: 'dual',
		updateStreams(prvName, pgmName) {
			if (prvName) prv.updateStream(prvName)
			if (pgmName) pgm.updateStream(pgmName)
		},
		destroy() {
			prv.destroy()
			pgm.destroy()
		},
	}
}
