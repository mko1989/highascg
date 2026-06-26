/**
 * WO-17 / WO-30 — mount the collapsible Scene settings form inside Application Settings.
 *
 * Uses {@link getSharedPrevisState} so edits match the 3D overlay and persist to the same
 * `localStorage` key. Registered by `web/assets/modules/previs/entry.js` via
 * `registerOptionalSettingsTab` (core never imports this file statically).
 */

import { getSharedPrevisState } from '../lib/previs-state.js'
import { createPrevisSettingsPanel } from './previs-settings-panel.js'

/**
 * @param {HTMLElement} container
 * @returns {() => void}
 */
export function mountPrevisSettingsModalPane(container) {
	container.replaceChildren()
	const intro = document.createElement('p')
	intro.className = 'settings-note'
	intro.style.marginTop = '0'
	intro.innerHTML =
		'These values are stored in the browser (same as the <strong>Scene settings</strong> panel on the 3D overlay). ' +
		'Antialiasing applies the next time you enter 3D mode.'

	const state = getSharedPrevisState()
	const panel = createPrevisSettingsPanel({ state })
	panel.el.classList.add('previs-settings-modal-pane')
	panel.el.open = true

	container.append(intro, panel.el)

	return () => {
		try {
			panel.dispose()
		} catch {}
	}
}
