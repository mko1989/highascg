/**
 * WO-598 D — mirror of the node's GET /api/client-prefs (multiview presets, multiviewer 2+ layouts; global: GPU
 * layout rows, DeckLink rear order, hardware policy). The node is the source of truth so the web client and the
 * Godot client see the same setup; this cache keeps the callers synchronous. Writes go through POST
 * /api/client-prefs; other clients' writes arrive as WS `client_prefs`.
 */

import { api } from './api-client.js'
import { GPU_CUSTOM_LAYOUT_KEY } from './device-view-gpu-port-constants.js'

/** @type {Record<string, Record<string, any>>} */
const cache = { multiviewPresets: {}, multiviewLayouts: {} }
/** Global keys → this browser's own localStorage copy (kept as the fallback; JSON unless `raw`). */
const GLOBAL = {
	gpuLayout: { ls: GPU_CUSTOM_LAYOUT_KEY, ok: Array.isArray },
	decklinkRearOrder: { ls: 'decklink_rear_panel_order', ok: Array.isArray },
	hardwarePolicy: { ls: 'highascg_hardware_policy', raw: true, ok: (v) => ['ask', 'apply_saved', 'keep_live'].includes(v) },
}
/** @type {Record<string, any>} the node's global values (null = none) */
const globals = { gpuLayout: null, decklinkRearOrder: null, hardwarePolicy: null }
const listeners = new Set()
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

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

/** This browser's own copy of a global key (null when absent or unreadable). */
function readLocal(key) {
	const g = GLOBAL[key]
	try {
		const raw = localStorage.getItem(g.ls)
		const v = raw == null ? null : g.raw ? raw : JSON.parse(raw)
		return v != null && g.ok(v) ? v : null
	} catch {
		return null
	}
}

/** A global key: the node's value, else this browser's localStorage copy (before the first load / node offline). */
export function readGlobalPref(key) {
	return clone(globals[key] ?? readLocal(key))
}

/** Global write: localStorage + node. value null removes both. */
export function writeGlobalPref(key, value) {
	const g = GLOBAL[key]
	if (!g) return
	try {
		if (value == null) localStorage.removeItem(g.ls)
		else localStorage.setItem(g.ls, g.raw ? String(value) : JSON.stringify(value))
	} catch {
		/* ignore */
	}
	globals[key] = clone(value ?? null)
	void api.post('/api/client-prefs', { key, value: value ?? null }).catch(() => {})
}

/** Fetch the node's copy (boot / reconnect). Resolves false when the node is unreachable. */
export async function loadClientPrefs() {
	try {
		const r = await api.get('/api/client-prefs')
		for (const k of Object.keys(cache)) cache[k] = r?.prefs?.[k] && typeof r.prefs[k] === 'object' ? r.prefs[k] : {}
		for (const k of Object.keys(GLOBAL)) {
			globals[k] = r?.prefs?.[k] != null && GLOBAL[k].ok(r.prefs[k]) ? r.prefs[k] : null
			const local = globals[k] == null ? readLocal(k) : null
			if (local != null) writeGlobalPref(k, local) // once: what only this browser had
		}
		emit({ loaded: true })
		return true
	} catch {
		return false
	}
}

/** WS `client_prefs` { key, n?, value } from another client's write. */
export function applyClientPrefsBroadcast(d) {
	if (d && GLOBAL[d.key]) {
		if (JSON.stringify(globals[d.key] ?? null) === JSON.stringify(d.value ?? null)) return // our own write
		globals[d.key] = d.value ?? null
		emit({ key: d.key })
		return
	}
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
