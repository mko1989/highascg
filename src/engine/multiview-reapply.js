/**
 * Multiview re-apply after CasparCG (re)connect — WO-156.
 *
 * State sources merged (later wins):
 *  1. persistence keys `multiviewLayout` (n=1) / `multiviewLayout_<n>` (survive app restarts)
 *  2. legacy singular `ctx._multiviewLayout` (boot hydrate / WS sync, n=1)
 *  3. `ctx._multiviewLayouts[n]` — latest HTTP `/api/multiview/apply` bodies
 *
 * Called from `setupAllRouting()` (src/config/routing-setup.js), which runs on boot AND on
 * every Caspar reconnect (`status` connected → fetchInfo → onAfterInfoConfigReady). Retries
 * with backoff because a channel is often not ready right after a Caspar restart.
 */

'use strict'

/**
 * @param {object} ctx
 * @returns {Record<number, object>} apply-bodies keyed by multiviewer index n (>= 1)
 */
function collectPersistedMultiviewLayouts(ctx) {
	/** @type {Record<number, object>} */
	const layouts = {}
	const hasLayout = (v) => v && Array.isArray(v.layout) && v.layout.length > 0

	let all
	try {
		const persistence = ctx?.persistence || require('../utils/persistence')
		all = persistence.getAll() || {}
	} catch {
		all = {}
	}
	for (const key of Object.keys(all)) {
		let n = null
		if (key === 'multiviewLayout') n = 1
		else {
			const m = key.match(/^multiviewLayout_(\d+)$/)
			if (m) n = parseInt(m[1], 10)
		}
		if (n == null || n < 1) continue
		if (hasLayout(all[key])) layouts[n] = all[key]
	}

	if (!layouts[1] && hasLayout(ctx?._multiviewLayout)) layouts[1] = ctx._multiviewLayout

	const mem = ctx?._multiviewLayouts
	if (mem && typeof mem === 'object') {
		for (const key of Object.keys(mem)) {
			const n = parseInt(key, 10)
			if (Number.isFinite(n) && n >= 1 && hasLayout(mem[key])) layouts[n] = mem[key]
		}
	}
	return layouts
}

/**
 * Re-apply every persisted multiview layout, with logged retries (no more swallowed catch).
 * @param {object} ctx
 * @param {{ attempts?: number, backoffMs?: number, applyFn?: (body: object, ctx: object) => Promise<any> }} [opts]
 * @returns {Promise<{ applied: number[], failed: { n: number, error: string }[], skipped: number[] }>}
 */
async function reapplyAllMultiviewLayouts(ctx, opts = {}) {
	const log = typeof ctx?.log === 'function' ? (level, msg) => ctx.log(level, msg) : () => {}
	const attempts = Math.max(1, parseInt(opts.attempts, 10) || 3)
	const backoffMs = Number.isFinite(opts.backoffMs) ? Math.max(0, opts.backoffMs) : 1200
	const applyFn = opts.applyFn || require('./multiview-apply').applyMultiviewLayout
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

	const layouts = collectPersistedMultiviewLayouts(ctx)
	const ns = Object.keys(layouts)
		.map(Number)
		.sort((a, b) => a - b)

	/** @type {number[]} */
	const applied = []
	/** @type {{ n: number, error: string }[]} */
	const failed = []
	/** @type {number[]} */
	const skipped = []

	for (const n of ns) {
		const body = { ...layouts[n], n }
		let lastErr = null
		for (let attempt = 1; attempt <= attempts; attempt++) {
			try {
				await applyFn(body, ctx)
				applied.push(n)
				lastErr = null
				break
			} catch (e) {
				const msg = e?.message || String(e)
				if (/not enabled/i.test(msg)) {
					// Persisted layout for a multiviewer that is no longer configured — not an error.
					log('debug', `Multiview re-apply: multiviewer ${n} skipped (${msg})`)
					skipped.push(n)
					lastErr = null
					break
				}
				lastErr = e
				log('warn', `Multiview re-apply: multiviewer ${n} attempt ${attempt}/${attempts} failed: ${msg}`)
				if (attempt < attempts) await sleep(backoffMs * attempt)
			}
		}
		if (lastErr) failed.push({ n, error: lastErr?.message || String(lastErr) })
	}

	if (applied.length > 0) log('info', `Multiview re-apply: layout(s) applied for multiviewer(s) ${applied.join(', ')}`)
	if (failed.length > 0) {
		log(
			'warn',
			`Multiview re-apply: FAILED for multiviewer(s) ${failed.map((f) => f.n).join(', ')} after ${attempts} attempt(s) — use the multiview editor "Refresh output" button once CasparCG is ready`,
		)
	}
	return { applied, failed, skipped }
}

module.exports = { collectPersistedMultiviewLayouts, reapplyAllMultiviewLayouts }
