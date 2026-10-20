'use strict'

/**
 * WO-606 — Shader FX editor's detected-parameters panel (web shader-fx-params.js, WO-340) on the node: scan the
 * UNSAVED sources a client is editing, and rewrite one literal in place. Stateless — the client sends every
 * source each time; params are addressed by their position in the scan (`index`), which the same input
 * reproduces. Same scanner as the web (client/lib/shader-param-scan.js, named const / #define params only).
 */

const { libs } = require('./shader-live-session')

/** @param {any} b @returns {{ common: string, passes: Record<string, { source: string }> }} */
function sourcesOf(b) {
	const passes = {}
	for (const [k, v] of Object.entries(b?.passes || {})) {
		const src = typeof v === 'string' ? v : v?.source
		if (typeof src === 'string' && src.trim()) passes[k] = { source: src }
	}
	return { common: typeof b?.common === 'string' ? b.common : '', passes }
}

/** @param {any} b */
async function scan(b) {
	const L = await libs()
	const { common, passes } = sourcesOf(b)
	return L.scanAllPassSources(passes, common).map((p, index) => ({
		index,
		name: p.name,
		passKey: p.passKey,
		kind: p.kind,
		vec: p.vec,
		values: p.values,
		min: p.min,
		max: p.max,
		step: p.step,
	}))
}

/**
 * @param {any} b  { common, passes, index, values }
 * @returns {Promise<{ passKey: string, source: string } | { error: string }>}
 */
async function rewrite(b) {
	const L = await libs()
	const { common, passes } = sourcesOf(b)
	const p = L.scanAllPassSources(passes, common)[Number(b?.index)]
	const values = Array.isArray(b?.values) ? b.values.map(Number) : null
	if (!p) return { error: 'unknown param index' }
	if (!values || values.length !== p.values.length || values.some((v) => !Number.isFinite(v))) return { error: 'values must match the param' }
	const src = p.passKey === 'common' ? common : passes[p.passKey].source
	return { passKey: p.passKey, source: L.rewriteParamValues(src, p, values) }
}

module.exports = { scan, rewrite }
