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
		/* WO-552: deliberately NO { force: true } here. This stops whatever timeline the operator
		 * happens to have open in the Timeline Editor — which is unrelated to, and may be the exact
		 * same id as, whatever is actually live on program. Previewing or taking some OTHER look
		 * must never be able to take PGM off air as a side effect: the server refuses this call
		 * outright whenever that timeline is currently routed to program, and the .catch below
		 * swallows that refusal exactly like any other network failure — silently a no-op, which is
		 * correct here. Only the Timeline Editor's own explicit Stop button (timeline-transport.js)
		 * is a deliberate enough operator action to pass force: true. */
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
