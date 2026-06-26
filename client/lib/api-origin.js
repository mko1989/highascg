/**
 * API origin resolution for split UI (Vite / Electron) vs same-origin (legacy / Companion).
 * @see docs/PLAN_SERVER_CLIENT_SPLIT.md
 */

/** Must match `client/lib/webui-port.json` (Vite / Electron operator UI). */
const WEBUI_PORT = 4350

/**
 * Companion path prefix when the SPA is hosted under /instance/<id>/.
 * @returns {string} e.g. `/instance/abc` or ``
 */
export function getCompanionPathPrefix() {
	if (typeof location === 'undefined') return ''
	const p = location.pathname.replace(/\/$/, '') || '/'
	const m = p.match(/^(\/instance\/[^/]+)/)
	return m ? m[1] : ''
}

function normalizeOrigin(origin) {
	return String(origin || '').trim().replace(/\/$/, '')
}

/** UI on :4350 (Vite / Electron) proxies `/api` — never cross-fetch loopback from env. */
function pageUsesBundledApiProxy() {
	if (typeof location === 'undefined') return false
	return String(location.port) === String(WEBUI_PORT)
}

function readMetaApiOrigin() {
	if (typeof document === 'undefined') return ''
	const el = document.querySelector('meta[name="highascg-api-origin"]')
	return normalizeOrigin(el?.content || '')
}

/**
 * Drop a loopback/baked dev origin when the page is opened on the playout host (or LAN).
 * @param {string} origin
 * @returns {string}
 */
function reconcileOriginWithPage(origin) {
	origin = normalizeOrigin(origin)
	if (!origin || typeof location === 'undefined') return origin
	try {
		const api = new URL(origin)
		const page = new URL(location.href)
		const loopback = api.hostname === '127.0.0.1' || api.hostname === 'localhost'
		if (loopback && page.hostname !== api.hostname) return ''
		if (page.port === api.port && page.hostname === api.hostname) return ''
	} catch {
		/* ignore */
	}
	return origin
}

/**
 * Explicit API origin (no trailing slash): Electron `window.__HIGHASCG_API_ORIGIN__` or meta / Vite env.
 * Empty string => same-origin relative `/api/...` (monolith, Companion, or :4350 proxy).
 * @returns {string}
 */
export function getApiOrigin() {
	if (pageUsesBundledApiProxy()) return ''

	if (typeof globalThis !== 'undefined' && globalThis.__HIGHASCG_API_ORIGIN__) {
		return reconcileOriginWithPage(globalThis.__HIGHASCG_API_ORIGIN__)
	}

	const meta = readMetaApiOrigin()
	if (meta) return reconcileOriginWithPage(meta)

	const built = typeof import.meta !== 'undefined' && import.meta.env?.VITE_HIGHASCG_API_ORIGIN
	if (built && String(built).trim()) {
		return reconcileOriginWithPage(String(built).trim())
	}
	return ''
}

/**
 * Base for `/api/...` fetch paths.
 * - Cross-origin: `http://host:4200` (+ optional Companion prefix if ever used on UI host)
 * - Same-origin: `` or `/instance/<id>`
 * @returns {string}
 */
export function getApiBase() {
	const companion = getCompanionPathPrefix()
	const origin = getApiOrigin()
	if (origin) return origin + companion
	return companion
}

/**
 * Absolute URL for server-hosted assets (`/templates/`, `/vendor/`, …).
 * @param {string} path must start with `/`
 * @returns {string}
 */
export function assetUrl(path) {
	const p = path.startsWith('/') ? path : `/${path}`
	const origin = getApiOrigin()
	if (origin) return origin + p
	return p
}

/**
 * Resolve any API path to a full URL suitable for `fetch` / `<img src>`.
 * @param {string} path e.g. `/api/media`
 * @returns {string}
 */
export function resolveApiUrl(path) {
	const p = path.startsWith('/') ? path : `/${path}`
	const base = getApiBase()
	if (base.startsWith('http://') || base.startsWith('https://')) return base + p
	if (typeof location !== 'undefined') return location.origin + base + p
	return base + p
}

/**
 * WebSocket URL for `/api/ws`.
 * @returns {string}
 */
export function getWsUrl() {
	const companion = getCompanionPathPrefix()
	const origin = getApiOrigin()
	if (origin) {
		const wsBase = origin.replace(/^http/, 'ws')
		return `${wsBase}${companion}/api/ws`
	}
	if (typeof location === 'undefined') return `ws://127.0.0.1:4200${companion}/api/ws`
	const pageOrigin = location.origin.replace(/^http/, 'ws')
	return `${pageOrigin}${companion}/api/ws`
}
