/**
 * header-bar-operator-helper.js — WO-283 operator entry point: a BUTTON in the operator GUI header
 * that opens a foreign window (DeckLink setup, NVIDIA settings, file manager, browser) on top of
 * the shaped kiosk, and a matching "Back to GUI" that puts the kiosk back.
 *
 * The WO forbids a memorised keyboard shortcut, so this lives in the header's mid group next to
 * Server/Settings — the only chrome the kiosk shows. Rendered ONLY in operator-GUI mode
 * (`isOperatorGuiModeActive()`): on a normal desktop browser there is no kiosk to stack against,
 * and the Settings modal's existing launch buttons already cover that case.
 *
 * The button mirrors server state rather than owning it. A 1.5s poll of
 * GET /api/system/operator-helper-window means a helper the operator simply closed — or one that
 * crashed and was reaped by the server watchdog (src/system/operator-helper-window.js) — flips the
 * button back to "Open window" without any client-side bookkeeping. That is deliberate: the client
 * must never be the thing that decides the kiosk is restored.
 */

import {
	openOperatorHelperWindow,
	closeOperatorHelperWindow,
	getOperatorHelperWindowState,
	getOperatorHelperTaskbar,
	operatorHelperTaskbarAction,
} from '../lib/operator-gui-launch.js'
import { isOperatorGuiModeActive } from '../lib/operator-gui-mode.js'

/** Same vocabulary as HELPER_ACTIONS in src/system/operator-helper-window.js. @readonly */
const HELPER_ITEMS = [
	['firefox', 'Web browser'],
	['file-manager', 'File browser'],
	['desktopvideo_setup', 'DeckLink setup'],
	['desktop_video_updater', 'DeckLink updater'],
	['nvidia-settings', 'NVIDIA settings'],
]

const POLL_MS = 1500

/** @type {ReturnType<typeof setInterval>|null} */
let _pollTimer = null

/**
 * @param {HTMLElement} container element to append the control into (the header mid group)
 * @returns {HTMLElement|null} the wrapper, or null when not in operator-GUI mode
 */
