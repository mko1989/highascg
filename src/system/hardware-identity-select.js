'use strict'

const fs = require('fs')
const path = require('path')
const { isAllowedEthernetIface } = require('../config/network-settings')

/**
 * WO-1029 P1d: ONE rule for the MAC-derived hardware id, shared by the node (ensureHardwareHostname with
 * ctx.config.network) and the boot unit (tools/runtime/apply-hardware-hostname.js).
 *
 * 1. A stored id whose MAC is still on the box is KEPT (an id must not move because config or NIC order changed).
 * 2. Only when nothing valid is stored is it derived: configured primary interface, else the first physical
 *    wired interface in natural name order (eno1 < eno2 < enp3s0 ...).
 */

function isUsableMac(mac) {
	const norm = String(mac || '').trim().toLowerCase()
	if (!norm || norm === '00:00:00:00:00:00') return false
	return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(norm)
}

/** Natural sort so eno2 < eno10; deterministic whatever order the OS lists interfaces in. */
function byName(a, b) {
	return String(a.name).localeCompare(String(b.name), 'en', { numeric: true })
}

/**
 * @param {Array<{ name: string, mac?: string, internal?: boolean }>} interfaces
 * @param {object} [networkCfg]
 * @returns {{ mac: string, primaryInterface: string | null }}
 */
function pickPrimaryInterface(interfaces, networkCfg) {
	const wired = (interfaces || []).filter((i) => i && isAllowedEthernetIface(i.name)).sort(byName)
	const usable = wired.filter((i) => !i.internal && isUsableMac(i.mac))
	const want = networkCfg?.primaryInterface
	const pick =
		(want && isAllowedEthernetIface(want) ? wired.find((i) => i.name === want && isUsableMac(i.mac)) : null) ||
		usable[0] ||
		null
	if (!pick) return { mac: '', primaryInterface: wired[0]?.name || null }
	return { mac: pick.mac, primaryInterface: pick.name }
}

/**
 * @param {object | null} stored identity file contents
 * @param {Array<{ mac?: string }>} interfaces
 * @returns {boolean} true when the stored identity should be kept as is
 */
function storedIdentityStillValid(stored, interfaces) {
	if (!stored || !stored.hardwareId) return false
	const storedMac = String(stored.mac || '').trim().toLowerCase()
	if (!storedMac) return true // machine-id derived: no MAC to lose
	const present = (interfaces || []).some((i) => String(i.mac || '').toLowerCase() === storedMac)
	if (present) return true
	// No usable MAC on the box at all (NICs not up yet): do not flip a stored id on a transient empty list.
	return !(interfaces || []).some((i) => isUsableMac(i.mac))
}

/**
 * The config the node reads as `config.network`: general.json's `network`, overlaid by the flat
 * network.json slice when present (config/*.json slices are the flat contents of their key).
 * @param {string} configDir
 * @returns {object}
 */
function loadNetworkConfig(configDir) {
	let out = {}
	const read = (f) => {
		try {
			return JSON.parse(fs.readFileSync(path.join(configDir, f), 'utf8'))
		} catch {
			return null
		}
	}
	const general = read('general.json')
	if (general && typeof general.network === 'object' && general.network) out = { ...general.network }
	const slice = read('network.json')
	if (slice && typeof slice === 'object' && !Array.isArray(slice)) out = { ...out, ...slice }
	return out
}

module.exports = { isUsableMac, pickPrimaryInterface, storedIdentityStillValid, loadNetworkConfig }
