/**
 * HTTP API client for CasparCG module endpoints.
 * @see client/lib/api-origin.js — cross-origin API when UI is split from server
 */

import { getApiBase, getApiOrigin, resolveApiUrl } from './api-origin.js'
import { getAppStateStore } from './app-runtime.js'

export { getApiBase, getApiOrigin, resolveApiUrl } from './api-origin.js'

const FETCH_CREDENTIALS = { credentials: 'include' }

function requestBase() {
	return getApiBase()
}

/** @param {string} path Absolute path starting with `/api/` */
export async function apiGet(path) {
	if (path === '/api/media' && getAppStateStore()?.isOffline?.()) {
		const placeholders = window.placeholderState?.getAll() || []
		try {
			const res = await fetch(requestBase() + path, FETCH_CREDENTIALS)
			if (res.ok) {
				const ct = res.headers.get('content-type') || ''
				if (ct.includes('application/json')) {
					const data = await res.json()
					return [...(Array.isArray(data) ? data : []), ...placeholders]
				}
			}
		} catch {
			return placeholders
		}
	}
	const url = requestBase() + path
	const res = await fetch(url, FETCH_CREDENTIALS)
	if (!res.ok) {
		let detail = res.statusText
		let parsed = null
		try {
			const ct = res.headers.get('content-type') || ''
			if (ct.includes('application/json')) {
				parsed = await res.json()
				if (parsed?.error) detail = parsed.error
				else if (parsed?.message) detail = parsed.message
				else if (parsed?.detail) detail = parsed.detail
				if (parsed?.path) detail += '\n' + parsed.path
				if (parsed?.hint) detail += '\n\n' + parsed.hint
			}
		} catch {}
		const err = new Error(`HTTP ${res.status}: ${detail}`)
		err.status = res.status
		if (parsed?.reason) err.reason = parsed.reason
		/* WO-329B: surface the server rev on stale_rev 409s so autosave can adopt + re-push (LWW). */
		if (parsed?.storedRev != null) err.storedRev = parsed.storedRev
		throw err
	}
	const ct = res.headers.get('content-type') || ''
	if (ct.includes('application/json')) return res.json()
	return res.text()
}

function notifyPlaybackMatrixFromResponse(json) {
	if (json && typeof json.playbackMatrix === 'object' && json.playbackMatrix) {
		try {
			window.dispatchEvent(new CustomEvent('casparcg-playback-matrix', { detail: json.playbackMatrix }))
		} catch {
			/* non-browser */
		}
	}
}

/** @param {string} path @param {object|string} [body] JSON-serializable body */
export async function apiPost(path, body = {}) {
	const url = requestBase() + path
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body),
		...FETCH_CREDENTIALS,
	})
	if (!res.ok) {
		let detail = res.statusText
		let parsed = null
		try {
			const ct = res.headers.get('content-type') || ''
			if (ct.includes('application/json')) {
				parsed = await res.json()
				if (parsed?.error) detail = parsed.error
				else if (parsed?.message) detail = parsed.message
				else if (parsed?.detail) detail = parsed.detail
				if (parsed?.path) detail += '\n' + parsed.path
				if (parsed?.hint) detail += '\n\n' + parsed.hint
			}
		} catch {}
		const err = new Error(`HTTP ${res.status}: ${detail}`)
		err.status = res.status
		if (parsed?.reason) err.reason = parsed.reason
		/* WO-329B: surface the server rev on stale_rev 409s so autosave can adopt + re-push (LWW). */
		if (parsed?.storedRev != null) err.storedRev = parsed.storedRev
		throw err
	}
	const ct = res.headers.get('content-type') || ''
	if (ct.includes('application/json')) {
		const json = await res.json()
		notifyPlaybackMatrixFromResponse(json)
		return json
	}
	return res.text()
}

/** @param {string} path @param {object|string} [body] */
export async function apiPut(path, body = {}) {
	const url = requestBase() + path
	const res = await fetch(url, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body),
		...FETCH_CREDENTIALS,
	})
	if (!res.ok) {
		let detail = res.statusText
		let parsed = null
		try {
			const ct = res.headers.get('content-type') || ''
			if (ct.includes('application/json')) {
				parsed = await res.json()
				if (parsed?.error) detail = parsed.error
				else if (parsed?.message) detail = parsed.message
				else if (parsed?.detail) detail = parsed.detail
				if (parsed?.path) detail += '\n' + parsed.path
				if (parsed?.hint) detail += '\n\n' + parsed.hint
			}
		} catch {}
		const err = new Error(`HTTP ${res.status}: ${detail}`)
		err.status = res.status
		if (parsed?.reason) err.reason = parsed.reason
		/* WO-329B: surface the server rev on stale_rev 409s so autosave can adopt + re-push (LWW). */
		if (parsed?.storedRev != null) err.storedRev = parsed.storedRev
		throw err
	}
	const ct = res.headers.get('content-type') || ''
	if (ct.includes('application/json')) return res.json()
	return res.text()
}

export async function apiDelete(path) {
	const url = requestBase() + path
	const res = await fetch(url, { method: 'DELETE', ...FETCH_CREDENTIALS })
	if (!res.ok) {
		let detail = res.statusText
		try {
			const ct = res.headers.get('content-type') || ''
			if (ct.includes('application/json')) {
				const j = await res.json()
				if (j?.error) detail = j.error
				else if (j?.message) detail = j.message
			}
		} catch {}
		throw new Error(`HTTP ${res.status}: ${detail}`)
	}
	const ct = res.headers.get('content-type') || ''
	if (ct.includes('application/json')) return res.json()
	return res.text()
}

export const api = {
	get: apiGet,
	post: apiPost,
	put: apiPut,
	delete: apiDelete,
	getApiBase,
	getApiOrigin,
	resolveApiUrl,
}

export default api
