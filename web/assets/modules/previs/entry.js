/**
 * Previs module web entrypoint (WO-17 / WO-30).
 *
 * Loaded dynamically by `web/lib/optional-modules.js` when the server reports the `previs`
 * module as enabled. Receives a shared context `{ stateStore, ws, api, sceneState,
 * settingsState, streamState }` from the base app.
 *
 * What this file does now (Phase 1 of WO-17):
 *   - Calls `/api/previs/health` to confirm the server side is up.
 *   - Attaches a 2D/3D toggle to the PGM compose cell via `previs-pgm-3d.js`.
 *   - Handles the dynamic lifetime: if the preview panel re-renders (collapsed, layout
 *     change), the mount is torn down and re-attached when the PGM cell reappears.
 *
 * The actual PGM cell is built by `web/components/preview-canvas-panel.js` as part of the
 * main app bootstrap. This entry is loaded from `web/app.js` in parallel with the main
 * bootstrap, so the PGM cell may not exist yet when we arrive — we poll briefly, then use
 * a `MutationObserver` on `document.body` to catch later mounts.
 *
 * Keep this file small — delegate all real work to sibling files under `web/lib/previs-*`
 * and `web/components/previs-*`.
 */

import { createPrevisPgm3d } from '/components/previs-pgm-3d.js'
import { readMergedPrevisUiFromStorage } from '/lib/previs-state.js'
import { registerOptionalSettingsTab } from '/lib/optional-modules.js'
import { mountPrevisSettingsModalPane } from '/components/previs-settings-modal-pane.js'

const MAX_INITIAL_POLL_MS = 5000
const POLL_INTERVAL_MS = 250

function requestPrvPctOverride(value) {
	try {
		document.dispatchEvent(new CustomEvent('previs:set-prv-pct', { detail: { value } }))
	} catch (err) {
		console.warn('[previs] failed to dispatch split override', err)
	}
}

/**
 * @param {{ stateStore: any, ws: any, api: any, sceneState: any, settingsState: any, streamState: any }} ctx
 */
export default async function initPrevisModule(ctx) {
	console.info('[previs] module loaded')

	registerOptionalSettingsTab({
		id: 'previs',
		label: '3D Previs',
		mount: mountPrevisSettingsModalPane,
	})

	try {
		const res = await fetch('/api/previs/health', { credentials: 'same-origin' })
		if (res.ok) {
			const info = await res.json()
			console.info('[previs] /api/previs/health →', info)
		}
	} catch (e) {
		console.warn('[previs] health check failed:', e && e.message ? e.message : e)
	}

	const controller = new PgmCellController()
	controller.start()

	return {
		ready: true,
		destroy: () => controller.stop(),
	}
}

class PgmCellController {
	constructor() {
		/** @type {HTMLElement | null} */
		this.currentCell = null
		/** @type {ReturnType<typeof createPrevisPgm3d> | null} */
		this.currentHandle = null
		/** @type {MutationObserver | null} */
		this.observer = null
		this.disposed = false
		this.pollStart = 0
	}

	start() {
		this.pollStart = performance.now()
		this.observer = new MutationObserver(() => this.sync())
		this.observer.observe(document.body, { childList: true, subtree: true })
		this.pollUntilMounted()
	}

	stop() {
		this.disposed = true
		if (this.observer) this.observer.disconnect()
		this.observer = null
		this.detach()
	}

	pollUntilMounted() {
		if (this.disposed) return
		this.sync()
		if (this.currentCell) return
		if (performance.now() - this.pollStart > MAX_INITIAL_POLL_MS) return
		setTimeout(() => this.pollUntilMounted(), POLL_INTERVAL_MS)
	}

	sync() {
		if (this.disposed) return
		const cell = /** @type {HTMLElement | null} */ (
			document.querySelector('.preview-panel__compose-cell--pgm')
		)
		if (cell === this.currentCell) return
		this.detach()
		if (!cell) return
		try {
			this.currentCell = cell
			this.currentHandle = createPrevisPgm3d({
				cellEl: cell,
				onExpand: (active) => {
					console.info('[previs] pgm-3d expand →', active)
					const ui = readMergedPrevisUiFromStorage()
					const raw = typeof ui.prvFractionWhen3d === 'number' ? ui.prvFractionWhen3d : 0.2
					const frac = Math.min(0.5, Math.max(0.05, raw))
					requestPrvPctOverride(active ? frac : null)
				},
			})
			console.info('[previs] 2D/3D toggle attached to PGM cell')
		} catch (err) {
			console.error('[previs] failed to attach pgm-3d toggle', err)
			this.currentCell = null
			this.currentHandle = null
		}
	}

	detach() {
		if (this.currentHandle) {
			try { this.currentHandle.destroy() } catch (err) { console.warn('[previs] destroy threw', err) }
			requestPrvPctOverride(null)
		}
		this.currentHandle = null
		this.currentCell = null
	}
}
