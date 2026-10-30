'use strict'

/**
 * WO-860: a look of only template CG (lower thirds…) is an overlay look — taken over the on-air look on its 700+ CG
 * host without touching the look band or PGM's live look; PRV staging holds lower thirds (no auto-out); a normal PGM
 * take leaves PGM overlay hosts alone unless it declares the same host.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

process.env.NODE_TEST_CONTEXT = process.env.NODE_TEST_CONTEXT || `wo860-${process.pid}`

const O = require('../../src/engine/overlay-look')

const lt = (n, extra = {}) => ({
	layerNumber: n,
	source: { type: 'template', value: 'LOWER-THIRDS/LT-CLASSIC-BOX' },
	fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
	cgData: { data: { title: 'A', displayDurationSec: '10' }, style: { displayDurationSec: 10 }, displayDurationSec: 10 },
	...extra,
})
const media = (n) => ({ layerNumber: n, source: { type: 'media', value: 'clip.mov' }, fill: { x: 0, y: 0, scaleX: 1, scaleY: 1 } })
const shader = (n) => ({ layerNumber: n, source: { type: 'template', value: 'SHADERS/SH-SA-PLASMA' } })

function mockAmcp() {
	const log = []
	return { log, async _send(line) { log.push(line); return {} }, async mixerCommit() {} }
}

describe('WO-860 overlay looks', () => {
	it('only template CG on the overlay band makes an overlay look', () => {
		assert.equal(O.isOverlayLook({ layers: [lt(10)] }), true)
		assert.equal(O.isOverlayLook({ layers: [lt(10), lt(11)] }), true)
		assert.equal(O.isOverlayLook({ layers: [lt(10), media(11)] }), false, 'a video source makes it a normal look')
		assert.equal(O.isOverlayLook({ layers: [shader(10)] }), false, 'shaders composite on the look band (WO-322)')
		assert.equal(O.isOverlayLook({ layers: [] }), false)
		assert.equal(O.isOverlayLook({ audioOnlyLook: true, layers: [lt(10)] }), false)
		assert.equal(O.isOverlayLook({ layers: [lt(10), { layerNumber: 11, source: { type: 'media', value: '' } }] }), true, 'an empty layer does not count')
	})

	it('holdLowerThirdCgData zeroes every auto-out timer of a lower third only', () => {
		const held = JSON.parse(O.holdLowerThirdCgData(JSON.stringify(lt(10).cgData), 'lower-thirds/lt-classic-box'))
		assert.equal(held.displayDurationSec, 0)
		assert.equal(held.style.displayDurationSec, 0)
		assert.equal(held.data.displayDurationSec, 0)
		const flat = JSON.parse(O.holdLowerThirdCgData('{"title":"x"}', 'lower-thirds/lt-slide-bar'))
		assert.equal(flat.style.displayDurationSec, 0, 'the engine default (10 s) is held too')
		assert.equal(O.holdLowerThirdCgData('{"a":1}', 'my-template'), '{"a":1}', 'other templates untouched')
		assert.equal(O.holdLowerThirdCgData('not json', 'lower-thirds/x'), 'not json')
	})

	it('PGM: plays on the CG host with the look transition fade; PRV: cut and held', async () => {
		const scene = { id: 'o1', layers: [lt(10)], defaultTransition: { type: 'MIX', duration: 12, tween: 'linear' } }
		const pgm = await O.buildOverlayLookLines({ channel: 1, scene, self: {} })
		assert.deepEqual(pgm.hosts, [700])
		assert.ok(pgm.lines.every((l) => /^(CG|MIXER) 1-700 /.test(l)), `only the CG host: ${pgm.lines.join(' | ')}`)
		assert.ok(pgm.lines.includes('MIXER 1-700 OPACITY 1 12 linear'), 'fades in with the look transition')
		assert.ok(pgm.lines.some((l) => /^CG 1-700 ADD 0 .* 1 /.test(l)))
		assert.ok(!pgm.lines.join('\n').includes('displayDurationSec\\":0'), 'PGM keeps the auto-out')
		const prv = await O.buildOverlayLookLines({ channel: 2, scene, self: {}, preview: true })
		assert.ok(!prv.lines.some((l) => /OPACITY 1 \d+/.test(l) && !/OPACITY 1 0/.test(l)), 'PRV staging cuts')
		assert.ok(prv.lines.find((l) => l.startsWith('CG 2-700 ADD')).includes('displayDurationSec\\":0'), 'PRV holds')
	})

	it('handleSceneTake: PGM overlay leaves scene.live alone and is protected; PRV overlay becomes PRV’s look', async () => {
		const liveSceneState = require('../../src/state/live-scene-state')
		const { handleSceneTake } = require('../../src/api/routes-scene-take')
		const amcp = mockAmcp()
		const ctx = { amcp, config: { screen_count: 1, screen_1_mode: '1920x1080p25' }, _wsBroadcast: () => {}, log: () => {} }
		const before = JSON.stringify(liveSceneState.getChannel(1) ?? null)
		const scene = { id: 'o2', layers: [lt(10)], defaultTransition: { type: 'CUT' } }
		const res = await handleSceneTake({ channel: 1, incomingScene: scene }, ctx)
		assert.equal(res.status, 200, JSON.stringify(res.body))
		assert.ok(amcp.log.length > 0 && amcp.log.every((l) => /^(CG|MIXER) 1-700 /.test(l)), amcp.log.join(' | '))
		assert.equal(JSON.stringify(liveSceneState.getChannel(1) ?? null), before, 'PGM live look untouched')
		assert.ok(O.pgmOverlayHosts(1).has(700))
		O.releasePgmOverlayHosts(1, [700])
		assert.equal(O.pgmOverlayHosts(1).has(700), false, 'a normal look declaring the host takes it over')

		amcp.log.length = 0
		const r2 = await handleSceneTake({ channel: 1, target: 'preview', incomingScene: scene }, ctx)
		assert.equal(r2.status, 200, JSON.stringify(r2.body))
		assert.ok(amcp.log.every((l) => /^(CG|MIXER) 2-700 /.test(l)), amcp.log.join(' | '))
		assert.equal(liveSceneState.getChannel(2)?.sceneId, 'o2')
		assert.equal(O.pgmOverlayHosts(2).size, 0, 'PRV overlays are not protected — the next staging replaces them')
		await liveSceneState.clearChannel?.(2)
	})

	it('the take pipeline wires the protection and the PRV hold', () => {
		const src = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8')
		const lbg = src('src/engine/scene-take-lbg.js')
		assert.match(lbg, /releasePgmOverlayHosts\(channel, incomingTemplateHostLayers, self\)/)
		assert.match(lbg, /for \(const h of pgmOverlayHosts\(channel\)\) incomingTemplateHostLayers\.add\(h\)/)
		assert.match(lbg, /holdTemplates: banklessTake/)
		assert.match(src('src/engine/scene-take-lbg-jobs.js'), /if \(templateCg && holdTemplates\) templateCg\.data = holdLowerThirdCgData/)
		assert.match(src('src/engine/scene-template-cg.js'), /if \(pgmOverlayHosts\(n\)\.has\(host\)\) continue/)
		assert.match(src('src/api/routes-scene-take.js'), /if \(isOverlayLook\(b\.incomingScene, ctx\)\) return handleOverlayLookTake/)
	})
})
