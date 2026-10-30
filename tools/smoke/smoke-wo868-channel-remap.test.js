'use strict'

/**
 * WO-868 — the role-identity channel remap and the per-project channel scheme (read / write hooks).
 * Pure: the rig is tools/smoke/fixtures/wo868/rig.config.json; nothing touches the box.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const R = require('../../src/config/channel-remap')
const { getChannelMap } = require('../../src/config/routing')
const og = require('../../src/config/operator-gui-first')
const scheme = require('../../src/engine/project-channel-scheme')

const rig = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wo868', 'rig.config.json'), 'utf8'))
const BOX_REMAP = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 1, 6: 6, 7: 7, 8: 8 }

test('WO-868 remap from the box rig: PGM/PRV up by one, GUI 5 → 1, host pins and monitor stay', () => {
	const off = getChannelMap(rig())
	const on = getChannelMap(og.withOperatorGuiFirst(rig(), true))
	const remap = R.buildChannelRemap(off, on)
	assert.deepEqual(R.remapToObject(remap), BOX_REMAP)
	assert.equal(R.isIdentityRemap(remap), false)
	assert.deepEqual(R.remapToObject(R.buildChannelRemap(on, off)), R.remapToObject(R.invertRemap(remap)))
	assert.equal(R.isIdentityRemap(R.buildChannelRemap(off, off)), true)
})

test('WO-868 remap is one simultaneous substitution (1→2 and 2→3 never chain to 1→3)', () => {
	const remap = new Map(Object.entries(BOX_REMAP).map(([a, b]) => [Number(a), b]))
	const stats = { count: 0 }
	const out = R.remapDeep(['route://1', 'route://2', 'route://5-10', 'route://1-12'], remap, stats)
	assert.deepEqual(out, ['route://2', 'route://3', 'route://1-10', 'route://2-12'])
	assert.equal(stats.count, 4)
	// round trip with the inverse restores the input exactly
	assert.deepEqual(R.remapDeep(out, R.invertRemap(remap)), ['route://1', 'route://2', 'route://5-10', 'route://1-12'])
})

test('WO-868 remapDeep touches only channel references', () => {
	const remap = new Map([[1, 2], [2, 3], [5, 1]])
	const stats = { count: 0 }
	const input = {
		layers: [{ source: { value: 'route://1-10', type: 'route' }, layerNumber: 1, channel: 1 }],
		label: 'route://1 is the PGM', // not a bare route string
		url: 'http://route://1',
		out: { source: 'channel_2', videoSource: 'channel_5', name: 'channel_1' },
		hostChannel: 5,
		inputsChannel: '2',
		thumbnailChannel: 9, // no role claims 9
		casparChannel: 1,
		decklinkSlot: 1,
		program_1: 'program_1',
		dest: { kind: 'v4l2_out', caspar: { channel: 1 } },
		other: { kind: 'screen', caspar: { channel: 1 } },
	}
	const out = R.remapDeep(input, remap, stats)
	assert.equal(out.layers[0].source.value, 'route://2-10')
	assert.equal(out.layers[0].layerNumber, 1)
	assert.equal(out.layers[0].channel, 1, 'a bare `channel` field is not a stored channel reference')
	assert.equal(out.label, input.label)
	assert.equal(out.url, input.url)
	assert.deepEqual(out.out, { source: 'channel_3', videoSource: 'channel_1', name: 'channel_1' })
	assert.equal(out.hostChannel, 1)
	assert.equal(out.inputsChannel, '3')
	assert.equal(out.thumbnailChannel, 9)
	assert.equal(out.casparChannel, 2)
	assert.equal(out.decklinkSlot, 1)
	assert.equal(out.program_1, 'program_1')
	assert.deepEqual(out.dest.caspar, { channel: 2 })
	assert.deepEqual(out.other.caspar, { channel: 1 })
	assert.equal(stats.count, 7)
	assert.equal(input.layers[0].source.value, 'route://1-10', 'input not mutated')
})

test('WO-868 channel-keyed state is re-keyed; config slices report only what changed', () => {
	const remap = new Map(Object.entries(BOX_REMAP).map(([a, b]) => [Number(a), b]))
	const stats = { count: 0 }
	const banks = R.remapChannelKeyedObject({ 1: 'b', 2: 'a', 3: 'b', 4: 'a', note: 'x' }, remap, stats)
	assert.deepEqual(banks, { 2: 'b', 3: 'a', 4: 'b', 5: 'a', note: 'x' })
	assert.equal(stats.count, 4)
	const live = R.remapChannelKeyedObject({ 1: { sceneId: 's1', layers: [{ source: { value: 'route://5' } }] } }, remap)
	assert.deepEqual(live, { 2: { sceneId: 's1', layers: [{ source: { value: 'route://1' } }] } })

	const cfg = {
		extraLiveSources: [{ value: 'route://6-1', inputsChannel: 6 }, { value: 'route://1', thumbnailChannel: 1 }],
		streamOutputs: [{ source: 'program_1' }],
		virtualCamera: { enabled: true, channel: 1 },
		casparServer: { screen_count: 2 },
	}
	const { patch, count } = R.remapConfigSlices(cfg, remap)
	assert.deepEqual(Object.keys(patch).sort(), ['extraLiveSources', 'virtualCamera'])
	assert.deepEqual(patch.extraLiveSources[1], { value: 'route://2', thumbnailChannel: 2 })
	assert.equal(patch.virtualCamera.channel, 2)
	assert.equal(count, 3)
	assert.deepEqual(R.remapConfigSlices({ virtualCamera: { enabled: true } }, remap).patch, {}, 'an unset vcam channel follows PGM 1 itself')
})

test('WO-868 convertProjectChannelScheme: stamp, renumber, back to legacy is byte-identical', () => {
	const cfgOn = og.withOperatorGuiFirst(rig(), true)
	const project = {
		version: 1,
		name: 'p',
		rev: 4,
		scenes: { scenes: [{ id: 's', layers: [{ source: { value: 'route://1-10' } }, { source: { value: 'route://5' } }] }] },
	}
	const r = scheme.convertProjectChannelScheme(project, cfgOn)
	assert.equal(r.converted, true)
	assert.equal(r.count, 2)
	assert.equal(r.from, 'legacy')
	assert.equal(r.to, og.CHANNEL_SCHEME_FIRST)
	assert.equal(r.project.channelScheme, og.CHANNEL_SCHEME_FIRST)
	assert.deepEqual(r.project.scenes.scenes[0].layers.map((l) => l.source.value), ['route://2-10', 'route://1'])
	// converting again is a no-op (the stamp prevents a second shift)
	const again = scheme.convertProjectChannelScheme(r.project, cfgOn)
	assert.equal(again.converted, false)
	assert.equal(again.project, r.project)
	// and back
	const back = scheme.convertProjectChannelScheme(r.project, rig())
	assert.equal(back.converted, true)
	assert.equal(JSON.stringify(back.project), JSON.stringify(project))
	// a project without channel references is only stamped (same object when nothing to do)
	const empty = { version: 1, name: 'e' }
	const s = scheme.convertProjectChannelScheme(empty, cfgOn)
	assert.equal(s.converted, false)
	assert.equal(s.project.channelScheme, og.CHANNEL_SCHEME_FIRST)
	assert.equal(scheme.convertProjectChannelScheme(empty, rig()).project, empty, 'legacy stays unstamped')
})

test('WO-868 a project converts with its OWN rig: a rig without an operator GUI keeps its numbers', () => {
	const cfgOn = og.withOperatorGuiFirst(rig(), true)
	const own = rig()
	own.screenDestinations = { ...own.screenDestinations, destinations: own.screenDestinations.destinations.filter((d) => d.mode !== 'operator_gui') }
	const remap = scheme.projectChannelRemap(cfgOn, { hardwareConfig: null }, 'legacy', og.CHANNEL_SCHEME_FIRST)
	assert.deepEqual(R.remapToObject(remap), BOX_REMAP)
	const cfgNoGui = og.withOperatorGuiFirst(own, true)
	assert.equal(R.isIdentityRemap(scheme.projectChannelRemap(cfgNoGui, {}, 'legacy', og.CHANNEL_SCHEME_FIRST)), true)
})

test('WO-868 read / write hooks: unstamped read = legacy, unstamped write = current scheme, off until registered', () => {
	const project = { name: 'p', scenes: { scenes: [{ layers: [{ source: { value: 'route://1-10' } }] }] } }
	scheme.setChannelSchemeConfigSource(null)
	assert.equal(scheme.adaptProjectOnRead(project), project, 'no live config registered → untouched')
	assert.equal(scheme.adaptProjectOnWrite(project), project)
	let live = og.withOperatorGuiFirst(rig(), true)
	scheme.setChannelSchemeConfigSource(() => live)
	const warn = console.warn
	console.warn = () => {}
	try {
		const read = scheme.adaptProjectOnRead(project)
		assert.equal(read.channelScheme, og.CHANNEL_SCHEME_FIRST)
		assert.equal(read.scenes.scenes[0].layers[0].source.value, 'route://2-10', 'legacy file renumbered on read')
		// the web client drops the stamp on save: an unstamped write is already in the current scheme
		const { channelScheme, ...unstamped } = read
		void channelScheme
		const written = scheme.adaptProjectOnWrite(unstamped)
		assert.equal(written.channelScheme, og.CHANNEL_SCHEME_FIRST)
		assert.equal(written.scenes.scenes[0].layers[0].source.value, 'route://2-10', 'not shifted twice')
		// an import marked legacy is converted on write
		const imported = scheme.adaptProjectOnWrite({ ...project, channelScheme: 'legacy' })
		assert.equal(imported.scenes.scenes[0].layers[0].source.value, 'route://2-10')
		// switch off: a stamped file reads back as legacy numbers, no stamp
		live = rig()
		const legacy = scheme.adaptProjectOnRead(read)
		assert.equal(legacy.scenes.scenes[0].layers[0].source.value, 'route://1-10')
		assert.equal('channelScheme' in legacy, false)
		assert.equal(scheme.adaptProjectOnRead(project), project, 'off + unstamped = untouched object')
	} finally {
		console.warn = warn
		scheme.setChannelSchemeConfigSource(null)
	}
})

test('WO-868 operator_gui_first is machine-local: never stored in a project hardware slice', () => {
	const phc = require('../../src/engine/project-hardware-config')
	const hc = phc.buildHardwareConfigFromConfig(og.withOperatorGuiFirst(rig(), true))
	assert.equal(JSON.stringify(hc).includes('operator_gui_first'), false)
})
