'use strict'

const defaults = require('./defaults')

const IFACE_RE = /^(eth|enp|eno)[0-9]+$/i

/**
 * @param {unknown} name
 * @returns {boolean}
 */
function isAllowedEthernetIface(name) {
	return IFACE_RE.test(String(name || '').trim())
}

/**
 * @param {unknown} input
 * @param {object} [existing]
 * @returns {object}
 */
function normalizeNetworkSettings(input, existing) {
	const base = {
		...(defaults.network || {}),
		...(existing && typeof existing === 'object' ? existing : {}),
	}
	const src = { ...base, ...(input && typeof input === 'object' ? input : {}) }
	const iface = String(src.primaryInterface || base.primaryInterface || '').trim()
	const mode = String(src.mode || 'dhcp').toLowerCase() === 'static' ? 'static' : 'dhcp'
	const stIn = src.static && typeof src.static === 'object' ? src.static : {}
	const dns = Array.isArray(stIn.dns)
		? stIn.dns.map((d) => String(d).trim()).filter(Boolean).slice(0, 2)
		: stIn.dns
			? [String(stIn.dns).trim()].filter(Boolean)
			: []
	return {
		primaryInterface: iface && isAllowedEthernetIface(iface) ? iface : (base.primaryInterface || ''),
		mode,
		static: {
			address: String(stIn.address || '').trim(),
			prefixLength: Math.max(1, Math.min(32, parseInt(String(stIn.prefixLength ?? 24), 10) || 24)),
			gateway: String(stIn.gateway || '').trim(),
			dns,
		},
	}
}

/**
 * @param {unknown} ip
 * @returns {boolean}
 */
function isValidIpv4(ip) {
	const parts = String(ip || '').trim().split('.')
	if (parts.length !== 4) return false
	return parts.every((p) => {
		const n = parseInt(p, 10)
		return String(n) === p && n >= 0 && n <= 255
	})
}

module.exports = {
	isAllowedEthernetIface,
	normalizeNetworkSettings,
	isValidIpv4,
}