export function initHeaderBarOperatorHelper(container) {
	if (!container || !isOperatorGuiModeActive()) return null

	const wrap = document.createElement('div')
	wrap.className = 'header-operator-helper'
	wrap.style.cssText = 'position: relative; display: inline-flex; gap: 4px;'

	const openBtn = document.createElement('button')
	openBtn.type = 'button'
	openBtn.className = 'header-btn'
	openBtn.textContent = 'Open window ▾'
	openBtn.title =
		'Open a system window (DeckLink setup, NVIDIA, file browser, web browser) ON TOP of the operator GUI. The GUI comes back by itself when you close it.'

	const backBtn = document.createElement('button')
	backBtn.type = 'button'
	backBtn.className = 'header-btn'
	backBtn.textContent = 'Back to GUI'
	backBtn.title = 'Put the operator GUI back on top now (does not close the other window)'
	backBtn.style.display = 'none'

	const menu = document.createElement('div')
	menu.className = 'header-operator-helper__menu'
	menu.style.cssText =
		'position: absolute; top: 100%; left: 0; margin-top: 4px; z-index: 9000; display: none; flex-direction: column; min-width: 180px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px; box-shadow: 0 6px 18px rgba(0,0,0,0.45);'

	function closeMenu() {
		menu.style.display = 'none'
	}

	/** @param {string} state @param {string|null} action */
	function render(state, action) {
		const busy = state !== 'idle'
		openBtn.disabled = busy
		openBtn.textContent = busy
			? `${labelFor(action)}${state === 'opening' ? ' opening…' : ' is open'}`
			: 'Open window ▾'
		backBtn.style.display = busy ? '' : 'none'
		if (busy) closeMenu()
	}

	/** @param {string|null} action */
	function labelFor(action) {
		return HELPER_ITEMS.find(([id]) => id === action)?.[1] || 'Window'
	}

	for (const [action, label] of HELPER_ITEMS) {
		const item = document.createElement('button')
		item.type = 'button'
		item.className = 'header-btn'
		item.textContent = label
		item.style.cssText = 'text-align: left; border: none; background: transparent;'
		item.addEventListener('click', async (e) => {
			e.preventDefault()
			closeMenu()
			// WO-317: with the taskbar active, launch through the per-helper action so more than one
			// window can run at once; otherwise the WO-283 single-helper open (mutually exclusive).
			if (_taskbarOn) {
				const r = await operatorHelperTaskbarAction(action, action)
				if (r.error) window.showToast?.(r.error, 'error')
				else window.showToast?.(`${label} opening — use the taskbar to send it behind the GUI.`, 'info')
				void refresh()
				return
			}
			render('opening', action)
			const r = await openOperatorHelperWindow(action)
			if (r.error) {
				window.showToast?.(r.error, 'error')
				render('idle', null)
				return
			}
			window.showToast?.(`${label} opening — the operator GUI returns when you close it.`, 'info')
			void refresh()
		})
		menu.appendChild(item)
	}

	openBtn.addEventListener('click', (e) => {
		e.preventDefault()
		menu.style.display = menu.style.display === 'none' ? 'flex' : 'none'
	})

	backBtn.addEventListener('click', async (e) => {
		e.preventDefault()
		backBtn.disabled = true
		try {
			const r = await closeOperatorHelperWindow()
			if (r.error) window.showToast?.(r.error, 'error')
		} finally {
			backBtn.disabled = false
			void refresh()
		}
	})

	document.addEventListener('click', (e) => {
		if (!wrap.contains(/** @type {Node} */ (e.target))) closeMenu()
	})

	// WO-317: taskbar strip of running helpers, shown ONLY when the server reports the multi-helper
	// feature enabled. When off, this stays empty and the WO-283 single button above is the whole UI.
	const taskbar = document.createElement('div')
	taskbar.className = 'header-operator-taskbar'
	taskbar.style.cssText = 'display: inline-flex; gap: 4px; align-items: center;'
	let _taskbarOn = false

	function renderTaskbar(helpers) {
		taskbar.replaceChildren()
		for (const h of helpers) {
			if (h.state !== 'open' && h.state !== 'launching') continue
			const chip = document.createElement('button')
			chip.type = 'button'
			// Owner (todos27.07.26): circular chips with the app's SYSTEM icon inside — red ring =
			// raised over the GUI, gray ring = parked/hidden, pulsing = still launching.
			chip.className = `header-operator-taskbar__chip${h.parked || h.state === 'launching' ? '' : ' active'}${h.state === 'launching' ? ' launching' : ''}`
			const action = h.info?.action || h.id
			const label = labelFor(action)
			const img = document.createElement('img')
			img.className = 'header-operator-taskbar__icon'
			img.alt = label
			img.src = `/api/system/operator-helper-icon?action=${encodeURIComponent(action)}`
			// 404 (no system icon) → first letter in the circle instead.
			img.addEventListener('error', () => {
				img.remove()
				chip.textContent = label.slice(0, 1).toUpperCase()
			})
			chip.appendChild(img)
			// A parked helper is behind the video; a raised one is on top. The chip shows which and
			// clicking toggles it — click a parked chip to bring it forward, a raised one to send it back.
			chip.title = h.state === 'launching' ? `${label} launching…` : h.parked ? `Bring ${label} to front` : `Send ${label} behind the GUI`
			chip.disabled = h.state === 'launching'
			chip.addEventListener('click', async (e) => {
				e.preventDefault()
				chip.disabled = true
				const r = await operatorHelperTaskbarAction(h.id, h.info?.action || h.id)
				if (r.error) window.showToast?.(r.error, 'error')
				else if (Array.isArray(r.helpers)) renderTaskbar(r.helpers)
				void refresh()
			})
			taskbar.appendChild(chip)
		}
	}

	async function refresh() {
		const s = await getOperatorHelperWindowState()
		render(s.state, s.action)
		// Poll the taskbar too; cheap, and it is the only signal that a helper crashed/closed.
		const tb = await getOperatorHelperTaskbar()
		_taskbarOn = tb.enabled
		if (tb.enabled) {
			// With the taskbar active, launching is per-helper (multiple can run) — the menu items
			// route through the taskbar action instead of the single-helper open.
			renderTaskbar(tb.helpers)
		} else {
			taskbar.replaceChildren()
		}
	}

	wrap.append(openBtn, backBtn, menu, taskbar)
	container.appendChild(wrap)

	if (_pollTimer) clearInterval(_pollTimer)
	void refresh()
	_pollTimer = setInterval(() => void refresh(), POLL_MS)

	return wrap
}

export function stopHeaderBarOperatorHelper() {
	if (_pollTimer) {
		clearInterval(_pollTimer)
		_pollTimer = null
	}
}
