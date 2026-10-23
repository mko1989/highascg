'use strict'
/**
 * WO-692 — every NIC (also down ones) and Wi-Fi status from fake ip / nmcli / sysfs output; per-port apply keeps the
 * primary interface; Wi-Fi input validation.
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const ni = require('../../src/system/network-interfaces')
const wifi = require('../../src/api/system-network-wifi')

const IP = JSON.stringify([
	{ ifname: 'lo', addr_info: [{ family: 'inet', local: '127.0.0.1', prefixlen: 8 }] },
	{ ifname: 'eno1', addr_info: [{ family: 'inet', local: '192.168.0.23', prefixlen: 24 }] },
])
const OUT = {
	'ip -j -4 addr show': IP,
	'nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev':
		'eno1:ethernet:connected:highascg-eno1\nenp3s0:ethernet:unavailable:\nwlp0s20f3:wifi:disconnected:\nlo:loopback:unmanaged:\n',
	'nmcli -t -f NAME,DEVICE,TYPE con show': 'highascg-eno1:eno1:802-3-ethernet\nhighascg-enp3s0::802-3-ethernet\n',
	'nmcli -t -f ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns con show highascg-eno1':
		'ipv4.method:auto\nipv4.addresses:\nipv4.gateway:--\nipv4.dns:\n',
	'nmcli -t -f ipv4.method,ipv4.addresses,ipv4.gateway,ipv4.dns con show highascg-enp3s0':
		'ipv4.method:manual\nipv4.addresses:10.0.0.5/16\nipv4.gateway:10.0.0.1\nipv4.dns:1.1.1.1,8.8.8.8\n',
	'nmcli radio wifi': 'enabled\n',
	'nmcli -t -f IN-USE,BSSID,SSID,SIGNAL,SECURITY,CHAN dev wifi list --rescan no':
		' :AA\\:BB\\:CC\\:00\\:00\\:01:Office:40:WPA2:1\n*:AA\\:BB\\:CC\\:00\\:00\\:02:Studio\\: A:70:WPA2:36\n :AA\\:BB\\:CC\\:00\\:00\\:03:Office:80:WPA2:6\n :AA\\:BB\\:CC\\:00\\:00\\:04::50:WPA2:11\n',
}
const deps = {
	names: ['lo', 'eno1', 'enp3s0', 'wlp0s20f3', 'tailscale0', 'docker0'],
	exec: (cmd, args) => OUT[[cmd, ...args].join(' ')] ?? '',
	sys: (name, file) => ({ address: `mac-${name}`, operstate: name === 'eno1' ? 'up' : 'down', carrier: name === 'eno1' ? '1' : '0' })[file],
}

describe('WO-692 network interfaces', () => {
	it('lists wired ports (also down ones with an inactive profile) and Wi-Fi; skips lo / tun / bridges', () => {
		const list = ni.listNetworkInterfaces(deps)
		assert.deepEqual(list.map((i) => [i.name, i.kind]), [['eno1', 'ethernet'], ['enp3s0', 'ethernet'], ['wlp0s20f3', 'wifi']])
		const [eno1, enp, wl] = list
		assert.equal(eno1.address, '192.168.0.23')
		assert.equal(eno1.mode, 'dhcp')
		assert.equal(eno1.carrier, true)
		assert.equal(enp.address, null)
		assert.equal(enp.connection, 'highascg-enp3s0')
		assert.equal(enp.activeConnection, false)
		assert.equal(enp.mode, 'static')
		assert.deepEqual(enp.static, { address: '10.0.0.5', prefixLength: 16, gateway: '10.0.0.1', dns: ['1.1.1.1', '8.8.8.8'] })
		assert.equal(wl.connection, null)
		assert.equal(wl.mode, 'unknown')
	})

	it('Wi-Fi: one row per SSID (strongest, the joined one first), escaped colons, hidden SSIDs dropped', () => {
		const st = ni.buildWifiStatus(deps)
		assert.equal(st.available, true)
		assert.equal(st.radio, 'on')
		assert.equal(st.connected, 'Studio: A')
		assert.deepEqual(st.networks.map((n) => [n.ssid, n.signal, n.channel]), [['Studio: A', 70, 36], ['Office', 80, 6]])
		assert.equal(st.networks[0].bssid, 'AA:BB:CC:00:00:02')
	})

	it('no Wi-Fi adapter → not available, no scan read', () => {
		const st = ni.buildWifiStatus({ ...deps, names: ['eno1'] })
		assert.equal(st.available, false)
		assert.deepEqual(st.networks, [])
	})

	it('SSID / passphrase validation', () => {
		assert.equal(wifi.isValidSsid('Studio A'), true)
		assert.equal(wifi.isValidSsid(''), false)
		assert.equal(wifi.isValidSsid('x'.repeat(33)), false)
		assert.equal(wifi.isValidSsid('bad\nname'), false)
		assert.equal(wifi.isValidPsk(''), true)
		assert.equal(wifi.isValidPsk('short'), false)
		assert.equal(wifi.isValidPsk('long enough'), true)
		assert.equal(wifi.isValidPsk('a'.repeat(64)), true)
		assert.equal(wifi.isValidPsk('g'.repeat(64)), false)
	})
})
