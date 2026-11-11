'use strict'

/**
 * WO-1038 smoke — looks drive the PixelHue switcher: a look's linked placeholder layers become `layers/window`
 * writes on a program take, only when switched on, verified by read-back, and never in the way of the take.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { windowsFromLook, driveLook, driveLookOnTake, lookDrivesSwitcher } = require('../../src/pixelhue/pixelhue-look-drive')
const { handleSetConfig, readSettings } = require('../../src/api/routes-pixelhue')

const snapOf = (layers, screen = {}) => ({ screens: [{ screenId: 1, name: 'Screen 1', x: 0, y: 0, width: 3072, height: 1024, ...screen, layers }] })
const swLayer = (layerId, x, y, width, height, extra = {}) => ({ layerId, x, y, width, height, type: 'normal', scene: 'pgm', sourceId: 25, sourceType: 2, ...extra })
const plain = (r) => ({ ...r, changes: r.changes.map(({ screen: _s, ...c }) => c) })
const lookLayer = (layerId, fill, extra = {}) => ({ layerNumber: 11, fill, pixelhue: { layerId, screenId: 1, name: `L${layerId}`, ...extra } })

/** A switcher that keeps what it is told (or, `stubborn`, ignores it). */
function fakeReader(layers, { stubborn = false } = {}) {
	const puts = []
	return {
		puts,
		read: async () => snapOf(layers.map((l) => ({ ...l }))),
		put: async (p, body) => {
			puts.push([p, body])
			if (!stubborn) for (const c of body) Object.assign(layers.find((l) => l.layerId === c.layerId), c.window)
			return { code: 0 }
		},
	}
}

