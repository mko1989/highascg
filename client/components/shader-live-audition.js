/**
 * shader-live-audition.js — templates-browser shader rows dispatch `shader-audition-request`;
 * while Shader Live is open this stages the shader on the preview bus so it appears in the
 * editor's instance list (split out of shader-live-editor.js for the 500-line limit).
 *
 * @param {{ stateStore: object, isOpen: () => boolean, select: (instanceKey: string) => void }} deps
 */

import { api } from '../lib/api-client.js'
import { sceneState } from '../lib/scene-state.js'

export function installShaderAudition({ stateStore, isOpen, select }) {
/* todos27: templates-browser shader rows dispatch this on click. Only ACT while shaders
 * mode is open — outside it the event fizzles and the browser behaves as before. Stages an
 * ephemeral one-layer look on the active main's preview bus via the normal take pipeline,
 * so scene.live updates and the instance dropdown picks it up. */
document.addEventListener('shader-audition-request', (e) => {
	if (!isOpen()) return
	const id = String(e?.detail?.id || '')
	const label = String(e?.detail?.label || id)
	if (!id) return
	void (async () => {
		try {
			const cm = stateStore.getState()?.channelMap || {}
			const mIdx = Math.max(0, Number(sceneState.activeScreenIndex) || 0)
			const programCh = cm.programChannels?.[mIdx]
			if (!programCh) throw new Error('no program channel for the active main')
			const incomingScene = {
				id: `shader-audition-${mIdx}`,
				name: `Audition ${label}`,
				layers: [
					{ layerNumber: 10, source: { type: 'template', value: id }, opacity: 1, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } },
				],
			}
			await api.post('/api/scene/take', { channel: programCh, target: 'preview', forceCut: true, useServerLive: true, incomingScene })
			const sid = (id.toLowerCase().match(/sh-[a-z0-9-]+$/) || [])[0]
			const prvCh = cm.previewChannels?.[mIdx]
			if (sid && prvCh) select(`${sid}@${prvCh}-10`)
			window.showToast?.(`${label} → preview`, 'info')
		} catch (err) {
			window.showToast?.(`Audition failed: ${err?.message || err}`, 'error')
		}
	})()
})
}
