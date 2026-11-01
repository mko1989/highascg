'use strict'

/**
 * WO-919 F4 / F20 — the xrandr plan against the outputs X really has: a head on an unplugged output is dropped (it
 * failed the whole command and grew the canvas → nodm restart), a lit unplanned head that overlaps the plan moves
 * right of it with its current mode. Injected `xrandr --query` text only — no live X.
 */

const test = require('node:test')
const assert = require('node:assert/strict')

const { parseXrandrOutputStates, reconcileHeadsWithOutputs } = require('../../src/utils/xrandr-unplanned-heads')
const { needsNodmRestartForLayout } = require('../../src/utils/xrandr-layout-verify')

/** The box on 01.11 before WO-920: DP-6 lit at +1920+0, on top of the planned DP-0; DP-2 down. */
const F20_QUERY = [
	'Screen 0: minimum 8 x 8, current 5760 x 1792, maximum 32767 x 32767',
	'DP-0 connected 3840x1792+1920+0 (normal left inverted right x axis y axis) 607mm x 345mm',
	'   3840x1792     50.00*+',
	'DP-2 disconnected (normal left inverted right x axis y axis)',
	'DP-4 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 607mm x 345mm',
	'   1920x1080     60.00*+  50.00',
	'DP-6 connected 1920x1080+1920+0 (normal left inverted right x axis y axis) 607mm x 345mm',
	'   1920x1080     60.00 +  59.94*',
	'   1280x720      60.00',
	'DP-7 connected (normal left inverted right x axis y axis)',
	'   1920x1080     60.00 +',
].join('\n')

test('parseXrandrOutputStates keeps every output with its lit geometry, current mode and rate', () => {
	const s = parseXrandrOutputStates(F20_QUERY)
	assert.deepEqual([...s.keys()], ['DP-0', 'DP-2', 'DP-4', 'DP-6', 'DP-7'])
	assert.equal(s.get('DP-2').connected, false)
	assert.deepEqual(
		['x', 'y', 'width', 'height', 'mode', 'rate', 'active'].map((k) => s.get('DP-6')[k]),
		[1920, 0, 1920, 1080, '1920x1080', 59.94, true],
	)
	assert.equal(s.get('DP-7').active, false, 'connected but off')
})

test('F4: a planned head on a disconnected output is dropped; F20: the overlapping unplanned head moves right', () => {
	const heads = [
		{ output: 'DP-4', x: 0, y: 0, mode: '1920x1080', rate: 60 },
		{ output: 'DP-0', x: 1920, y: 0, mode: '3840x1792_50.00', rate: 50 },
		{ output: 'DP-2', x: 5760, y: 0, mode: '1920x1080', rate: 50 },
	]
	const fit = reconcileHeadsWithOutputs(heads, parseXrandrOutputStates(F20_QUERY))
	assert.deepEqual(fit.heads.map((h) => h.output), ['DP-4', 'DP-0'])
	assert.deepEqual(fit.dropped, ['DP-2'])
	assert.deepEqual(
		fit.moved.map((m) => [m.output, m.x, m.y, m.mode, m.rate]),
		[['DP-6', 5760, 0, '1920x1080', 59.94]],
		'right of the planned canvas, current mode kept; the off DP-7 is left alone',
	)
})

test('an unplanned head that overlaps nothing stays put; no xrandr answer leaves the plan untouched', () => {
	const heads = [{ output: 'DP-4', x: 0, y: 0, mode: '1920x1080' }]
	const q = 'DP-4 connected 1920x1080+0+0 (x)\n   1920x1080 60.00*\nDP-6 connected 1920x1080+1920+0 (x)\n   1920x1080 60.00*'
	assert.deepEqual(reconcileHeadsWithOutputs(heads, parseXrandrOutputStates(q)).moved, [])
	const none = reconcileHeadsWithOutputs(heads, parseXrandrOutputStates(''))
	assert.deepEqual([none.heads, none.dropped, none.moved], [heads, [], []])
})

