/**
 * WO-319 — header "Live preview" toggle. Flips the operator live canvas (NVENC→WebCodecs) on/off
 * for THIS client's preview surfaces (compose preview, looks editor, multiview editor). Persisted
 * per-client; each enabled client decodes the shared stream (one NVENC encode on the box).
 *
 * Shown only when the server reports the feature available (GET /api/gui-stream/status enabled) AND
 * the browser has WebCodecs — otherwise there is nothing to toggle and the button stays hidden, so
 * a client that can't decode never offers a dead control. Availability is re-probed by the module.
 */

import {
	initOperatorLiveCanvas,
	setOperatorLiveCanvasEnabled,
	isOperatorLiveCanvasEnabled,
	subscribeOperatorLiveCanvasState,
} from './preview-canvas-live-stream.js'

/**
 * @param {HTMLElement} container header group to append into
 * @returns {HTMLElement} the button (hidden until the feature is available)
 */
export function initHeaderBarLivePreviewToggle(container) {
	const btn = document.createElement('button')
	btn.type = 'button'
	btn.className = 'header-btn'
	btn.style.display = 'none'
	btn.title =
		'Show the live composed output (hardware-encoded, low latency) in the preview surfaces instead of the ~1 Hz snapshot. Per-client; toggling on starts a decode in this browser.'

	function render(state) {
		if (!state.available) {
			btn.style.display = 'none'
			return
		}
		btn.style.display = ''
		const on = state.enabled
		btn.textContent = on ? (state.hasFrame ? '● Live preview' : '◌ Live preview…') : '○ Live preview'
		btn.classList.toggle('header-btn--active', on)
		btn.setAttribute('aria-pressed', on ? 'true' : 'false')
	}

	btn.addEventListener('click', (e) => {
		e.preventDefault()
		setOperatorLiveCanvasEnabled(!isOperatorLiveCanvasEnabled())
	})

	subscribeOperatorLiveCanvasState(render)
	// Kick availability probing + restore persisted state; render fires via the state subscription.
	initOperatorLiveCanvas()
	render({ available: false, enabled: isOperatorLiveCanvasEnabled(), hasFrame: false })

	container.appendChild(btn)
	return btn
}
