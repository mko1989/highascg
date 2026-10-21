/**
 * Apply LED test card settings to Caspar channels (layer 999).
 * WO-629: the node plans the targets and sends the per-channel cards (src/engine/led-test-card-control.js) — the
 * same `POST /api/led-test-card/master` / `…/channel` the Godot header uses. The master flag mirrors the server's
 * `state.ledTestPatternActive` (was localStorage `highascg_led_test_enabled`).
 */

import { api } from './api-client.js'

let master = false

/** @returns {boolean} */
export function isLedTestMasterEnabled() {
	return master
}

/** @param {boolean} on */
export function setLedTestMasterEnabled(on) {
	master = !!on
}

let applyChain = Promise.resolve()

/**
 * @param {() => Promise<any>} fn
 */
function queueLedTestApply(fn) {
	const p = applyChain.then(fn, fn)
	applyChain = p.catch(() => {})
	return p
}

/** Node reply → the web's `{ failures: [{ channel, message }], targets }`. */
function asResult(r) {
	return {
		targets: Array.isArray(r?.targets) ? r.targets : [],
		failures: (Array.isArray(r?.failures) ? r.failures : []).map((f) => ({ channel: f.channel, message: f.error || f.message || '' })),
	}
}

/**
 * @param {unknown} _stateStore kept for callers; the node reads its own state
 * @param {boolean} enabled
 * @param {{ channels?: number[], onAllFailed?: () => void }} [options]
 * @returns {Promise<{ failures: { channel: number, message: string }[], targets: number[] }>}
 */
export async function applyLedTestPattern(_stateStore, enabled, options = {}) {
	return queueLedTestApply(async () => {
		const scoped = Array.isArray(options.channels) && options.channels.length > 0
		let out = { failures: [], targets: [] }
		const calls = scoped
			? options.channels.map((channel) => ['/api/led-test-card/channel', { channel, enabled: !!enabled }, channel])
			: [['/api/led-test-card/master', { enabled: !!enabled }, 0]]
		for (const [path, body, channel] of calls) {
			try {
				const r = asResult(await api.post(path, body))
				out = { targets: [...out.targets, ...r.targets], failures: [...out.failures, ...r.failures] }
			} catch (err) {
				/* 502 = every channel failed (or 503 Caspar down): the body's failures are in the message */
				out = { targets: [...out.targets, channel], failures: [...out.failures, { channel, message: err?.message || String(err) }] }
			}
		}
		if (enabled && out.targets.length > 0 && out.failures.length >= out.targets.length) {
			if (typeof options.onAllFailed === 'function') options.onAllFailed()
		} else if (enabled && out.failures.length > 0) {
			console.warn('LED test card: partial failure', out.failures.map((f) => `ch ${f.channel}: ${f.message}`).join('; '))
		}
		return out
	})
}