test('the nodm canvas check counts what the apply will really place', () => {
	const layout = {
		screens: {},
		multiview: {},
		mappingGpuOutputs: [
			{ sysId: 'DP-4', x: 0, y: 0, width: 1920, height: 1080 },
			{ sysId: 'DP-0', x: 1920, y: 0, width: 3840, height: 1792 },
			{ sysId: 'DP-2', x: 5760, y: 0, width: 1920, height: 1080 },
		],
	}
	const raw = (current) => F20_QUERY.replace('current 5760 x 1792', `current ${current}`)
	const displays = [{ name: 'DP-4' }, { name: 'DP-0' }, { name: 'DP-6' }]
	// the box's DRM inventory knows the unplugged port (without it the resolver guesses a live sibling, WO-315)
	const inventory = [{ name: 'card1-DP-2', shortName: 'DP-2', drmCard: 'card1', xrandrName: 'DP-2' }]
	// Before WO-919 the down DP-2 made this 7680 wide → nodm restart. Now: DP-4 + DP-0 + the moved DP-6 = 7680 too,
	// so the DP-6 move is what grows it; with DP-6 off the plan fits the running 5760 canvas.
	const lit = needsNodmRestartForLayout({}, { layout, inventory, xrDetailed: { raw: raw('5760 x 1792'), displays } })
	assert.deepEqual([lit.plannedCanvas.width, lit.disconnected, lit.movedUnplanned], [7680, ['DP-2'], ['DP-6']])
	assert.equal(lit.needed, true)
	const off = raw('5760 x 1792').replace('DP-6 connected 1920x1080+1920+0', 'DP-6 connected')
	const r = needsNodmRestartForLayout({}, { layout, inventory, xrDetailed: { raw: off, displays } })
	assert.deepEqual([r.plannedCanvas.width, r.needed, r.reason], [5760, false, 'canvas_fits'])
})

test('applyX11Layout runs the reconcile before it builds the xrandr command', () => {
	const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/utils/os-config-xrandr-apply.js'), 'utf8')
	assert.match(src, /reconcileHeadsWithOutputs\(xrandrHeads, parseXrandrOutputStates\(xrandrQueryOut\)\)/)
	assert.ok(src.indexOf('reconcileHeadsWithOutputs(') < src.indexOf('buildXrandrLayoutArgv(xrandrHeads)'))
})

test('F4: a loaded show keeps the box operator output (an old kiosk-era "screen" no longer opens a Caspar window)', () => {
	const { applyHardwareConfigFromProject } = require('../../src/engine/project-hardware-config')
	const op = (videoOutput, shmName) => ({ id: 'dst_operator_gui', mode: 'operator_gui', label: 'Operator GUI', width: 1920, height: 1080, fps: 50, videoMode: '1080p5000', videoOutput, shmName })
	let cfg = { screenDestinations: { version: 1, destinations: [op('shm', 'opgui')] } }
	const ctx = { config: {}, persistence: { set() {}, get() {} }, configManager: { get: () => cfg, save: (n) => (cfg = n) } }
	const project = {
		hardwareConfig: {
			version: 1,
			screenDestinations: { version: 1, destinations: [op('screen', 'old'), { id: 'd1', mode: 'pgm_prv', label: 'PGM 1', width: 1920, height: 1080, fps: 50 }] },
		},
	}
	applyHardwareConfigFromProject(ctx, project)
	const d = cfg.screenDestinations.destinations.find((x) => x.mode === 'operator_gui')
	assert.deepEqual([d.videoOutput, d.shmName], ['shm', 'opgui'])
	assert.equal(cfg.screenDestinations.destinations.length, 2, 'the show’s other destinations did load')
	assert.equal(project.hardwareConfig.screenDestinations.destinations[0].videoOutput, 'screen', 'the stored show is not rewritten')
})
