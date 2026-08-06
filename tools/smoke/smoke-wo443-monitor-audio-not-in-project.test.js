'use strict'

/**
 * WO-443 (owner 06.08): "the monitor audio output is part of default project, which it
 * shouldnt be." Monitor-role audio outputs are box-local hardware (this box's headphone
 * device, cf. WO-425) — but ROUTING_EXTRA_KEYS carried `audioOutputs` wholesale, so every
 * project save embedded the monitor entry and every load imposed a (possibly stale, possibly
 * another box's) copy back onto the live config.
 *
 * Contract: project saves exclude role:'monitor' entries; project loads keep the BOX's
 * monitor entries and drop any the project carries (legacy projects have them).
 */

const { test } = require('node:test')
const assert = require('node:assert')

const {
	splitMonitorAudioOutputs,
	buildHardwareConfigFromConfig,
	applyHardwareConfigToCtx,
} = require('../../src/engine/project-hardware-config')

const MON = { id: 'audio_monitor_usb', label: 'Audio 2', role: 'monitor', type: 'system-audio', deviceName: 'sc60mon' }
const MAIN = { id: 'audio_1', label: 'Audio 1', type: 'portaudio', deviceName: 'hw:0,0' }

test('WO-443: project save excludes monitor-role audio outputs', () => {
	const hc = buildHardwareConfigFromConfig(
		{ audioOutputs: [MAIN, MON], casparServer: {} },
		{ get: () => null },
	)
	assert.deepEqual(
		hc.audioOutputs.map((o) => o.id),
		['audio_1'],
		'the monitor entry is box hardware — it must not be stamped into projects',
	)
})

test('WO-443: project load keeps the box monitor entry and drops the project copy', () => {
	const staleProjectMonitor = { ...MON, id: 'audio_monitor_other_box', deviceName: 'other' }
	let saved = null
	const ctx = {
		persistence: { set: () => {}, get: () => null },
		configManager: {
			get: () => ({ audioOutputs: [MAIN, MON] }),
			save: (next) => {
				saved = next
			},
		},
	}
	const ok = applyHardwareConfigToCtx(ctx, {
		version: 2,
		deviceGraph: { devices: [], connectors: [], edges: [] },
		audioOutputs: [{ ...MAIN, label: 'Audio 1 (project)' }, staleProjectMonitor],
	})
	assert.equal(ok, true)
	assert.ok(saved, 'configManager.save ran')
	const ids = saved.audioOutputs.map((o) => o.id)
	assert.deepEqual(ids, ['audio_1', 'audio_monitor_usb'], 'project portable entries + BOX monitor entry')
	assert.equal(saved.audioOutputs[0].label, 'Audio 1 (project)', 'portable entries come from the project')
	assert.equal(saved.audioOutputs[1].deviceName, 'sc60mon', 'monitor entry stays the box’s own')
})

test('WO-443: splitter treats missing/foreign shapes safely', () => {
	assert.deepEqual(splitMonitorAudioOutputs(null), { monitor: [], portable: [] })
	assert.deepEqual(splitMonitorAudioOutputs([{ id: 'x' }]).portable.length, 1)
})
