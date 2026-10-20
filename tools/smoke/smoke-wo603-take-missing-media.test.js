'use strict'

/**
 * WO-603 slice 9 — the take reply names the look's missing plain media (web warnMissingMediaOnTake, now decided in
 * node so the Godot client and the web warn from one rule). Timeline / route / template sources are never media
 * (WO-560); a playlist item counts like the source.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { buildMediaIndex, missingMediaInScene } = require('../../src/media/media-exists')
const { missingMediaField } = require('../../src/api/media-index')

const ROOT = path.join(__dirname, '../..')
const index = buildMediaIndex([{ id: 'AMB' }, { id: 'clips/intro' }])
const layer = (type, value, playlist) => ({ source: { type, value }, ...(playlist ? { playlist } : {}) })

describe('WO-603 missingMediaInScene (server)', () => {
	it('lists missing sources + playlist items once; known media, routes and timelines never count', () => {
		const scene = {
			layers: [
				layer('media', 'AMB'),
				layer('media', 'gone_clip', [{ value: 'clips/intro' }, { value: 'also_gone' }, { value: 'gone_clip' }]),
				layer('timeline', 'tmsro89fsecg'),
				layer('route', 'route://9'),
				layer('template', 'lower_third'),
			],
		}
		assert.deepEqual(missingMediaInScene(scene, index), ['gone_clip', 'also_gone'])
	})

	it('no media list yet → nothing is called missing', () => {
		assert.deepEqual(missingMediaInScene({ layers: [layer('media', 'x')] }, buildMediaIndex([])), [])
	})
})

describe('WO-603 take reply carries missingMedia', () => {
	it('missingMediaField reads the live catalog (CLS state); all found → no field', () => {
		const ctx = { state: { getState: () => ({ media: [{ id: 'AMB' }] }) } }
		assert.deepEqual(missingMediaField(ctx, { layers: [layer('media', 'amb.mov')] }), {})
		assert.deepEqual(missingMediaField(ctx, { layers: [layer('media', 'wo603_nope_zz')] }), {
			missingMedia: ['wo603_nope_zz'],
		})
	})

	it('routes-scene-take spreads it into the 200 body', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/api/routes-scene-take.js'), 'utf8')
		assert.match(src, /\.\.\.missingMediaField\(ctx, b\.incomingScene\),/)
	})
})
