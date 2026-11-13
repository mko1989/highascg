'use strict'

/**
 * WO-1062 — a masked PixelHue layer keeps its full `window` on the switcher and only hides its edges; the reader
 * reports what the layer SHOWS (x / y / width / height / fill), with the switcher's own rectangle in `window` and the
 * cut in `mask`. A look that drives the switcher still writes the full window. Layer shape taken from the box's P80
 * (13.11: 1189×669 window, 186 px masked left and right).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { normalize } = require('../../src/pixelhue/pixelhue-read')
const { windowsFromLook } = require('../../src/pixelhue/pixelhue-look-drive')

const screens = { code: 0, data: { list: [{ screenId: 5, enable: 1, pgmEdit: 1, general: { name: 'LED' }, mosaic: { window: { x: -551, y: 437, width: 3072, height: 1024 } } }] } }
const mask = (enable, left, right, top = 0, bottom = 0) => ({ enable, left, leftRatio: Math.round((left / 1189) * 1e5), right, rightRatio: Math.round((right / 1189) * 1e5), top, topRatio: 0, buttom: bottom, buttomRatio: 0 })
const raw = (m) => ({
	layerId: 88145924,
	general: { name: 'Layer 4' },
	layerIdObj: { attachScreenId: 5, sceneType: 2, type: 2 },
	enable: 1,
	opacity: 100,
	zorder: 4,
	window: { width: 1189, height: 669, x: -493, y: 568 },
	mask: m,
	source: { general: { sourceName: 'In', sourceType: 2, sourceId: 5 } },
})
const read = (m) => normalize(screens, { code: 0, data: { list: [raw(m)] } })
const one = (m) => read(m)[0].layers[0]

describe('WO-1062 PixelHue mask in the layer read', () => {
	it('a masked layer reports the part it shows, screen-relative, with the full window and the cut alongside', () => {
		const l = one(mask(1, 186, 186))
		assert.deepEqual([l.x, l.y, l.width, l.height], [58 + 186, 131, 1189 - 372, 669])
		assert.deepEqual(l.window, { x: 58, y: 131, width: 1189, height: 669 })
		assert.deepEqual(l.mask, { left: 186, right: 186, top: 0, bottom: 0 })
		assert.equal(l.fill.scaleX, Math.round((817 / 3072) * 1e6) / 1e6, 'the fill is the shown rectangle')
		assert.equal(l.fill.x, Math.round((244 / 3072) * 1e6) / 1e6)
	})
	it('all four sides', () => {
		const l = one(mask(1, 10, 20, 30, 40))
		assert.deepEqual([l.x, l.y, l.width, l.height], [68, 161, 1159, 599])
	})
	it('a disabled or empty mask changes nothing and adds no fields', () => {
		for (const m of [mask(0, 186, 186), mask(1, 0, 0), undefined]) {
			const l = one(m)
			assert.deepEqual([l.x, l.y, l.width, l.height], [58, 131, 1189, 669])
			assert.equal('mask' in l, false)
			assert.equal('window' in l, false)
		}
	})
	it('ratios stand in when the pixel fields are missing; a mask hiding everything is ignored', () => {
		const m = mask(1, 186, 186)
		delete m.left
		delete m.right
		assert.equal(one(m).width, 817)
		assert.equal(one(mask(1, 600, 600)).width, 1189)
	})
})

describe('WO-1062 a look driving a masked switcher layer', () => {
	const snap = () => ({ screens: read(mask(1, 186, 186)) })
	const look = (fill) => ({ layers: [{ fill, pixelhue: { layerId: 88145924, name: 'Layer 4' } }] })
	it('the rectangle just read asks for no change', () => {
		const s = snap()
		assert.deepEqual(windowsFromLook(look(s.screens[0].layers[0].fill), s).changes, [])
	})
	it('moved: the full window moves with it, same size', () => {
		const s = snap()
		const f = s.screens[0].layers[0].fill
		const c = windowsFromLook(look({ ...f, x: f.x + 100 / 3072 }), s).changes
		assert.deepEqual(c[0].window, { x: 158, y: 131, width: 1189, height: 669 })
	})
	it('resized: the window scales so the shown part is what the look asks', () => {
		const s = snap()
		const f = s.screens[0].layers[0].fill
		const c = windowsFromLook(look({ ...f, scaleX: f.scaleX * 2, scaleY: f.scaleY * 2 }), s).changes
		assert.deepEqual(c[0].window, { x: 244 - 372, y: 131, width: 2378, height: 1338 })
	})
})
