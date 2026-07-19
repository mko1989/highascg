/**
 * WO-265 — CG Studio workspace tab.
 *
 * Injects a "CG Studio" tab button + pane into the workspace when the server reports the
 * `cg-studio` module as loaded (`isModuleEnabled` after `initOptionalModules`), hosting the
 * studio UI (served by the playout server at `/cg-studio/index.html`) in a lazy iframe that is
 * created on first activation and kept alive across tab switches so editor state survives.
 *
 * Operator-GUI mode: while this tab is foreground the video shape-holes must stay closed —
 * the studio page has no preview cells and any lingering rect would punch a hole through it.
 * Declared via `registerVideoBlockingTab` (no-op outside operator-GUI mode); the central
 * listener in operator-gui-mode drives the latch so multiple full-window tabs can't race it.
 */

import { isModuleEnabled } from '../lib/optional-modules.js'
import { resolveApiUrl } from '../lib/api-origin.js'
import { registerVideoBlockingTab } from '../lib/operator-gui-mode.js'

export const CG_STUDIO_TAB = 'cg-studio'

/** @returns {string} iframe URL for the mounted studio UI */
export function cgStudioIframeSrc() {
	return resolveApiUrl('/cg-studio/index.html')
}

/**
 * Create the iframe lazily inside the pane. Idempotent.
 * @param {HTMLElement} pane
 * @returns {HTMLIFrameElement}
 */
function ensureIframe(pane) {
	let iframe = pane.querySelector('iframe[data-cg-studio]')
	if (iframe) return /** @type {HTMLIFrameElement} */ (iframe)
	iframe = document.createElement('iframe')
	iframe.setAttribute('data-cg-studio', '1')
	iframe.title = 'CG Studio'
	iframe.src = cgStudioIframeSrc()
	iframe.style.position = 'absolute'
	iframe.style.inset = '0'
	iframe.style.width = '100%'
	iframe.style.height = '100%'
	iframe.style.border = '0'
	pane.style.position = 'relative'
	pane.appendChild(iframe)
	return /** @type {HTMLIFrameElement} */ (iframe)
}

/**
 * Mount the tab if the module is enabled. Call once after `initOptionalModules` resolved.
 * @returns {boolean} true when the tab was mounted
 */
export function initCgStudioTab() {
	if (!isModuleEnabled(CG_STUDIO_TAB)) return false
	const tabBar = document.querySelector('.workspace__tabs')
	const content = document.querySelector('.workspace__content')
	if (!tabBar || !content) return false
	if (tabBar.querySelector(`.tab[data-tab="${CG_STUDIO_TAB}"]`)) return true

	const btn = document.createElement('button')
	btn.className = 'tab'
	btn.dataset.tab = CG_STUDIO_TAB
	btn.textContent = 'CG Studio'
	tabBar.appendChild(btn)

	const pane = document.createElement('div')
	pane.className = 'tab-pane'
	pane.id = `tab-${CG_STUDIO_TAB}`
	content.appendChild(pane)

	registerVideoBlockingTab(CG_STUDIO_TAB)
	window.addEventListener('highascg-workspace-tab-activated', (ev) => {
		const tab = /** @type {CustomEvent} */ (ev).detail?.tab
		if (tab === CG_STUDIO_TAB) ensureIframe(pane)
	})
	return true
}
