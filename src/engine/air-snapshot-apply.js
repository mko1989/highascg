'use strict'

/**
 * WO-1029 part 2 — the air snapshot around one Apply (routes-caspar-config.js `applyCasparConfigToDiskAndRestart`):
 *   before: {@link takeForApply} captures and persists what is on the outputs. A failed snapshot NEVER blocks the
 *           Apply: it is logged and the Apply runs (answer `restored: null` with the reason).
 *   after:  {@link settleAfterApply} — no restart happened (config unchanged, restart skipped, write failed) → the
 *           snapshot is discarded; Caspar came back within the Apply → wait (bounded) for restore-on-screens.js to
 *           report; Caspar not back yet → the snapshot stays armed for its reconnect (stale after a few minutes).
 */

const Air = require('./air-snapshot')

/** How long the apply answer waits for the restore after Caspar answered again (relay: 110 s for the whole apply). */
const RESTORE_WAIT_MS = 15000

function log(ctx, level, msg) {
	if (typeof ctx?.log === 'function') ctx.log(level, msg)
}

/**
 * @param {object} ctx
 * @param {{ skip?: boolean, deps?: object }} [opts] deps: { capture, persistence }
 * @returns {Promise<{ taken: boolean, id?: string, error?: string, unreadable?: { what: string, why: string }[] }>}
 */
async function takeForApply(ctx, { skip = false, deps = {} } = {}) {
	if (skip) return { taken: false, error: 'no restart requested' }
	const persistence = deps.persistence || ctx?.persistence || require('../utils/persistence')
	try {
		if (!deps.capture && (!ctx?.amcp || ctx.amcp.isConnected === false)) throw new Error('Caspar not connected')
		const snap = await (deps.capture || Air.captureAirSnapshot)(ctx, { reason: 'apply' })
		Air.storeSnapshot(snap, persistence)
		const layers = snap.channels.reduce((n, c) => n + c.layers.length, 0)
		log(ctx, 'info', `[air-snapshot] taken before Apply: ${snap.channels.length} channel(s), ${layers} layer(s), ${snap.looks.length} look(s)` +
			(snap.errors.length ? ` — unreadable: ${snap.errors.map((e) => e.channel ?? e.what).join(', ')}` : ''))
		// what Caspar would not tell cannot come back: carried to the answer, never a silent loss
		const unreadable = snap.errors.map((e) => ({ what: e.channel != null ? `channel ${e.channel}` : String(e.what || 'state'), why: `not readable at snapshot: ${e.error}` }))
		return { taken: true, id: snap.id, ...(unreadable.length ? { unreadable } : {}) }
	} catch (e) {
		const error = e?.message || String(e)
		log(ctx, 'warn', `[air-snapshot] snapshot failed (${error}) — applying anyway, nothing will be restored`)
		try {
			Air.discardSnapshot(persistence) // an older one must not be restored by this apply's reconnect
		} catch {
			/* advisory */
		}
		return { taken: false, error }
	}
}

/** Did the Apply restart Caspar (or ask the bed's fake Caspar to)? */
function restartHappened(fullApply) {
	if (!fullApply || fullApply.ok === false) return !!fullApply?.casparRestart?.restartSent
	if (fullApply.step === 'no_changes') return false
	const r = fullApply.casparRestart || {}
	return !!(r.attempted || r.restartSent || r.reconnected)
}

/**
 * @param {object} ctx
 * @param {{ taken: boolean, id?: string, error?: string }} snapRes
 * @param {object|null} fullApply applyFullServerConfig result (null when it threw)
 * @param {{ waitMs?: number, deps?: object }} [opts]
 * @returns {Promise<{ restored: object|null, restored_reason: string }>}
 */
async function settleAfterApply(ctx, snapRes, fullApply, { waitMs = RESTORE_WAIT_MS, deps = {} } = {}) {
	const persistence = deps.persistence || ctx?.persistence || require('../utils/persistence')
	if (!snapRes?.taken) return { restored: null, restored_reason: snapRes?.error ? `snapshot failed: ${snapRes.error}` : 'no snapshot' }
	if (!restartHappened(fullApply)) {
		Air.discardSnapshot(persistence)
		return { restored: null, restored_reason: 'no restart' }
	}
	if (!fullApply?.casparRestart?.reconnected) {
		return { restored: null, restored_reason: 'Caspar not back yet — restored when it reconnects' }
	}
	const report = await (deps.waitRestored || Air.waitRestored)(snapRes.id, waitMs)
	const missed = Array.isArray(snapRes.unreadable) ? snapRes.unreadable : []
	const partial = missed.length ? `snapshot incomplete: ${missed.map((m) => m.what).join(', ')}` : ''
	if (!report) return { restored: null, restored_reason: partial ? `restore still running; ${partial}` : 'restore still running' }
	return { restored: missed.length ? { ...report, skipped: [...(report.skipped || []), ...missed] } : report, restored_reason: partial }
}

module.exports = { takeForApply, settleAfterApply }
