'use strict'

/**
 * WO-869 path (b) — the generated Caspar config for a mapping node's slice window: one extra `<screen>` (device 41,
 * consumer index 640) on the PGM channel that feeds the node, at the window's place on the desktop, window-sized,
 * with the `<slices>` baseline; the PGM `<screen>` goes off when every GPU head of that screen is in a slice window,
 * and stays when another cable still needs it. Legacy (direct-only) nodes generate no slice window at all.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const defaults = require('../../src/config/defaults')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const { sliceWindowScreensXml } = require('../../src/config/config-generator-slice-windows')

const NODE = 'mapping_x1'
const gpu = (id, ref) => ({ id, deviceId: 'caspar_host', kind: 'gpu_out', externalRef: ref })
const S = (id, outputId, src, rect, extra = {}) => ({ id, outputId, src, dst: { rect, ...extra } })

function appConfig({ slices, extraGpu = false, cableInput = true } = {}) {
	const config = JSON.parse(JSON.stringify(defaults))
	config.screenDestinations = { version: 1, destinations: [
		{ id: 'dst_a', label: 'Screen 1', mainScreenIndex: 0, mode: 'pgm_prv', videoMode: 'custom', width: 3840, height: 1080, fps: 50 }] }
	const outputs = [{ id: 'out_1', mode: '1080p5000', label: 'A' }, { id: 'out_2', mode: '1080p5000', label: 'B' }]
	const sinks = [gpu('gpu_a', 'DP-0'), gpu('gpu_b', 'DP-2')]
	config.deviceGraph = {
		version: 1,
		devices: [
			{ id: 'caspar_host', role: 'caspar_host' },
			{ id: 'destinations', role: 'destinations' },
			{ id: NODE, role: 'pixel_mapping', label: 'PM', settings: { numOutputs: 2, outputs, mappings: [], ...(slices ? { slices } : {}) } },
		],
		connectors: [
			{ id: 'dst_in_dst_a', deviceId: 'destinations', kind: 'destination_in', externalRef: 'dst_a' },
			{ id: `${NODE}_in`, deviceId: NODE, kind: 'pixel_map_in' },
			...outputs.map((o, i) => ({ id: `${NODE}_${o.id}`, deviceId: NODE, kind: 'pixel_map_out', index: i })),
			...sinks,
			...(extraGpu ? [gpu('gpu_c', 'DP-4')] : []),
		],
		edges: [
			...(cableInput ? [{ id: 'e0', sourceId: 'dst_in_dst_a', sinkId: `${NODE}_in` }] : []),
			...sinks.map((s, i) => ({ id: `e${i + 1}`, sourceId: `${NODE}_${outputs[i].id}`, sinkId: s.id })),
			...(extraGpu ? [{ id: 'e9', sourceId: 'dst_in_dst_a', sinkId: 'gpu_c' }] : []),
		],
	}
	return config
}

const WINDOW_SLICES = [
	S('a', 'out_1', { x: 0, y: 0, w: 960, h: 1080 }, { x: 0, y: 0, w: 960, h: 1080 }),
	S('b', 'out_1', { x: 960, y: 0, w: 960, h: 1080 }, { x: 960, y: 0, w: 960, h: 1080 }, { flipH: true }),
	S('c', 'out_2', { x: 1920, y: 0, w: 1920, h: 1080 }, { x: 0, y: 0, w: 1920, h: 1080 }),
]

/** The PGM channel's `<consumers>` block (channel 1 on this one-screen fixture). */
function pgmConsumers(xml) {
	const m = xml.match(/Screen 1 program output \(PGM\)[\s\S]*?<consumers>([\s\S]*?)<\/consumers>/)
	assert.ok(m, 'no PGM channel in the generated XML')
	return m[1]
}

const screens = (block) => [...block.matchAll(/<screen>\s*<device>(\d+)<\/device>/g)].map((m) => Number(m[1]))

test('legacy node (direct heads only): no slice window, the PGM window stays', () => {
	const flat = buildCasparGeneratorFlatConfig(appConfig())
	assert.equal(flat.screen_1_slice_windows, undefined)
	const c = pgmConsumers(buildConfigXml(flat))
	assert.deepEqual(screens(c), [1])
	assert.ok(!c.includes('<slices>'))
})

