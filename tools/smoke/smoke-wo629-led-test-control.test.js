'use strict'

/**
 * WO-629 — LED test card settings + master switch live in node (were web localStorage): normalised settings,
 * target planning, the per-channel bodies, serialised apply, and the routes.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const ctl = require('../../src/engine/led-test-card-control')
const routes = require('../../src/api/routes-led-test-control')

const CM = { programChannels: [1, 3], multiviewCh: 5 }

describe('WO-629 settings', () => {
	it('defaults match the web modal', () => {
		const s = ctl.normalizeSettings(undefined)
		assert.equal(s.cols, 20)
		assert.equal(s.pattern, 'grid-white')
		assert.equal(s.showCircle, true)
		assert.equal(s.charCount, 3)
	})

	it('clamps, drops junk channel keys and unknown patterns', () => {
		const s = ctl.normalizeSettings({
			cols: 9999,
			charCount: 0,
			builderSpeed: 'x',
			pattern: 'nope',
			showCross: 'false',
			gridByChannel: { 2: true, x: true, 3: false },
		})
		assert.equal(s.cols, 256)
		assert.equal(s.charCount, 1)
		assert.equal(s.builderSpeed, 3)
		assert.equal(s.pattern, 'grid-white')
		assert.equal(s.showCross, false)
		assert.deepEqual(s.gridByChannel, { 2: true })
	})

	it('the bunny builder needs some full-grid channel (WO-588)', () => {
		assert.equal(ctl.normalizeSettings({ pattern: 'led-builder' }).pattern, 'grid-white')
		assert.equal(ctl.normalizeSettings({ pattern: 'led-builder', gridByChannel: { 1: true } }).pattern, 'led-builder')
	})

	it('save merges into the stored record (test-isolated persistence)', () => {
		ctl.saveSettings({ cols: 7 })
		const s = ctl.saveSettings({ rows: 4 })
		assert.equal(s.cols, 7)
		assert.equal(s.rows, 4)
		assert.deepEqual(ctl.getSettings(), s)
	})
})

describe('WO-629 targets and bodies', () => {
	const none = ctl.normalizeSettings({})
	const picked = ctl.normalizeSettings({ channelsEnabled: { 3: true }, gridByChannel: { 2: true } })

	it('on: the picked channels; none picked → every program channel', () => {
		assert.deepEqual(ctl.planTargets(picked, CM, true), [2, 3])
		assert.deepEqual(ctl.planTargets(none, CM, true), [1, 3])
	})

	it('off: program + multiview + picked, so layer 999 is left nowhere', () => {
		assert.deepEqual(ctl.planTargets(picked, CM, false), [1, 3, 5, 2])
	})

	it('explicit channels win', () => {
		assert.deepEqual(ctl.planTargets(picked, CM, true, ['4', 4]), [4])
	})

	it("body: settings + channel + that channel's grid flag, no client connector label", () => {
		const b = ctl.cardBody(picked, 2, true, false)
		assert.equal(b.showLedGrid, true)
		assert.equal(ctl.cardBody(picked, 3, true, false).showLedGrid, false)
		assert.equal(b.channel, 2)
		assert.equal('connectorLabel' in b, false)
		assert.equal('channelsEnabled' in b, false)
	})
})

describe('WO-629 apply', () => {
	const ctx = { getState: () => ({ channelMap: CM }) }

	it('switches every target; only the last body of a master-off carries masterOff', async () => {
		ctl.saveSettings({ channelsEnabled: {}, gridByChannel: {} })
		const seen = []
		const post = async (_p, body) => (seen.push(body), { status: 200, body: '{}' })
		const r = await ctl.applyCard(ctx, false, { post })
		assert.equal(r.ok, true)
		assert.deepEqual(r.targets, [1, 3, 5])
		assert.deepEqual(
			seen.map((b) => b.masterOff),
			[false, false, true]
		)
	})

	it('on: ok while at least one channel took it; failures carry the reason', async () => {
		const post = async (_p, b) =>
			b.channel === 1 ? { status: 502, body: JSON.stringify({ error: 'boom' }) } : { status: 200, body: '{}' }
		const r = await ctl.applyCard(ctx, true, { post })
		assert.equal(r.ok, true)
		assert.deepEqual(r.failures, [{ channel: 1, error: 'boom' }])
		const all = await ctl.applyCard(ctx, true, { post: async () => ({ status: 502, body: '{}' }) })
		assert.equal(all.ok, false)
	})

	it('overlapping toggles run one after another', async () => {
		const log = []
		const slow = (tag) => async (_p, b) => {
			log.push(`${tag}+${b.channel}`)
			await new Promise((r) => setTimeout(r, 5))
			log.push(`${tag}-${b.channel}`)
			return { status: 200, body: '{}' }
		}
		await Promise.all([
			ctl.applyCard(ctx, true, { post: slow('a'), channels: [1] }),
			ctl.applyCard(ctx, false, { post: slow('b'), channels: [1] }),
		])
		assert.deepEqual(log, ['a+1', 'a-1', 'b+1', 'b-1'])
	})

	it('channel toggle remembers it; switching the last one off turns the master off', async () => {
		const seen = []
		const post = async (_p, b) => (seen.push(b), { status: 200, body: '{}' })
		await ctl.setChannel(ctx, 3, true, { post })
		assert.deepEqual(ctl.getSettings().channelsEnabled, { 3: true })
		await ctl.setChannel(ctx, 3, false, { post })
		assert.deepEqual(ctl.getSettings().channelsEnabled, {})
		assert.deepEqual(
			seen.map((b) => [b.channel, b.enabled, b.masterOff]),
			[
				[3, true, false],
				[3, false, true],
			]
		)
	})
})

describe('WO-629 routes', () => {
	it('GET: settings, active, patterns, channel rows', () => {
		const st = {
			channelMap: { programChannels: [1] },
			configComparison: {
				serverChannels: [
					{ index: 2, videoMode: '1080p5000' },
					{ index: 1, hasScreen: true, hasDecklinkOutput: true },
				],
			},
		}
		const body = JSON.parse(routes.handleGet({ getState: () => st, _ledTestPatternActive: true }).body)
		assert.equal(body.active, true)
		assert.equal(body.patterns[0].id, 'grid-white')
		assert.deepEqual(body.channels, [
			{ index: 1, program: true, videoMode: '', outputs: 'Screen · DeckLink' },
			{ index: 2, program: false, videoMode: '1080p5000', outputs: 'no screen / DeckLink' },
		])
	})

	it('POST: settings saves without Caspar; master/channel need it; unknown op 404', async () => {
		assert.equal((await routes.handlePost('settings', { cols: 5 }, {})).status, 200)
		assert.equal(ctl.getSettings().cols, 5)
		assert.equal((await routes.handlePost('master', { enabled: true }, {})).status, 503)
		assert.equal((await routes.handlePost('channel', { channel: 'x', enabled: true }, { amcp: {} })).status, 400)
		assert.equal((await routes.handlePost('wat', {}, {})).status, 404)
	})

	it('router: the no-Caspar settings/:op routes exist and the dead Caspar-only /api/led-test-card/* wildcard stays gone', () => {
		// WO-831: the wildcard was shadowed by /:op and its handler only accepts the bare path (served by router-dispatch's legacy chain).
		const src = require('node:fs').readFileSync(require.resolve('../../src/api/router.js'), 'utf8')
		assert.ok(src.indexOf("routes.get('/api/led-test-card/settings'") > 0)
		assert.ok(src.indexOf("routes.post('/api/led-test-card/:op'") > 0)
		assert.equal(src.indexOf("routes.post('/api/led-test-card/*'"), -1)
	})
})
