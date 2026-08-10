'use strict'

const defaults = require('./defaults')

/* systemd predictable names are `en` + a scheme suffix that is NOT digits-only: onboard `eno1`,
 * hotplug slot `ens33`, PCI `enp3s0` / `enp0s31f6`, MAC `enx047c1615c6e4`, plus optional
 * f/d/n/v parts (`eno1np0`). The old `^(eth|enp|eno)[0-9]+$` only matched digits after the
 * prefix, so every box shipped so far (all `enoN`) passed while a PCI-named NIC — `enp3s0` on
 * highascg7579 — was filtered out, leaving interfaces:[] and "(no Ethernet found)" in the GUI.
 * Wireless (`wl*`), bridges, veth, tun and lo do not start with `eth`/`en` and stay excluded. */
const IFACE_RE = /^(eth[0-9]+|en[a-z0-9]+)$/i

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
