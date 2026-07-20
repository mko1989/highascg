/**
 * WO-284 — click wiring for the mixer "Screens" matrix (cross-screen audio routing).
 *
 * Shared by the Inspector mixer panel and the full mixer console so both surfaces behave
 * identically. Rendering never routes anything: the only call into the apply path is inside a
 * click handler, single-flighted per button so a wedged/dead destination cannot become a retry
 * storm on a live box.
 */

import { toggleCrossScreenAudio } from '../lib/audio-cross-screen-apply.js'
import { crossScreenReasonText } from '../lib/audio-cross-screen-routing.js'
import { showScenesToast } from './scenes-editor-support.js'

const ACTIVE_CLASS = 'audio-mixer-view__matrix-btn--active'

/**
 * @param {HTMLElement} root - the strip/row containing the matrix buttons
 * @param {object} row - mixer row record (needs ch, layer, sceneId, audioScreens)
 * @param {{ programChannels: Array<number|string>, channelMap: object|null|undefined }} ctx
 */
export function bindCrossScreenButtons(root, row, { programChannels, channelMap }) {
	const buttons = root?.querySelectorAll?.('[data-cross-screen]')
	if (!buttons || buttons.length === 0) return

	buttons.forEach((btn) => {
		btn.addEventListener('click', async (e) => {
			e.stopPropagation()
			if (btn.dataset.busy === '1') return
			const targetChannel = Number(btn.dataset.crossScreen)
			if (!Number.isFinite(targetChannel)) return

			const enable = !btn.classList.contains(ACTIVE_CLASS)
			btn.dataset.busy = '1'
			btn.disabled = true
			try {
				const res = await toggleCrossScreenAudio({
					row,
					targetChannel,
					enable,
					programChannels,
					channelMap,
				})
				if (!res.ok) {
					showScenesToast(crossScreenReasonText(res.reason), 'error')
					return
				}
				// Keep the in-memory row in step so a re-render without a state round-trip does
				// not flip the button back.
				row.audioScreens = res.targets
				btn.classList.toggle(ACTIVE_CLASS, enable)
			} catch (err) {
				showScenesToast(err?.message || String(err), 'error')
			} finally {
				btn.dataset.busy = '0'
				btn.disabled = false
			}
		})
	})
}
