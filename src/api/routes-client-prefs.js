'use strict'

/**
 * WO-598 D — operator setup that used to live in ONE client's storage (web localStorage, Godot ui.cfg), kept on
 * the node so every client sees the same thing:
 *   GET  /api/client-prefs                     → { prefs: { multiviewPresets: { "<n>": [4 slots] }, multiviewLayouts: { "<n>": snapshot },
 *                                                  gpuLayout, decklinkRearOrder, hardwarePolicy } }   (null = none saved)
 *   POST /api/client-prefs { key, n, value }   → { ok }   per multiviewer: one multiviewer's entry
 *   POST /api/client-prefs { key, value }      → { ok }   global keys (no n)
 * value null removes. Multiviewer 1's layout is the project's `multiview` slice (not here). Global: the Device View
 * GPU rows' hidden flags + labels, the DeckLink rear-panel port order, the project-load hardware policy. Each write
 * broadcasts `client_prefs` { key, n?, value } so open clients update their mirror. Stored in the node's
 * persistence file (`clientPrefs`).
 */

const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const defaultPersistence = require('../utils/persistence')

const STORE_KEY = 'clientPrefs'
const MAX_N = 16
const MAX_BYTES = 512 * 1024

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)

/** Per-key value rules (null = remove is accepted for every key). */
const VALIDATE = {
	multiviewPresets: (v) => Array.isArray(v) && v.length === 4 && v.every((s) => s === null || (isObj(s) && Array.isArray(s.cells))),
	multiviewLayouts: (v) => isObj(v) && Array.isArray(v.cells),
}
/** Global keys: one value for the whole node. */
const VALIDATE_GLOBAL = {
	gpuLayout: (v) => Array.isArray(v) && v.every((i) => isObj(i) && typeof i.id === 'string'),
	decklinkRearOrder: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
	hardwarePolicy: (v) => v === 'ask' || v === 'apply_saved' || v === 'keep_live',
}
const PER_N = Object.keys(VALIDATE)
const KEYS = [...PER_N, ...Object.keys(VALIDATE_GLOBAL)]

const reply = (status, data) => ({ status, headers: JSON_HEADERS, body: jsonBody(data) })

function readPrefs(persistence) {
	const raw = persistence.get(STORE_KEY)
	const out = {}
	for (const k of PER_N) out[k] = isObj(raw?.[k]) ? raw[k] : {}
	for (const [k, ok] of Object.entries(VALIDATE_GLOBAL)) out[k] = raw?.[k] != null && ok(raw[k]) ? raw[k] : null
	return out
}

function handlePost(body, ctx) {
	const persistence = ctx?.persistence || defaultPersistence
	const b = parseBody(body) || {}
	const key = String(b.key || '')
	const global = Object.hasOwn(VALIDATE_GLOBAL, key)
	const n = parseInt(b.n, 10)
	if (!KEYS.includes(key)) return reply(400, { ok: false, error: `key must be one of ${KEYS.join(', ')}` })
	if (!global && !(n >= 1 && n <= MAX_N)) return reply(400, { ok: false, error: `n must be 1–${MAX_N}` })
	if (key === 'multiviewLayouts' && n === 1) return reply(400, { ok: false, error: "multiviewer 1's layout is the project's multiview slice" })
	const value = b.value === undefined ? null : b.value
	if (value !== null && !(global ? VALIDATE_GLOBAL : VALIDATE)[key](value)) return reply(400, { ok: false, error: `invalid ${key} value` })
	if (value !== null && JSON.stringify(value).length > MAX_BYTES) return reply(413, { ok: false, error: 'value too large' })
	const prefs = readPrefs(persistence)
	if (global) {
		prefs[key] = value
	} else {
		const slot = { ...prefs[key] }
		if (value === null) delete slot[String(n)]
		else slot[String(n)] = value
		prefs[key] = slot
	}
	persistence.set(STORE_KEY, prefs)
	if (typeof ctx?._wsBroadcast === 'function') ctx._wsBroadcast('client_prefs', global ? { key, value } : { key, n, value })
	return reply(200, { ok: true })
}

/** @param {any} routes */
function register(routes) {
	routes.get('/api/client-prefs', ({ ctx }) => reply(200, { prefs: readPrefs(ctx?.persistence || defaultPersistence) }), { requireCaspar: false })
	routes.post('/api/client-prefs', ({ body, ctx }) => handlePost(body, ctx), { requireCaspar: false })
}

module.exports = { register, handlePost, readPrefs, KEYS }
