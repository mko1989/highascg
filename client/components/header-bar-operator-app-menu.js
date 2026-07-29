/**
 * header-bar-operator-app-menu.js — WO-387: the "All apps" half of the operator's Open window menu.
 *
 * The five curated tools stay pinned at the top of the menu (header-bar-operator-helper.js owns
 * those): they carry behaviour no .desktop file can express — Firefox opens on the isolated
 * operator profile rather than the one the kiosk holds, the file browser opens the media ingest
 * path, NVIDIA settings applies the display policy first. Everything else installed on the box is
 * listed below, straight from GET /api/system/apps.
 *
 * An app whose binary IS one of those tools comes back with `pinnedAction` set and is opened
 * through the pinned path instead. That is not cosmetic: `firefox-esr.desktop` launched raw would
 * open the DEFAULT Firefox profile — the kiosk's own — and the operator would get the "Close
 * Firefox" profile-lock modal instead of a browser.
 *
 * The list is fetched when the menu is first opened, not on every render: it changes only when a
 * package is installed, and the header must not add a request to the 1.5s helper poll.
 */

import { getOperatorApps } from '../lib/operator-gui-launch.js'

/** @type {Array<{ action: string, id: string, name: string, pinnedAction: string|null }>} */
let _apps = []
let _loaded = false

/** @returns {Promise<Array<object>>} */
export async function loadOperatorApps(force = false) {
	if (_loaded && !force) return _apps
	_apps = await getOperatorApps()
	_loaded = true
	return _apps
}

/**
 * Display name for an app action, for chip tooltips and the "X is open" button text. Returns null
 * for the pinned actions so the caller can fall back to its own labels.
 * @param {string|null} action
 * @returns {string|null}
 */
export function appLabelFor(action) {
	if (!action) return null
	return _apps.find((a) => a.action === action)?.name || null
}

/**
 * Build the app list, COLLAPSED behind a "Show all apps" row (owner 29.07: *"hide the all apps
 * unless show all apps clicked"*). The five pinned tools are what the menu is for day to day; the
 * full install list is the occasional case and should not be what the operator scrolls past.
 * @param {(action: string, label: string) => void} onPick called with the action to OPEN — already
 *   redirected to `pinnedAction` where one applies
 * @returns {{ element: HTMLElement, refresh: () => Promise<void>, collapse: () => void }}
 */
export function createOperatorAppSection(onPick) {
	const section = document.createElement('div')
	section.className = 'header-operator-helper__apps'
	section.style.cssText = 'display: flex; flex-direction: column;'

	const divider = document.createElement('div')
	divider.style.cssText = 'border-top: 1px solid var(--border); margin: 4px 2px;'

	const toggle = document.createElement('button')
	toggle.type = 'button'
	toggle.className = 'header-btn'
	toggle.style.cssText = 'text-align: left; border: none; background: transparent; opacity: 0.75;'

	const list = document.createElement('div')
	// Capped so a box with a full desktop install cannot push the menu off the operator screen.
	list.style.cssText = 'display: none; flex-direction: column; max-height: 46vh; overflow-y: auto;'

	const empty = document.createElement('div')
	empty.textContent = 'No other applications installed'
	empty.style.cssText = 'padding: 6px 8px; opacity: 0.6; font-size: 12px; display: none;'

	let _open = false

	function renderToggle() {
		toggle.textContent = _open ? 'Show all apps ▾' : 'Show all apps ▸'
		list.style.display = _open ? 'flex' : 'none'
		if (!_open) empty.style.display = 'none'
	}

	/** Re-collapse, so re-opening the menu always starts at the five pinned tools. */
	function collapse() {
		_open = false
		renderToggle()
	}

	toggle.addEventListener('click', (e) => {
		e.preventDefault()
		_open = !_open
		renderToggle()
		if (_open) void refresh()
	})

	section.append(divider, toggle, list, empty)
	renderToggle()

	async function refresh() {
		const apps = await loadOperatorApps()
		list.replaceChildren()
		empty.style.display = _open && !apps.length ? '' : 'none'
		for (const app of apps) {
			const action = app.pinnedAction || app.action
			const item = document.createElement('button')
			item.type = 'button'
			item.className = 'header-btn'
			item.style.cssText =
				'text-align: left; border: none; background: transparent; display: flex; align-items: center; gap: 8px;'

			const img = document.createElement('img')
			img.alt = ''
			img.width = 16
			img.height = 16
			img.style.cssText = 'width: 16px; height: 16px; object-fit: contain; flex: 0 0 16px;'
			// 404 = no renderable icon (Debian ships XPM for some) — drop it, keep the name aligned.
			img.src = `/api/system/operator-helper-icon?action=${encodeURIComponent(action)}`
			img.addEventListener('error', () => {
				img.style.visibility = 'hidden'
			})

			const label = document.createElement('span')
			label.textContent = app.name
			item.append(img, label)
			item.title = app.comment || app.name
			item.addEventListener('click', (e) => {
				e.preventDefault()
				onPick(action, app.name)
			})
			list.appendChild(item)
		}
	}

	return { element: section, refresh, collapse }
}
