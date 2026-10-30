'use strict'

/**
 * WO-869 path (b) — live slice edits: `APPLY <pgm ch>-<640+k> SLICES SET …` to a mapping node's slice window (the
 * screen consumer the generator wrote, mapping-slices-windows.js). One APPLY carries the node's whole slice set, so
 * every slice changes in the same frame; the consumer swaps the set on its render thread (no window recreation).
 *
 * Re-applied on boot and on every Caspar reconnect from routing-setup.js `setupMappingChannels` (the XML `<slices>`
 * is only the baseline the config was generated with; edits made since then live in the node's settings).
 * Serialised per window like the operator GUI / multiview applies, so a drag's burst of edits cannot interleave.
 */

const { getChannelMap } = require('../config/routing')
const { sliceWindowsFromConfig, slicesSetParams } = require('../config/mapping-slices-windows')

/** @type {Map<string, Promise<unknown>>} window key → tail of its apply chain */
const chains = new Map()

function log(ctx, level, msg) {
	if (typeof ctx?.log === 'function') ctx.log(level, msg)
}

/** The APPLY line for one window entry (null when its feed has no program channel in the channel map). */
function applyLineFor(ctx, w) {
	let ch = null
	try {
		ch = getChannelMap(ctx.config || {}).programCh(w.screenIndex)
	} catch {
		ch = null
	}
	if (!Number.isFinite(Number(ch))) return null
	return `APPLY ${ch}-${w.consumerIndex} ${slicesSetParams(w.window)}`
}

/**
 * Send one window's slice set. Resolves {ok, line, error?}; never throws (a refused APPLY is reported, not fatal).
 * @param {object} ctx
 * @param {object} w an entry of sliceWindowsFromConfig
 */
function applySliceWindow(ctx, w) {
	const line = applyLineFor(ctx, w)
	if (!line) return Promise.resolve({ ok: false, line: null, error: 'No program channel for the mapping input feed' })
	if (!ctx?.amcp || typeof ctx.amcp.raw !== 'function') return Promise.resolve({ ok: false, line, error: 'Caspar not connected' })
	const key = `${w.nodeId}`
	const run = async () => {
		try {
			await ctx.amcp.raw(line)
			return { ok: true, line }
		} catch (e) {
			const error = String(e?.message || e)
			log(ctx, 'warn', `[mapping-slices] ${w.label}: ${line.slice(0, 60)}… refused: ${error}`)
			return { ok: false, line, error }
		}
	}
	const next = (chains.get(key) || Promise.resolve()).then(run, run)
	chains.set(key, next)
	return next
}

/**
 * Live-apply one node's slices (after an edit). `appConfig` defaults to ctx.config.
 * @returns {Promise<{ ok: boolean, applied: boolean, line?: string|null, error?: string }>}
 */
async function applyMappingNodeSlices(ctx, nodeId, appConfig) {
	const w = sliceWindowsFromConfig(appConfig || ctx?.config || {}).find((x) => x.nodeId === nodeId)
	if (!w) return { ok: true, applied: false }
	const r = await applySliceWindow(ctx, w)
	return { ...r, applied: r.ok }
}

/** Boot / reconnect: every slice window gets its node's current slice set. */
async function reapplyAllMappingSlices(ctx) {
	const windows = sliceWindowsFromConfig(ctx?.config || {})
	const results = []
	for (const w of windows) results.push({ nodeId: w.nodeId, ...(await applySliceWindow(ctx, w)) })
	if (windows.length) {
		const ok = results.filter((r) => r.ok).length
		log(ctx, ok === windows.length ? 'info' : 'warn', `[mapping-slices] re-applied ${ok}/${windows.length} slice window(s)`)
	}
	return results
}

module.exports = { applyLineFor, applySliceWindow, applyMappingNodeSlices, reapplyAllMappingSlices }