describe('WO-1038 looks drive the PixelHue switcher', () => {
	it('a linked placeholder\'s rectangle becomes the switcher layer\'s window, in screen pixels', () => {
		const scene = { layers: [lookLayer(7, { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 }), { layerNumber: 10, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } }] }
		const r = plain(windowsFromLook(scene, snapOf([swLayer(7, 0, 0, 100, 100)])))
		assert.deepEqual(r, { changes: [{ layerId: 7, name: 'L7', window: { x: 1536, y: 256, width: 768, height: 512 } }], skipped: [] })
	})

	it('unchanged, unticked and vanished layers send nothing; a layer may hang off the screen, as on the switcher', () => {
		const snap = snapOf([swLayer(7, 1536, 256, 768, 512), swLayer(8, 0, 0, 100, 100), swLayer(9, 0, 0, 100, 100)])
		const scene = {
			layers: [
				lookLayer(7, { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 }), // already there
				lookLayer(8, { x: 0.1, y: 0.1, scaleX: 0.5, scaleY: 0.5 }, { drive: false }), // operator unticked it
				lookLayer(99, { x: 0, y: 0, scaleX: 0.5, scaleY: 0.5 }), // gone from the switcher
				lookLayer(9, { x: 0.9, y: -0.2, scaleX: 0.5, scaleY: 0.5 }), // hangs off the screen
				lookLayer(9, { x: 0, y: 0, scaleX: 0.1, scaleY: 0.1 }), // a second placeholder of the same layer
			],
		}
		const r = plain(windowsFromLook(scene, snap))
		assert.deepEqual(r.changes, [{ layerId: 9, name: 'L9', window: { x: 2765, y: -205, width: 1536, height: 512 } }])
		assert.deepEqual(r.skipped, ['L99: not on the switcher any more'])
		assert.equal(lookDrivesSwitcher({ layers: [lookLayer(8, {}, { drive: false }), { fill: {} }] }), false)
	})

	it('pixelhue-studio\'s rules: 64 px minimum, locked PGM, editable layer types only, Cut & Fill fill is editable', () => {
		const tiny = windowsFromLook({ layers: [lookLayer(7, { x: 0, y: 0, scaleX: 0.01, scaleY: 0.5 })] }, snapOf([swLayer(7, 0, 0, 100, 100)]))
		assert.deepEqual([tiny.changes.length, tiny.skipped], [0, ["L7: 31×512 is outside the switcher's 64–131070 px"]])
		const look = { layers: [lookLayer(7, { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 })] }
		const locked = windowsFromLook(look, snapOf([swLayer(7, 0, 0, 100, 100)], { pgmLocked: true }))
		assert.deepEqual([locked.changes.length, locked.skipped], [0, ['L7: PGM of Screen 1 is locked on the switcher']])
		assert.equal(windowsFromLook(look, snapOf([swLayer(7, 0, 0, 100, 100, { scene: 'pvw' })], { pgmLocked: true })).changes.length, 1, 'the lock is about PGM')
		for (const type of ['cut', 'bkg', 'mvr']) {
			assert.match(windowsFromLook(look, snapOf([swLayer(7, 0, 0, 100, 100, { type })])).skipped[0], /is not programmed from a look/)
		}
		assert.equal(windowsFromLook(look, snapOf([swLayer(7, 0, 0, 100, 100, { type: 'normal', cutFill: true })])).changes.length, 1)
	})

	it('a screen with its own origin: the look is screen-relative, the write is global', async () => {
		const layers = [swLayer(7, 0, 0, 100, 100)]
		const puts = []
		const reader = {
			read: async () => snapOf(layers.map((l) => ({ ...l })), { x: 4000, y: 100 }),
			put: async (p, body) => {
				puts.push([p, body])
				Object.assign(layers[0], { x: body[0].window.x - 4000, y: body[0].window.y - 100, width: body[0].window.width, height: body[0].window.height })
			},
		}
		const r = await driveLook({ layers: [lookLayer(7, { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 })] }, reader, { wait: async () => {} })
		assert.deepEqual(puts, [['/unico/v1/layers/window', [{ layerId: 7, window: { x: 5536, y: 356, width: 768, height: 512 } }]]])
		assert.deepEqual([r.sent, r.kept], [1, 1])
	})

	it('a source named on the placeholder: custom aspect, source, rectangle — in Studio\'s order — and read back', async () => {
		const layers = [swLayer(7, 1536, 256, 768, 512)]
		const puts = []
		const reader = {
			read: async () => snapOf(layers.map((l) => ({ ...l }))),
			put: async (p, body) => {
				puts.push([p, body])
				if (p.endsWith('/layers/source')) Object.assign(layers[0], { sourceId: body[0].source.general.sourceId, sourceType: body[0].source.general.sourceType })
			},
		}
		const fill = { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 } // the rectangle the layer already has
		const look = (source) => ({ layers: [lookLayer(7, fill, { source })] })
		const r = await driveLook(look({ id: 31, type: 2, connectorType: 8, name: 'Input 7' }), reader, { wait: async () => {} })
		assert.deepEqual(puts.map((x) => x[0].replace('/unico/v1/layers/', '')), ['aspect-ratio', 'source', 'window'])
		assert.deepEqual(puts[0][1], [{ layerId: 7, aspectRatio: 5, locked: 1 }])
		assert.deepEqual(puts[1][1], [{ layerId: 7, source: { general: { sourceId: 31, sourceType: 2, connectorType: 8 }, primary: { sourceId: 31, sourceType: 2 } } }])
		assert.deepEqual(puts[2][1], [{ layerId: 7, window: { x: 1536, y: 256, width: 768, height: 512 } }], 'the rectangle is re-asserted after routing')
		assert.deepEqual([r.sent, r.kept, r.skipped], [1, 1, []])
		puts.length = 0
		await driveLook(look({ id: 31, type: 2 }), reader)
		assert.equal(puts.length, 0, 'same source, same rectangle: nothing sent')
		const self = windowsFromLook(look({ id: 1, type: 3 }), snapOf(layers))
		assert.deepEqual(self.skipped, ['L7: a screen cannot show itself'])
	})

	it('driveLook: one PUT of the changed windows, read back', async () => {
		const reader = fakeReader([swLayer(7, 0, 0, 100, 100), swLayer(8, 5, 5, 50, 50)])
		const r = await driveLook({ layers: [lookLayer(7, { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 })] }, reader, { wait: async () => {} })
		assert.deepEqual(reader.puts, [['/unico/v1/layers/window', [{ layerId: 7, window: { x: 1536, y: 256, width: 768, height: 512 } }]]])
		assert.deepEqual(r, { sent: 1, kept: 1, skipped: [] })
		assert.deepEqual(await driveLook({ layers: [lookLayer(7, { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 })] }, reader), { sent: 0, kept: 0, skipped: [] }, 'second take: nothing to send')
	})

	it('a switcher that answers OK but keeps its own geometry is reported, not believed', async () => {
		const reader = fakeReader([swLayer(7, 0, 0, 100, 100)], { stubborn: true })
		const r = await driveLook({ layers: [lookLayer(7, { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 })] }, reader, { wait: async () => {} })
		assert.deepEqual([r.sent, r.kept, r.skipped], [1, 0, ['L7: the switcher did not keep the rectangle']])
	})

	it('take hook: nothing without the switch, nothing for a look without links, never throws', async () => {
		const scene = { name: 'Look', layers: [lookLayer(7, { x: 0.5, y: 0.25, scaleX: 0.25, scaleY: 0.5 })] }
		const reader = fakeReader([swLayer(7, 0, 0, 100, 100)])
		const logs = []
		const ctx = { log: (lvl, m) => logs.push([lvl, m]) }
		assert.equal(driveLookOnTake(scene, ctx, { settings: () => ({ host: '10.0.0.1', drive: false }), reader: () => reader }), null)
		assert.equal(driveLookOnTake({ layers: [{ fill: {} }] }, ctx, { settings: () => ({ host: '10.0.0.1', drive: true }), reader: () => reader }), null)
		assert.equal(reader.puts.length, 0)
		const r = await driveLookOnTake(scene, ctx, { settings: () => ({ host: '10.0.0.1', drive: true }), reader: () => reader, wait: async () => {} })
		assert.deepEqual([r.sent, r.kept, reader.puts.length], [1, 1, 1])
		assert.match(logs[0][1], /look "Look": 1\/1 switcher layer\(s\) moved/)
		const dead = { read: async () => { throw new Error('ECONNREFUSED') }, put: async () => {} }
		assert.equal(await driveLookOnTake(scene, ctx, { settings: () => ({ host: '10.0.0.1', drive: true }), reader: () => dead }), null)
		assert.match(logs.at(-1)[1], /the switcher was not driven: ECONNREFUSED/)
	})

	it('the switch is off by default, kept with the address, and never carried to a new address', () => {
		const storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo1038-')), 'pixelhue.json')
		const deps = { storePath }
		assert.deepEqual(readSettings(deps), { host: '', drive: false })
		handleSetConfig(JSON.stringify({ host: '10.0.0.1' }), deps)
		assert.deepEqual(readSettings(deps), { host: '10.0.0.1', drive: false })
		handleSetConfig(JSON.stringify({ drive: true }), deps)
		assert.deepEqual(readSettings(deps), { host: '10.0.0.1', drive: true })
		handleSetConfig(JSON.stringify({ host: '10.0.0.1' }), deps)
		assert.equal(readSettings(deps).drive, true, 're-saving the same address keeps it')
		handleSetConfig(JSON.stringify({ host: '10.0.0.2' }), deps)
		assert.equal(readSettings(deps).drive, false, 'another switcher has to be allowed again')
		fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
	})

	it('GET /api/pixelhue/sources: the switcher\'s sources, 409 without an address, 502 when it does not answer', async () => {
		const { handleSources } = require('../../src/api/routes-pixelhue')
		const storePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wo1038-')), 'pixelhue.json')
		assert.equal((await handleSources({ storePath })).status, 409)
		handleSetConfig(JSON.stringify({ host: '10.0.0.3' }), { storePath })
		const list = [{ id: 31, type: 2, name: 'Input 7', connected: true }]
		const ok = await handleSources({ storePath, createReader: (host) => ({ host, sources: async () => list }) })
		assert.deepEqual([ok.status, JSON.parse(ok.body).sources], [200, list])
		handleSetConfig(JSON.stringify({ host: '10.0.0.4' }), { storePath })
		const dead = await handleSources({ storePath, createReader: (host) => ({ host, sources: async () => { throw new Error('timeout') } }) })
		assert.equal(dead.status, 502)
		fs.rmSync(path.dirname(storePath), { recursive: true, force: true })
	})

	it('one hook in the take, program only', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-scene-take-look.js'), 'utf8')
		assert.match(src, /if \(target === 'program'\) require\('\.\.\/pixelhue\/pixelhue-look-drive'\)\.driveLookOnTake\(scene, ctx\)/)
	})
})
