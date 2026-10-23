'use strict'

/**
 * WO-712 R1 — "what this server does": a device-local pick-list, set in this server's own Devices view (owner 23.10:
 * "users pick and choose what each server does"). Stored like the cluster peer list, in the node's persistence file
 * under `serverDuties` (never in the project: two servers share a project, not their duties). Every duty defaults
 * to true, so a single box does everything, as today. Each tracking / lighting service gates its own tick on `has()`.
 *
 *   detection       cameras → detection sidecar            (detect-service.js)
 *   zones           zone actions fire                      (zone-service.js; occupancy is still evaluated)
 *   auto            the Auto director                      (flag only in R1; the session lead wires the director)
 *   lighting        DMX (Art-Net / sACN) and PSN out       (follow-service.js; the engine still aims, previs works)
 *   ptz             VISCA out                              (ptz-service.js `allowed`)
 *   presenters      new presenter intake                   (presenter-routes.js)
 *   accept_remote   WO-712 D3: remote actions count as this server's own press (R2 reads it; nothing gates on it yet)
 * `playout` is NOT a duty yet: it has no gate, and a tick that does nothing is not shipped.
 *
 * The shared instance (module-level has / get / set / onChange) uses utils/persistence, which redirects to a scratch
 * file under `node --test` (NODE_TEST_CONTEXT), so a smoke can never touch the real state file.
 */

const STORE_KEY = 'serverDuties'
const NAMES = ['detection', 'zones', 'auto', 'lighting', 'ptz', 'presenters', 'accept_remote']

const defaults = () => Object.fromEntries(NAMES.map((n) => [n, true]))

/** Anything stored → a full { name: boolean } object (unknown keys dropped, non-booleans fall back to true). */
function normalize(raw) {
	const out = defaults()
	if (raw && typeof raw === 'object' && !Array.isArray(raw))
		for (const n of NAMES) if (typeof raw[n] === 'boolean') out[n] = raw[n]
	return out
}

/** @returns {string|null} why `patch` is not acceptable, or null. */
function validatePatch(patch) {
	if (!patch || typeof patch !== 'object' || Array.isArray(patch))
		return 'patch must be an object of duty names to true / false'
	const keys = Object.keys(patch)
	if (!keys.length) return 'patch is empty'
	for (const k of keys) {
		if (!NAMES.includes(k)) return `unknown duty "${k}" (known: ${NAMES.join(', ')})`
		if (typeof patch[k] !== 'boolean') return `duty "${k}" must be true or false`
	}
	return null
}

/** @param {{ persistence: { get: Function, set: Function } }} opts */
function createServerDuties({ persistence }) {
	let state = normalize(persistence.get(STORE_KEY))
	const subs = new Set()
	return {
		has: (name) => state[name] === true,
		get: () => ({ ...state }),
		/** @throws {Error} with .status 400 when the patch names an unknown duty or a non-boolean. → the saved object */
		set(patch) {
			const bad = validatePatch(patch)
			if (bad) throw Object.assign(new Error(bad), { status: 400 })
			const prev = state
			state = { ...state, ...patch }
			if (NAMES.every((n) => prev[n] === state[n])) return { ...state }
			persistence.set(STORE_KEY, { ...state })
			for (const fn of [...subs]) {
				try {
					fn({ ...state }, { ...prev })
				} catch {
					/* one bad subscriber must not stop the others */
				}
			}
			return { ...state }
		},
		/** fn(next, prev) after every change. → unsubscribe */
		onChange(fn) {
			subs.add(fn)
			return () => subs.delete(fn)
		},
	}
}

let shared = null
const sharedOf = () => shared || (shared = createServerDuties({ persistence: require('../utils/persistence') }))

module.exports = {
	STORE_KEY,
	NAMES,
	normalize,
	createServerDuties,
	has: (name) => sharedOf().has(name),
	get: () => sharedOf().get(),
	set: (patch) => sharedOf().set(patch),
	onChange: (fn) => sharedOf().onChange(fn),
}
