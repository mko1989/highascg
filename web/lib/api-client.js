/**
 * HTTP API client for CasparCG module endpoints.
 * Uses relative paths (same origin as the page).
 * @see main_plan.md Prompt 11
 */

/**
 * Base path for API calls. When served via Companion at /instance/ID/,
 * we must always use /instance/ID regardless of SPA route (dashboard, timeline, etc).
 * In standalone mode (no /instance/ prefix), returns '' so calls go to /api/...
 */
export function getApiBase() {
	const p = location.pathname.replace(/\/$/, '') || '/'
	const m = p.match(/^(\/instance\/[^/]+)/)
	return m ? m[1] : ''
}
function getBase() {
	return getApiBase()
}

/** @param {string} path Absolute path starting with `/api/` */
export async function apiGet(path) {
	const url = getBase() + path
	const res = await fetch(url)
	if (!res.ok) {
		let detail = res.statusText
		try {
			const ct = res.headers.get('content-type') || ''
			if (ct.includes('application/json')) {
				const j = await res.json()
				if (j?.error) detail = j.error
			}
		} catch {}
		throw new Error(`HTTP ${res.status}: ${detail}`)
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
	const url = getBase() + path
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	})
	if (!res.ok) {
		let detail = res.statusText
		try {
			const ct = res.headers.get('content-type') || ''
			if (ct.includes('application/json')) {
				const j = await res.json()
				if (j?.error) detail = j.error
			}
		} catch {}
		throw new Error(`HTTP ${res.status}: ${detail}`)
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
	const url = getBase() + path
	const res = await fetch(url, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	})
	if (!res.ok) {
		let detail = res.statusText
		try {
			const ct = res.headers.get('content-type') || ''
			if (ct.includes('application/json')) {
				const j = await res.json()
				if (j?.error) detail = j.error
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
	getApiBase,
}

export default api
