'use strict'

/**
 * WO-868 — "Operator GUI first": golden proofs of the generated casparcg.config, the channel map and the X layout for
 * both switch states, on a box-shaped rig (tools/smoke/fixtures/wo868/rig.config.json: the box's own caspar_server,
 * screen destinations, device graph and audio outputs on 30.10, reduced to the keys that change the output).
 *
 * off.* were captured from the code BEFORE WO-868 existed: OFF must stay byte-identical to them.
 * on.*  are the reviewed ON outputs: channel 1 = operator GUI (shm opgui), 2-3 PGM1/PRV1, 4-5 PGM2/PRV2, host pins
 * (DeckLink 6, live audio 7) unchanged, monitor 8; operator monitor at x=0 and the LED wall (DP-0) at x=1920.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const FIX = path.join(__dirname, 'fixtures', 'wo868')
const { buildConfigXml } = require('../../src/config/config-generator')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { getChannelMap } = require('../../src/config/routing')
const { calculateLayoutPositions } = require('../../src/utils/os-layout-calculator')
const og = require('../../src/config/operator-gui-first')

const read = (n) => fs.readFileSync(path.join(FIX, n), 'utf8')
const rig = () => JSON.parse(read('rig.config.json'))
const jsonText = (v) => JSON.stringify(v, null, 1)

function outputs(cfg) {
	const flat = buildCasparGeneratorFlatConfig(cfg)
	return { xml: buildConfigXml(flat), map: jsonText(getChannelMap(flat)), layout: jsonText(calculateLayoutPositions(cfg)) }
}

test('WO-868 OFF: config XML, channel map and layout are byte-identical to the pre-WO-868 goldens', () => {
	const cfg = rig()
	assert.equal(Object.prototype.hasOwnProperty.call(cfg.casparServer, 'operator_gui_first'), false, 'fixture has no flag')
	const o = outputs(cfg)
	assert.equal(o.xml, read('off.caspar.xml'))
	assert.equal(o.map, read('off.channel-map.json'))
	assert.equal(o.layout, read('off.layout.json'))
	// an explicit false is the same as absent
	const f = rig()
	f.casparServer.operator_gui_first = false
	assert.equal(outputs(f).xml, read('off.caspar.xml'))
	assert.equal(outputs(og.withOperatorGuiFirst(rig(), false)).map, read('off.channel-map.json'))
})

test('WO-868 ON: config XML, channel map and layout match the reviewed goldens', () => {
	const o = outputs(og.withOperatorGuiFirst(rig(), true))
	assert.equal(o.xml, read('on.caspar.xml'))
	assert.equal(o.map, read('on.channel-map.json'))
	assert.equal(o.layout, read('on.layout.json'))
	// the flat generator config carries the key (getChannelMap / the generator read it there)
	assert.equal(buildCasparGeneratorFlatConfig(og.withOperatorGuiFirst(rig(), true)).operator_gui_first, true)
	assert.equal('operator_gui_first' in buildCasparGeneratorFlatConfig(rig()), false)
})

test('WO-868 ON: channel 1 is the operator GUI, everything else moves up by one, host pins stay', () => {
	const off = JSON.parse(read('off.channel-map.json'))
	const on = JSON.parse(read('on.channel-map.json'))
	assert.deepEqual(off.operatorGuiChannels, [5])
	assert.deepEqual(on.operatorGuiChannels, [1])
	assert.deepEqual(off.programChannels, [1, 3])
	assert.deepEqual(on.programChannels, [2, 4])
	assert.deepEqual(on.previewChannels, [3, 5])
	assert.equal(on.operatorGuiFirst, true)
	assert.equal('operatorGuiFirst' in off, false, 'OFF adds no key')
	assert.deepEqual(on.decklinkInputChannels, off.decklinkInputChannels, 'WO-414 host pins never move')
	assert.deepEqual(on.liveAudioInputChannels, off.liveAudioInputChannels)
	assert.equal(on.monitorCh, off.monitorCh)
	const xml = read('on.caspar.xml')
	const first = xml.indexOf('<channel>')
	assert.ok(first > 0)
	assert.match(xml.slice(first, xml.indexOf('</channel>', first)), /<shm>\s*<name>opgui<\/name>/, 'first <channel> is the GUI shm')
	assert.match(xml, /Caspar channel 1: Operator GUI channel/)
	assert.match(xml, /Caspar channel 2: Screen 1 program output \(PGM\)/)
})

test('WO-868 ON: operator monitor at x=0, the wall moves right by the monitor width', () => {
	const off = JSON.parse(read('off.layout.json'))
	const on = JSON.parse(read('on.layout.json'))
	assert.equal(off.screens['1'].x, 0)
	assert.equal(off.operatorGui['1'].x, off.screens['1'].width)
	assert.equal(on.operatorGui['1'].x, 0)
	assert.equal(on.screens['1'].x, on.operatorGui['1'].width)
	assert.equal(on.screens['1'].sysId, off.screens['1'].sysId, 'same jack, only X moves')
	assert.equal(on.operatorGui['1'].sysId, off.operatorGui['1'].sysId)
	// the PGM1 screen consumer follows the wall
	const pgm1 = (xml) => xml.slice(xml.indexOf('Screen 1 program output'), xml.indexOf('Screen 1 preview output'))
	assert.match(pgm1(read('off.caspar.xml')), /<x>0<\/x>/)
	assert.match(pgm1(read('on.caspar.xml')), new RegExp(`<x>${on.screens['1'].x}</x>`))
})

test('WO-868 flag helpers: absent = off, nested wins over flat, off removes the key', () => {
	assert.equal(og.isOperatorGuiFirst({}), false)
	assert.equal(og.isOperatorGuiFirst(null), false)
	assert.equal(og.isOperatorGuiFirst({ operator_gui_first: true }), true)
	assert.equal(og.isOperatorGuiFirst({ casparServer: { operator_gui_first: 'true' } }), true)
	assert.equal(og.isOperatorGuiFirst({ operator_gui_first: true, casparServer: { operator_gui_first: false } }), false)
	const on = og.withOperatorGuiFirst({ casparServer: { a: 1 } }, true)
	assert.deepEqual(on.casparServer, { a: 1, operator_gui_first: true })
	const off = og.withOperatorGuiFirst({ ...on, operator_gui_first: true }, false)
	assert.deepEqual(off, { casparServer: { a: 1 } })
	assert.equal(og.channelSchemeFor(on), og.CHANNEL_SCHEME_FIRST)
	assert.equal(og.channelSchemeFor(off), og.CHANNEL_SCHEME_LEGACY)
})

test('WO-868 defaultProgramChannel: literal 1 when off, PGM Screen 1 when on', () => {
	assert.equal(og.defaultProgramChannel(rig()), 1)
	assert.equal(og.defaultProgramChannel({ config: rig() }), 1)
	assert.equal(og.defaultProgramChannel(og.withOperatorGuiFirst(rig(), true)), 2)
	assert.equal(og.defaultProgramChannel({ config: og.withOperatorGuiFirst(rig(), true) }), 2)
	assert.equal(og.defaultProgramChannel(null), 1)
	const { resolveCgRequestChannel } = require('../../src/engine/cg-routing')
	assert.equal(resolveCgRequestChannel({}, { config: rig() }), 1)
	assert.equal(resolveCgRequestChannel({}, { config: og.withOperatorGuiFirst(rig(), true) }), 2)
	assert.equal(resolveCgRequestChannel({ channel: 7 }, { config: og.withOperatorGuiFirst(rig(), true) }), 7)
	const { resolveVirtualCameraChannel } = require('../../src/virtual-output/v4l2-bridge')
	assert.equal(resolveVirtualCameraChannel(rig()), 1)
	assert.equal(resolveVirtualCameraChannel(og.withOperatorGuiFirst(rig(), true)), 2)
	assert.equal(resolveVirtualCameraChannel({ ...og.withOperatorGuiFirst(rig(), true), virtualCamera: { channel: 4 } }), 4)
})

test('WO-868 the flag changes nothing without an operator GUI destination or with virtual main channels', () => {
	const cfg = rig()
	const noGui = { ...cfg, screenDestinations: { ...cfg.screenDestinations, destinations: cfg.screenDestinations.destinations.filter((d) => d.mode !== 'operator_gui') } }
	const a = getChannelMap(buildCasparGeneratorFlatConfig(noGui))
	assert.deepEqual(a.operatorGuiChannels || [], [])
	const b = getChannelMap(buildCasparGeneratorFlatConfig(og.withOperatorGuiFirst(noGui, true)))
	assert.equal(jsonText(b), jsonText(a))
	assert.equal(outputs(og.withOperatorGuiFirst(noGui, true)).xml, outputs(noGui).xml)
	const virt = { ...cfg, casparServer: { ...cfg.casparServer, virtual_main_channels: [{ pgm: 1, prv: 2 }, { pgm: 3, prv: 4 }] } }
	const v0 = getChannelMap(buildCasparGeneratorFlatConfig(virt))
	assert.equal(v0.useVirtual, true)
	assert.equal(jsonText(getChannelMap(buildCasparGeneratorFlatConfig(og.withOperatorGuiFirst(virt, true)))), jsonText(v0))
})
