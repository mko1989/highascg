/**
 * Web-side loader for optional feature modules (WO-30 T30.4).
 *
 * Fetches `GET /api/modules` to discover which optional modules are enabled on the server,
 * then dynamically imports their web bundles and injects their stylesheets. Keeps the base
 * client free of any static imports from `web/components/{previs,tracking,autofollow}-*`.
 *
 * Exposes:
 *   - `initOptionalModules(ctx)` — fetches + loads; resolves to `{ enabled, failed }`.
 *   - `isModuleEnabled(name)` — synchronous check after init; returns false before init finishes.
 *   - `getModuleContext()` — shared context object passed to each module's default export.
 */

const _state = {
	initialised: false,
	enabled: /** @type {string[]} */ ([]),
	bundles: /** @type {string[]} */ ([]),
	styles: /** @type {string[]} */ ([]),
	wsNamespaces: /** @type {string[]} */ ([]),
	context: /** @type {any} */ (null),
	/** @type {Array<{ id: string, label: string, mount: (el: HTMLElement) => (void | (() => void)) }>} */
	settingsTabs: /** @type {Array<{ id: string, label: string, mount: (el: HTMLElement) => (void | (() => void)) }>} */ ([]),
}

/** @param {string} href */
function injectStylesheet(href) {
	if (!href) return
	if (document.querySelector(`link[data-optional-module="${href}"]`)) return
	const link = document.createElement('link')
	link.rel = 'stylesheet'
	link.href = href
	link.setAttribute('data-optional-module', href)
	document.head.appendChild(link)
}

/**
 * Load the optional-module list from the server and bring any enabled bundles + styles online.
 * Idempotent: repeat calls are a no-op after the first resolves.
 * @param {any} ctx — shared context (stateStore, ws, api, …) forwarded to each module's default export.
 */
export async function initOptionalModules(ctx) {
	if (_state.initialised) return { enabled: _state.enabled, failed: [] }
	_state.context = ctx || null
	/** @type {Array<{ name: string, error: string }>} */
	const failed = []

	let info
	try {
		const res = await fetch('/api/modules', { credentials: 'same-origin' })
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		info = await res.json()
	} catch (e) {
		const msg = e && e.message ? e.message : String(e)
		console.warn('[optional-modules] GET /api/modules failed:', msg, '- running with no optional modules')
		_state.initialised = true
		return { enabled: [], failed: [{ name: '*', error: msg }] }
	}

	_state.enabled = Array.isArray(info.enabled) ? info.enabled.slice() : []
	_state.bundles = Array.isArray(info.bundles) ? info.bundles.slice() : []
	_state.styles = Array.isArray(info.styles) ? info.styles.slice() : []
	_state.wsNamespaces = Array.isArray(info.wsNamespaces) ? info.wsNamespaces.slice() : []

	if (_state.enabled.length === 0) {
		_state.initialised = true
		return { enabled: [], failed: [] }
	}

	for (const href of _state.styles) injectStylesheet(href)

	for (const url of _state.bundles) {
		try {
			const mod = await import(/* @vite-ignore */ url)
			if (mod && typeof mod.default === 'function') {
				try {
					await mod.default(_state.context)
				} catch (e) {
					const msg = e && e.message ? e.message : String(e)
					console.warn(`[optional-modules] default export threw for "${url}":`, msg)
					failed.push({ name: url, error: msg })
				}
			}
		} catch (e) {
			const msg = e && e.message ? e.message : String(e)
			console.warn(`[optional-modules] failed to import "${url}":`, msg)
			failed.push({ name: url, error: msg })
		}
	}

	_state.initialised = true
	console.info(
		`[optional-modules] loaded: [${_state.enabled.join(', ') || '—'}]` +
			(failed.length ? ` — ${failed.length} bundle(s) failed` : ''),
	)
	return { enabled: _state.enabled.slice(), failed }
}

/** @param {string} name */
export function isModuleEnabled(name) {
	return _state.initialised && _state.enabled.includes(name)
}

export function getOptionalModuleState() {
	return {
		initialised: _state.initialised,
		enabled: _state.enabled.slice(),
		wsNamespaces: _state.wsNamespaces.slice(),
	}
}

/**
 * Optional modules register extra Application Settings tabs (WO-30). Core `settings-modal.js`
 * reads this list — no static imports from module component paths.
 *
 * @param {{ id: string, label: string, mount: (container: HTMLElement) => void | (() => void) }} tab
 */
export function registerOptionalSettingsTab(tab) {
	if (!tab || !tab.id || !tab.label || typeof tab.mount !== 'function') return
	const i = _state.settingsTabs.findIndex((t) => t.id === tab.id)
	if (i >= 0) _state.settingsTabs[i] = tab
	else _state.settingsTabs.push(tab)
}

/** @returns {ReadonlyArray<{ id: string, label: string, mount: (container: HTMLElement) => void | (() => void) }>} */
export function getOptionalSettingsTabs() {
	return _state.settingsTabs.slice()
}
