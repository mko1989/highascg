'use strict'

const assert = require('assert')
const {
	normalizeProjectFps,
	defaultVideoModeForProjectFps,
	videoModeMatchesProjectFps,
	applyProjectFpsToInheritedOutputs,
} = require('../../src/config/project-fps')
const { normalizeNetworkSettings, isAllowedEthernetIface, isValidIpv4 } = require('../../src/config/network-settings')

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
assert.strictEqual(isValidIpv4('192.168.1.10'), true)
assert.strictEqual(isValidIpv4('999.1.1.1'), false)
const net = normalizeNetworkSettings({ mode: 'static', primaryInterface: 'eth0', static: { address: '10.0.0.2' } }, {})
assert.strictEqual(net.mode, 'static')
assert.strictEqual(net.primaryInterface, 'eth0')

console.log('smoke-project-fps-network: OK')
