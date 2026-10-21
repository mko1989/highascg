/**
 * WO-598 D — mirror of the node's GET /api/client-prefs (multiview presets, multiviewer 2+ layouts). The node is
 * the source of truth so the web client and the Godot client see the same setup; this cache keeps the callers
 * synchronous. Writes go through POST /api/client-prefs; other clients' writes arrive as WS `client_prefs`.
 */

import { api } from './api-client.js'

/** @type {Record<string, Record<string, any>>} */
const cache = { multiviewPresets: {}, multiviewLayouts: {} }
const listeners = new Set()

const emit = (detail) => listeners.forEach((fn) => fn(detail))

/** @returns {any} the stored value, or undefined when the node has none for this multiviewer */
export function getClientPref(key, n) {
	return cache[key]?.[String(n)]
}

/** Local + node write. value null removes. */
export function setClientPref(key, n, value) {
	if (!cache[key]) return
	if (value == null) delete cache[key][String(n)]
	else cache[key][String(n)] = JSON.parse(JSON.stringify(value))
	void api.post('/api/client-prefs', { key, n, value: value ?? null }).catch(() => {})
}

/** Fetch the node's copy (boot / reconnect). Resolves false when the node is unreachable. */
export async function loadClientPrefs() {
	try {
		const r = await api.get('/api/client-prefs')
		for (const k of Object.keys(cache)) cache[k] = r?.prefs?.[k] && typeof r.prefs[k] === 'object' ? r.prefs[k] : {}
		emit({ loaded: true })
		return true
	} catch {
		return false
	}
}

/** WS `client_prefs` { key, n, value } from another client's write. */
export function applyClientPrefsBroadcast(d) {
	if (!d || !cache[d.key]) return
	const had = cache[d.key][String(d.n)]
	if (JSON.stringify(had ?? null) === JSON.stringify(d.value ?? null)) return // our own write echoed back
	if (d.value == null) delete cache[d.key][String(d.n)]
	else cache[d.key][String(d.n)] = d.value
	emit({ key: d.key, n: Number(d.n) })
}

/** @param {(detail: { loaded?: boolean, key?: string, n?: number }) => void} fn  @returns {() => void} unsubscribe */
export function onClientPrefsChange(fn) {
	listeners.add(fn)
	return () => listeners.delete(fn)
}
