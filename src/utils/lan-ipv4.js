'use strict'

const os = require('os')
// WO-1106 D3: the Settings ▸ Games list itself (games-join.js is a leaf file: os only), so both rank alike
const { listAddresses } = require('../games/games-join')

/**
 * Non-loopback IPv4 addresses, unique: the venue LAN first, then VPN (100.64/10, tailscale* / wg* / tun*), then
 * local-only (link-local 169.254/16, docker0 / br-<id> / virbr* / veth* … bridges: no phone reaches them); inside a
 * kind by address. WO-1106 D3: the games' join URLs take the first one — the plain string sort this replaced put
 * docker0's 172.17.0.1 and 169.254.x before 192.168.x. = games-join.js listAddresses() without loopback.
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} [nets] os.networkInterfaces() (smokes inject)
 */
function getLanIPv4Addresses(nets = os.networkInterfaces()) {
	return listAddresses(nets).filter((a) => a.kind !== 'loopback').map((a) => a.ip)
}

module.exports = { getLanIPv4Addresses }
