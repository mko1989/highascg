'use strict'

const { getGpuConnectorInventory } = require('./hardware-info')
const { normalizePortName } = require('./gpu-topology-xrandr')

/** @param {string} name */
function looksLikeDrmConnectorName(name) {
	return /^card\d+-/i.test(String(name || '').trim())
}

/** @param {string} name */
function looksLikeXrandrOutputName(name) {
	const s = String(name || '').trim()
	if (!s) return false
	if (looksLikeDrmConnectorName(s)) return false
	return /^(DP|HDMI|DVI|VGA|eDP|E-?DP)-/i.test(s)
}

/**
 * Resolve a Device View / config sysId (DRM or xrandr) to a live xrandr output name.
 * @param {string} sysId
 * @param {{ inventory?: ReturnType<typeof getGpuConnectorInventory> }} [opts]
 * @returns {string}
 */
function resolveSysIdToXrandrOutput(sysId, opts = {}) {
	const raw = String(sysId || '').trim()
	if (!raw) return ''
	if (looksLikeXrandrOutputName(raw)) return raw

	const inventory = Array.isArray(opts.inventory) ? opts.inventory : getGpuConnectorInventory()
	const rawKey = raw.toLowerCase()
	for (const c of inventory) {
		const full = String(c?.name || '').trim()
		const short = String(c?.shortName || '').trim()
		const card = String(c?.drmCard || '').trim()
		const fullKey = full.toLowerCase()
		const shortKey = short.toLowerCase()
		const cardShortKey = card && short ? `${card}-${short}`.toLowerCase() : ''
		if (rawKey === fullKey || rawKey === shortKey || (cardShortKey && rawKey === cardShortKey)) {
			const xr = String(c?.xrandrName || '').trim()
			if (xr) return xr
		}
	}

	// Last resort: strip card prefix and hope xrandr accepts it (legacy configs).
	const stripped = raw.replace(/^card\d+-/i, '')
	if (stripped && stripped !== raw && looksLikeXrandrOutputName(stripped)) return stripped
	return raw
}

/**
 * Resolve all layout head sysIds to xrandr names (mutates copies only).
 * @param {{ sysId: string, [key: string]: unknown }} head
 * @param {{ inventory?: ReturnType<typeof getGpuConnectorInventory> }} [opts]
 */
function resolveLayoutHeadSysId(head, opts = {}) {
	if (!head || typeof head !== 'object') return head
	const resolved = resolveSysIdToXrandrOutput(head.sysId, opts)
	if (!resolved || resolved === head.sysId) return head
	return { ...head, sysId: resolved, resolvedFrom: head.sysId }
}

module.exports = {
	looksLikeDrmConnectorName,
	looksLikeXrandrOutputName,
	resolveSysIdToXrandrOutput,
	resolveLayoutHeadSysId,
	normalizePortName,
}
