'use strict'

const assert = require('assert')
const {
	normalizeProjectFps,
	defaultVideoModeForProjectFps,
	videoModeMatchesProjectFps,
	applyProjectFpsToInheritedOutputs,
} = require('../../src/config/project-fps')
const { normalizeNetworkSettings, isAllowedEthernetIface, isValidIpv4 } = require('../../src/config/network-settings')
const { resolveNetworkConfigSource } = require('../../src/system/network-inventory')

assert.strictEqual(normalizeProjectFps(50), 50)
assert.strictEqual(normalizeProjectFps(49.9), 50)
assert.strictEqual(defaultVideoModeForProjectFps(25), '1080p2500')
assert.strictEqual(videoModeMatchesProjectFps('1080p5000', 50), true)
assert.strictEqual(videoModeMatchesProjectFps('1080p2500', 50), false)

const cfg = {
	machineProfile: { defaultProjectFps: 50 },
	casparServer: { screen_count: 1, screen_1_mode: '1080p5000', multiview_mode: '1080p5000' },
	screenDestinations: {
		destinations: [{ id: 'd1', videoMode: '1080p5000', inheritsProjectFps: true, width: 1920, height: 1080, fps: 50 }],
	},
}
applyProjectFpsToInheritedOutputs(cfg, 25, 50)
assert.strictEqual(cfg.machineProfile.defaultProjectFps, 25)
assert.strictEqual(cfg.casparServer.screen_1_mode, '1080p2500')
assert.strictEqual(cfg.screenDestinations.destinations[0].videoMode, '1080p2500')

assert.strictEqual(isAllowedEthernetIface('eth0'), true)
assert.strictEqual(isAllowedEthernetIface('wlan0'), false)
/* Every box shipped before highascg7579 had an `enoN` NIC, so a digits-only suffix passed unnoticed.
 * That box's `enp3s0` was filtered out entirely — /api/system/network returned interfaces:[] and the
 * GUI showed "(no Ethernet found)" with no way to configure the network. Cover each systemd
 * predictable-name scheme, and keep the non-Ethernet classes excluded. */
for (const ok of ['eno1', 'eno2', 'enp3s0', 'enp4s0', 'enp0s31f6', 'ens33', 'eno1np0', 'enx047c1615c6e4']) {
	assert.strictEqual(isAllowedEthernetIface(ok), true, `expected ${ok} to be an allowed Ethernet iface`)
}
for (const no of ['wlo1', 'wlp0s20f3', 'lo', 'tailscale0', 'docker0', 'br-abc123', 'veth1a2b', 'en', '']) {
	assert.strictEqual(isAllowedEthernetIface(no), false, `expected ${no} to be rejected`)
}
assert.strictEqual(
	normalizeNetworkSettings({ mode: 'dhcp', primaryInterface: 'enp3s0' }, {}).primaryInterface,
	'enp3s0',
)
assert.strictEqual(isValidIpv4('192.168.1.10'), true)
assert.strictEqual(isValidIpv4('999.1.1.1'), false)
const net = normalizeNetworkSettings({ mode: 'static', primaryInterface: 'eth0', static: { address: '10.0.0.2' } }, {})
assert.strictEqual(net.mode, 'static')
assert.strictEqual(net.primaryInterface, 'eth0')

assert.strictEqual(resolveNetworkConfigSource(null).source, 'default')
assert.strictEqual(
	resolveNetworkConfigSource({ mode: 'static', primaryInterface: 'eth0', static: { address: '10.0.0.2' } }).source,
	'ui',
)

console.log('smoke-project-fps-network: OK')
