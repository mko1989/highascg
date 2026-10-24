'use strict'

/**
 * WO-734 — reads OSCPoint's variables from Companion's HTTP API (v4): which connections run the zinc-oscpoint module
 * (`GET /api/connections`, cached), then `GET /api/variable/<label>/<name>/value` (plain text; 404 = unknown name or the
 * connection is disabled). Host and port are HighAsCG's Companion settings (the same ones its button presses use).
 */

const MODULE_ID = 'zinc-oscpoint'
const CONNECTIONS_TTL_MS = 30_000
const TIMEOUT_MS = 800

/**
 * @param {{ base: () => string, fetchImpl?: typeof fetch, now?: () => number }} o  base() = 'http://host:port'
 */
function createCompanionVars(o) {
	const fetchImpl = o.fetchImpl || fetch
	const now = o.now || Date.now
	let cache = { at: 0, base: '', labels: [], error: '' }

	async function get(url) {
		const r = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
		return { status: r.status, text: await r.text() }
	}

	/** Enabled OSCPoint connections: `{ labels, error }`. */
	async function connections() {
		const base = o.base()
		if (cache.base === base && now() - cache.at < CONNECTIONS_TTL_MS) return cache
		let labels = []
		let error = ''
		try {
			const r = await get(`${base}/api/connections`)
			const list = r.status === 200 ? JSON.parse(r.text) : null
			if (!Array.isArray(list)) throw new Error(`no Companion at ${base.replace(/^https?:\/\//, '')} (HTTP ${r.status})`)
			labels = list.filter((c) => c && c.moduleId === MODULE_ID && c.enabled).map((c) => String(c.label))
		} catch (e) {
			error = e instanceof SyntaxError ? `no Companion at ${base.replace(/^https?:\/\//, '')}` : e.message || String(e)
		}
		cache = { at: now(), base, labels, error }
		return cache
	}

	/** @returns {Promise<Record<string, string|null>>} name → value (null = not there) */
	async function read(label, names) {
		const base = o.base()
		const vals = await Promise.all(
			names.map(async (n) => {
				try {
					const r = await get(`${base}/api/variable/${encodeURIComponent(label)}/${encodeURIComponent(n)}/value`)
					return r.status === 200 ? r.text : null
				} catch {
					return null
				}
			}),
		)
		return Object.fromEntries(names.map((n, i) => [n, vals[i]]))
	}

	/** Forget the connection list (a read failed: the connection may be gone). */
	function invalidate() {
		cache = { ...cache, at: 0 }
	}

	return { connections, read, invalidate }
}

module.exports = { createCompanionVars, MODULE_ID, CONNECTIONS_TTL_MS }
