'use strict'

/**
 * WO-406 smoke — monitor / headphone solo bus from a Device-View audio output.
 *
 * The solo system (POST /api/audio/solo → route:// onto the monitor channel) existed
 * end to end, but nothing on the box could ENABLE it: no UI set `monitor_channel_enabled`,
 * so `getChannelMap().monitorCh` stayed null and the mixer SOLO buttons no-op'd.
 *
 * The fix: an audio output saved with `role: 'monitor'` + a device name turns the bus on
 * through ONE resolver (`src/config/monitor-bus.js`) used by BOTH the runtime channel map
 * (routing-map → solo API) and the config generator (merged flat keys → monitor channel
 * XML). These tests pin: resolver precedence, channel-map allocation, generator derivation,
 * emitted XML, and the client save wiring.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const { resolveMonitorBus } = require('../../src/config/monitor-bus')

const monitorEntry = {
	id: 'audio_out_usb',
	label: 'USB headphones',
	type: 'portaudio',
	role: 'monitor',
	deviceName: 'Sennheiser SC60: USB Audio (hw:2,0)',
	bufferFrames: 256,
	latencyMs: 30,
	fifoMs: 60,
	enabled: true,
}

test('WO-406: resolver — off by default, on via role entry, explicit keys win', () => {
	assert.equal(resolveMonitorBus({}).enabled, false)
	assert.equal(resolveMonitorBus({ audioOutputs: [{ ...monitorEntry, role: '' }] }).enabled, false)
	// A monitor entry without a device must NOT enable the bus (PortAudio default device
	// could double-open the main out).
	assert.equal(resolveMonitorBus({ audioOutputs: [{ ...monitorEntry, deviceName: ' ' }] }).enabled, false)
	assert.equal(resolveMonitorBus({ audioOutputs: [{ ...monitorEntry, enabled: false }] }).enabled, false)

	const viaEntry = resolveMonitorBus({ audioOutputs: [monitorEntry] })
	assert.equal(viaEntry.enabled, true)
	assert.equal(viaEntry.deviceName, monitorEntry.deviceName)
	assert.equal(viaEntry.bufferFrames, 256)
	assert.equal(viaEntry.latencyMs, 30)
	assert.equal(viaEntry.fifoMs, 60)

	// Explicit casparServer keys outrank the entry's device.
	const explicit = resolveMonitorBus({
		casparServer: { monitor_channel_enabled: 'true', monitor_portaudio_device: 'hw:9,0' },
		audioOutputs: [monitorEntry],
	})
	assert.equal(explicit.enabled, true)
	assert.equal(explicit.deviceName, 'hw:9,0')
})

test('WO-406: channel map allocates monitorCh from a role entry (solo API resolution path)', () => {
	const { getChannelMap } = require('../../src/config/routing-map')
	const base = { casparServer: { screen_count: 1 } }
	assert.equal(getChannelMap(base).monitorCh, null)
	const withMonitor = { ...base, audioOutputs: [monitorEntry] }
	const map = getChannelMap(withMonitor)
	assert.ok(Number.isFinite(map.monitorCh) && map.monitorCh > 0, 'monitorCh allocated')
})

test('WO-406: generator derives flat keys and emits the monitor channel XML', () => {
	const { applyAudioOutputOverridesToScreens } = require('../../src/config/build-caspar-generator-config-audio')
	const { buildMonitorChannelXml } = require('../../src/config/config-generator-audio-xml')

	const merged = { caspar_build_profile: 'custom_live', screen_count: 1 }
	applyAudioOutputOverridesToScreens(merged, { audioOutputs: [monitorEntry] })
	assert.equal(merged.monitor_channel_enabled, true)
	assert.equal(merged.monitor_portaudio_device, monitorEntry.deviceName)
	assert.equal(merged.monitor_portaudio_buffer_frames, 256)

	const xml = buildMonitorChannelXml(merged, 9)
	assert.match(xml, /Monitor \/ headphone mix/)
	assert.match(xml, /Sennheiser SC60: USB Audio \(hw:2,0\)/)
	assert.match(xml, /<output-channels>2<\/output-channels>/)

	// No monitor entry → nothing derived, nothing emitted.
	const clean = { caspar_build_profile: 'custom_live', screen_count: 1 }
	applyAudioOutputOverridesToScreens(clean, { audioOutputs: [] })
	assert.equal(clean.monitor_channel_enabled, undefined)
	assert.equal(buildMonitorChannelXml(clean, 9), '')
})

test('WO-406: client inspector saves the role; solo API keeps the monitorCh fallback', () => {
	const inspector = read('client/components/device-view-inspector-audio.js')
	assert.match(inspector, /role: monitorChk\.checked \? 'monitor' : ''/, 'save writes the role')
	assert.match(inspector, /Monitor \/ headphone bus \(mixer SOLO output\)/, 'checkbox is labelled')

	const routes = read('src/api/routes-audio.js')
	assert.match(routes, /const monitorCh = previewCh \?\? map\.monitorCh/, 'solo resolves to the monitor channel when audioPreview is off')

	// The settings sanitizer whitelists audioOutputs fields — it silently ate `role`
	// on the first live save. Pin the passthrough.
	const settingsPost = read('src/api/settings-post.js')
	assert.match(settingsPost, /if \(String\(x\.role \|\| ''\)\.toLowerCase\(\) === 'monitor'\) out\.role = 'monitor'/, 'sanitizer keeps the monitor role')

	const routingMap = read('src/config/routing-map.js')
	assert.match(routingMap, /resolveMonitorBus\(config\)\.enabled \? nextCh\+\+ : null/, 'channel map allocates from the shared resolver')
})
