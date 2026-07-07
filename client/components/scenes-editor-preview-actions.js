/**
 * Scenes editor — preview actions that coordinate with timeline playback.
 */

import { timelineState } from '../lib/timeline-state.js'

/**
 * @param {object} ctx
 */
export function createPreviewActions(ctx) {
	const { api, previewRuntime } = ctx

	async function stopActiveTimelineOnServer() {
		const tl = timelineState.getActive()
		if (!tl?.id) return
		await api.post(`/api/timelines/${encodeURIComponent(tl.id)}/stop`).catch(() => {})
	}

	async function sendSceneToPreviewWithTimelineClear(sceneId, opts) {
		await stopActiveTimelineOnServer()
		previewRuntime.sendSceneToPreviewCard(sceneId, opts)
	}

	return {
		stopActiveTimelineOnServer,
		sendSceneToPreviewWithTimelineClear,
	}
}