test('slice window: device 41 on the PGM channel, window-sized, the <slices> baseline; PGM window off', () => {
	const flat = buildCasparGeneratorFlatConfig(appConfig({ slices: WINDOW_SLICES }))
	assert.deepEqual(flat.screen_1_slice_windows.map((w) => [w.nodeId, w.device, w.consumerIndex, w.x, w.y, w.width, w.height]),
		[[NODE, 41, 640, 0, 0, 3840, 1080]])
	assert.equal(flat.screen_1_screen_consumer, false, 'both heads are in the window, so the PGM window would sit on them')
	const c = pgmConsumers(buildConfigXml(flat))
	assert.deepEqual(screens(c), [41])
	assert.equal(sliceWindowScreensXml(flat, 1), `
                <screen>
                    <device>41</device>
                    <x>0</x><y>0</y>
                    <width>3840</width><height>1080</height>
                    <stretch>none</stretch>
                    <windowed>true</windowed>
                    <vsync>false</vsync>
                    <always-on-top>true</always-on-top>
                    <borderless>true</borderless>
                    <gpu-texture>true</gpu-texture>
                    <slices>
                        <slice>
                            <src>0 0 960 1080</src>
                            <dst>0 0 960 0 960 1080 0 1080</dst>
                            <opacity>1</opacity>
                            <feather>0 0 0 0</feather>
                            <clip>0 0 1920 1080</clip>
                        </slice>
                        <slice>
                            <src>960 0 960 1080</src>
                            <dst>1920 0 960 0 960 1080 1920 1080</dst>
                            <opacity>1</opacity>
                            <feather>0 0 0 0</feather>
                            <clip>0 0 1920 1080</clip>
                        </slice>
                        <slice>
                            <src>1920 0 1920 1080</src>
                            <dst>1920 0 3840 0 3840 1080 1920 1080</dst>
                            <opacity>1</opacity>
                            <feather>0 0 0 0</feather>
                            <clip>1920 0 1920 1080</clip>
                        </slice>
                    </slices>
                </screen>`)
	assert.ok(c.includes(sliceWindowScreensXml(flat, 1)), 'the PGM channel carries exactly that block')
})

test('another GPU cable from the destination keeps the PGM window next to the slice window', () => {
	const flat = buildCasparGeneratorFlatConfig(appConfig({ slices: WINDOW_SLICES, extraGpu: true }))
	assert.notEqual(flat.screen_1_screen_consumer, false)
	assert.deepEqual(screens(pgmConsumers(buildConfigXml(flat))), [1, 41])
})

test('an output left without slices joins the window (black): the PGM window goes off, one screen consumer', () => {
	const flat = buildCasparGeneratorFlatConfig(appConfig({ slices: WINDOW_SLICES.filter((x) => x.outputId === 'out_1') }))
	assert.deepEqual(flat.screen_1_slice_windows.map((w) => [w.x, w.width, w.slices.length]), [[0, 3840, 2]])
	assert.equal(flat.screen_1_screen_consumer, false)
	assert.deepEqual(screens(pgmConsumers(buildConfigXml(flat))), [41])
})

test('no feed into the node → no slice window; stale keys never survive a regenerate', () => {
	const flat = buildCasparGeneratorFlatConfig(appConfig({ slices: WINDOW_SLICES, cableInput: false }))
	assert.equal(flat.screen_1_slice_windows, undefined)
	const cfg = appConfig({ slices: WINDOW_SLICES })
	cfg.casparServer = { ...(cfg.casparServer || {}), screen_1_slice_windows: [{ device: 41, width: 10, height: 10, slices: [] }] }
	cfg.deviceGraph.edges = cfg.deviceGraph.edges.filter((e) => e.id !== 'e0')
	assert.equal(buildCasparGeneratorFlatConfig(cfg).screen_1_slice_windows, undefined)
})

test('hooks: the flat-config step and the PGM <consumers> both call the slice-window module', () => {
	const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/config', f), 'utf8')
	assert.match(read('build-caspar-generator-config.js'), /require\('\.\/config-generator-slice-windows'\)\.applySliceWindowsToScreens\(merged, appConfig \|\| \{\}\)/)
	assert.match(read('config-generator-consumer-attach-screen.js'), /<consumers>\$\{screenConsumerXml\}\$\{sliceWindowScreensXml\(config, n\)\}/)
})
