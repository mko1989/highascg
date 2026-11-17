'use strict'

/**
 * WO-1105 — the join address phones scan (Settings ▸ Games, the QR dialog, the join QR look).
 *
 * The games build their own `joinUrls` from every non-loopback IPv4 (src/utils/lan-ipv4.js), venue network first and
 * 100.64/10 (Tailscale / carrier NAT) last. This file lists the same addresses with their interface and kind so the
 * operator can pick one when the box has several (`games.joinAddress` = an IPv4 or an interface name; '' = automatic,
 * the games' own first choice), and says when the only choice is no use to a guest's phone.
 *   kind: 'lan' (a private or public venue address) | 'vpn' (100.64/10, tailscale* / wg* / tun*) | 'local' (link-local
 *   169.254/16, or a container / VM bridge: docker0, br-<id>, virbr*, veth*, …: no phone reaches it) | 'loopback'
 * WO-1106 A7: 'local' used to count as 'lan' and sort first (docker0 172.17.0.1 < 192.168…): the QR led nowhere, no warning.
 */

const os = require('os')

const CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
const VPN_IFACE = /^(tailscale|wg|tun|zt)/i
const LINK_LOCAL = /^169\.254\./
// docker's own bridges are docker0 and br-<12 hex>; a plain br0 is often the venue LAN bridged, so it stays 'lan'
const LOCAL_IFACE = /^(docker\d|br-[0-9a-f]{12}$|virbr|veth|lxcbr|lxdbr|podman|cni|flannel|vboxnet|vmnet)/i

/** @param {string} ip @param {string} iface @param {boolean} internal */
function kindOf(ip, iface, internal) {
	if (internal || /^127\./.test(ip)) return 'loopback'
	if (CGNAT.test(ip) || VPN_IFACE.test(iface)) return 'vpn'
	if (LINK_LOCAL.test(ip) || LOCAL_IFACE.test(iface)) return 'local'
	return 'lan'
}

/**
 * Every IPv4 of the box: [{ ip, iface, kind }], LAN first, then VPN, then local-only, then loopback; inside a kind by address (the
 * games' order: getLanIPv4Addresses sorts by string).
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} [nets] os.networkInterfaces() (smokes inject)
 */
function listAddresses(nets = os.networkInterfaces()) {
	const out = []
	const seen = new Set()
	for (const iface of Object.keys(nets || {})) {
		for (const a of nets[iface] || []) {
			const v4 = a && (a.family === 'IPv4' || a.family === 4)
			if (!v4 || seen.has(a.address)) continue
			seen.add(a.address)
			out.push({ ip: a.address, iface, kind: kindOf(a.address, iface, !!a.internal) })
		}
	}
	const rank = { lan: 0, vpn: 1, local: 2, loopback: 3 }
	return out.sort((x, y) => rank[x.kind] - rank[y.kind] || (x.ip < y.ip ? -1 : x.ip > y.ip ? 1 : 0))
}

/**
 * The address the join codes use → { ip, iface, kind, auto, warning }.
 * `want`: '' (automatic) | an IPv4 | an interface name. A wanted address that is gone falls back to automatic, said
 * in the warning. ip null when the box has no IPv4 but loopback.
 * @param {Array<{ip:string, iface:string, kind:string}>} addrs listAddresses()
 * @param {string} [want]
 */
function pickAddress(addrs, want = '') {
	const w = String(want || '').trim()
	let a = null
	let gone = ''
	if (w) {
		a = addrs.find((x) => x.ip === w) || addrs.find((x) => x.iface === w) || null
		if (!a) gone = `${w} is not on this box now — using the automatic address. `
	}
	const auto = !a
	if (!a) a = addrs.find((x) => x.kind === 'lan') || addrs.find((x) => x.kind === 'vpn') || addrs.find((x) => x.kind === 'local') || null
	let warning = gone
	if (!a) warning += 'No network address: phones cannot reach this box. Connect it to the venue network.'
	else if (a.kind === 'vpn') warning += `${a.ip} (${a.iface}) is a VPN address: only phones on that VPN can join. Connect the box to the venue network.`
	else if (a.kind === 'local') warning += `${a.ip} (${a.iface}) is a local-only address (link-local or a container / VM network): phones cannot reach it. Connect the box to the venue network.`
	else if (a.kind === 'loopback') warning += 'Only this box can open a loopback address.'
	return { ip: a ? a.ip : null, iface: a ? a.iface : '', kind: a ? a.kind : 'none', auto, warning: warning.trim() }
}

/** `http://<ip>:<port><path>`; null without an address. */
function joinUrl(ip, port, path) {
	if (!ip) return null
	const p = String(path || '/')
	return `http://${ip}:${Number(port) || 4200}${p.startsWith('/') ? p : '/' + p}`
}

module.exports = { listAddresses, pickAddress, joinUrl, kindOf }
