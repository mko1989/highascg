'use strict'

/**
 * WO-837 — the lighting console link: the stored consoles (console-store.js) and what a timeline `light` flag does with
 * them. `fire(consoleId, action)` validates the action (actions.js), lets the console's driver build the OSC messages
 * and sends them over UDP (osc-send.js). Nothing here blocks: callers get a promise and treat a rejection as a console
 * error to log and broadcast, never as a reason to stop playback.
 * One service per app: `getService(ctx)` creates it lazily and keeps it on `ctx.lightingConsoles`, so the engine and the
 * HTTP routes share it without any boot wiring.
 */

const crypto = require('crypto')
const store = require('./console-store')
const { KINDS, driverFor } = require('./console-models')
const { normalizeAction } = require('./actions')
const { sendOsc } = require('./osc-send')

/** @param {{ log?: Function }} [ctx] @param {{ file?: string, send?: Function }} [deps] */
function createLightingService(ctx, deps = {}) {
	const file = deps.file
	const send = deps.send || sendOsc
	const log = (lvl, m) => ctx?.log?.(lvl, `[lighting] ${m}`)
	let consoles = store.loadConsoles(file)

	const find = (id) => consoles.find((c) => c.id === id) || null
	const persist = () => store.saveConsoles(consoles, file)

	async function dispatch(con, messages) {
		await send({ host: con.host, port: con.port }, messages)
		return messages.map((m) => m.address)
	}

	return {
		list: () => consoles.map((c) => ({ ...c })),
		get: (id) => (find(id) ? { ...find(id) } : null),
		kinds: () => Object.entries(KINDS).map(([kind, k]) => ({ kind, label: k.label, port: k.port })),

		/** Add (no / unknown id) or replace (known id). → { ok, console } | { ok:false, status, error } */
		upsert(src) {
			const v = store.validateConsole(src, { makeId: () => `c${crypto.randomBytes(4).toString('hex')}` })
			if (!v.ok) return { ok: false, status: 400, error: v.error }
			const i = consoles.findIndex((c) => c.id === v.console.id)
			if (i < 0 && consoles.length >= store.MAX_CONSOLES) return { ok: false, status: 400, error: `at most ${store.MAX_CONSOLES} consoles` }
			const next = consoles.slice()
			if (i >= 0) next[i] = v.console
			else next.push(v.console)
			const prev = consoles
			consoles = next
			if (!persist()) {
				consoles = prev
				return { ok: false, status: 500, error: 'could not write lighting-consoles.json' }
			}
			log('info', `console ${i >= 0 ? 'updated' : 'added'}: ${v.console.id} (${v.console.kind} ${v.console.host}:${v.console.port})`)
			return { ok: true, console: { ...v.console } }
		},

		remove(id) {
			if (!find(id)) return { ok: false, status: 404, error: `no console ${JSON.stringify(id)}` }
			const prev = consoles
			consoles = consoles.filter((c) => c.id !== id)
			if (!persist()) {
				consoles = prev
				return { ok: false, status: 500, error: 'could not write lighting-consoles.json' }
			}
			return { ok: true }
		},

		/** Run one flag action on a console → { ok, console, sent: [address] }; rejects with a readable Error. */
		async fire(consoleId, action) {
			const con = find(consoleId)
			if (!con) throw new Error(`lighting console ${JSON.stringify(consoleId)} is not configured (Devices > Lighting consoles)`)
			const a = normalizeAction(action)
			const sent = await dispatch(con, driverFor(con.kind).messages(con, a))
			log('debug', `${con.name}: ${a.action} -> ${sent.join(', ')}`)
			return { ok: true, console: con.id, sent }
		},

		/** A harmless message (see each driver). UDP is unacknowledged: ok means "left this machine". */
		async test(id) {
			const con = find(id)
			if (!con) return { ok: false, status: 404, error: `no console ${JSON.stringify(id)}` }
			try {
				const sent = await dispatch(con, driverFor(con.kind).testMessages(con))
				return { ok: true, status: 200, sent, note: 'UDP is unacknowledged: the message left this machine, the console does not answer' }
			} catch (e) {
				return { ok: false, status: 502, error: e.message }
			}
		},
	}
}

let _shared = null

/** The app's one service (created on first use, kept on `ctx.lightingConsoles`; module-level when there is no ctx). */
function getService(ctx) {
	if (ctx) {
		if (!ctx.lightingConsoles) ctx.lightingConsoles = createLightingService(ctx)
		return ctx.lightingConsoles
	}
	if (!_shared) _shared = createLightingService(null)
	return _shared
}

module.exports = { createLightingService, getService }
