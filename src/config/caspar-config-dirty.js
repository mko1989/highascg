'use strict'

/**
 * WO-1029 part 1 — does THIS box's Caspar need the Apply (restart)? Decided by the server itself, so the answer is
 * the same for every client and for a linked server asking (`GET /api/caspar-config/dirty`, cluster-apply.js); the
 * client's own `restart_dirty` flag only knew about edits made from that client.
 *
 * Reasons (any one = dirty):
 *  - `unwritten`       the casparcg.config Apply would write (routes-caspar-config.js `generatedCasparConfigXml`) is not
 *                      the file on disk — a cable or setting changed since the last Apply;
 *  - `not_restarted`   the file on disk is not the one Caspar read at its last connect (written, never restarted);
 *  - `pending`         the server recorded "restart needed" (output wiring: device-view-decklink-wiring.js sets
 *                      `ctx.casparApplyPending`); persisted here so a node restart keeps it; cleared by a good Apply;
 *  - `running_differs` `configComparison` (running INFO CONFIG vs the generated one, config-compare.js) has issues.
 * Consumers added over AMCP at runtime (stream, record, meter-null, compose, shm, v4l2) are not in casparcg.config
 * nor in INFO CONFIG, and nothing here reads `INFO <ch>` consumers — they can never make the box dirty.
 */

const fs = require('fs')
const crypto = require('crypto')

const PENDING_KEY = 'casparRestartPending'

const hash = (s) => (s == null ? null : crypto.createHash('sha1').update(String(s)).digest('hex'))

function defaultDeps(ctx) {
	const routes = require('../api/routes-caspar-config')
	return {
		persistence: ctx?.persistence || require('../utils/persistence'),
		generatedXml: (c) => routes.generatedCasparConfigXml(c),
		configPath: (c) => routes.resolveCasparConfigWritePath(c),
		readFile: (p) => {
			try {
				return fs.readFileSync(p, 'utf8')
			} catch {
				return null
			}
		},
		now: () => Date.now(),
	}
}

/** On every Caspar connect (caspar-info-ready.js): the file Caspar has just read. */
function rememberConfigAtConnect(ctx, injected) {
	try {
		const deps = { ...defaultDeps(ctx), ...(injected || {}) }
		ctx._casparConfigAtConnect = { hash: hash(deps.readFile(deps.configPath(ctx))), at: deps.now() }
	} catch {
		ctx._casparConfigAtConnect = null
	}
}

/** The server's own "restart needed" (persisted; also picks up the in-memory flag the wiring code sets). */
function pendingOf(ctx, deps) {
	const stored = deps.persistence.get(PENDING_KEY)
	if (ctx?.casparApplyPending === true && !stored) {
		const v = { at: deps.now(), why: 'output wiring changed' }
		deps.persistence.set(PENDING_KEY, v)
		return v
	}
	return stored && typeof stored === 'object' ? stored : null
}

/** Record "restart needed" (an Apply that wrote the config but skipped the restart). */
function markRestartPending(ctx, why, injected) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	deps.persistence.set(PENDING_KEY, { at: deps.now(), why: String(why || 'restart needed') })
}

/** A successful Apply (restart, or "already matches") answers every pending reason. */
function clearRestartPending(ctx, injected) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	if (ctx) ctx.casparApplyPending = false
	if (deps.persistence.get(PENDING_KEY) != null) {
		if (typeof deps.persistence.remove === 'function') deps.persistence.remove(PENDING_KEY)
		else deps.persistence.set(PENDING_KEY, null)
	}
}

/**
 * @param {object} ctx
 * @param {{ deps?: object }} [opts]
 * @returns {{ dirty: boolean, reasons: Array<{ code: string, text: string }>, generatedAt: number, caspar_connected: boolean }}
 */
function casparConfigDirty(ctx, { deps: injected } = {}) {
	const deps = { ...defaultDeps(ctx), ...(injected || {}) }
	const reasons = []
	const connected = !!ctx?.amcp && ctx.amcp.isConnected !== false
	const out = (extra = {}) => ({ dirty: reasons.length > 0, reasons, generatedAt: deps.now(), caspar_connected: connected, ...extra })
	if (ctx?.config?.offline_mode) return out({ offline_mode: true })
	let generated = null
	try {
		generated = deps.generatedXml(ctx)
	} catch (e) {
		reasons.push({ code: 'unwritten', text: `could not build the Caspar config: ${e?.message || e}` })
	}
	const disk = deps.readFile(deps.configPath(ctx))
	if (generated != null && generated !== disk) {
		reasons.push({ code: 'unwritten', text: disk == null ? 'casparcg.config is missing' : 'cables or settings changed since the last Apply' })
	} else if (generated != null) {
		const at = ctx?._casparConfigAtConnect
		if (at?.hash && hash(disk) !== at.hash) reasons.push({ code: 'not_restarted', text: 'casparcg.config was written but Caspar was not restarted' })
	}
	const pending = pendingOf(ctx, deps)
	if (pending) reasons.push({ code: 'pending', text: `restart needed (${pending.why || 'recorded'})` })
	const cc = ctx?._configComparison
	if (connected && cc?.serverConfigDriven && cc.aligned === false) {
		const issues = Array.isArray(cc.issues) ? cc.issues : []
		reasons.push({ code: 'running_differs', text: issues.slice(0, 3).join(' · ') || 'the running Caspar config differs' })
	}
	return out()
}

module.exports = { casparConfigDirty, rememberConfigAtConnect, markRestartPending, clearRestartPending }
