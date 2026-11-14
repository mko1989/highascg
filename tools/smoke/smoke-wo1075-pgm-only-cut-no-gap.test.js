'use strict'
/**
 * WO-1075 — a normal CUT on a PGM-only screen must not clear the look on air before the new look's PLAY.
 * (The WO-160b sweep ran ahead of the LOADBG batch with an empty currentMap: ~180 ms of black on pgm2, box 14.11.)
 */
const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { handleSceneTake } = require('../../src/api/routes-scene-take')
const liveSceneState = require('../../src/state/live-scene-state')

function recordingAmcp() {
	const ev = []
	const rec = async (e) => {
		ev.push(e)
		await new Promise((r) => setImmediate(r))
		return { ok: true, data: '202 OK' }
	}
	const base = {
		_context: { config: { take_two_phase_batch: true, amcp_batch: false } },
		async batchSendChunked(lines, o) {
			const c = lines.map(String).filter(Boolean)
			if (c.length >= 2 && o && o.forceBatch) return rec({ t: 'batch', lines: c })
			for (const l of c) await rec({ t: 'send', line: l })
			return { ok: true }
		},
		mixerCommit: (ch) => rec({ t: 'send', line: `MIXER ${ch} COMMIT` }),
		mixerClear: (ch, l) => rec({ t: 'send', line: `MIXER ${ch}-${l} CLEAR` }),
		loadbg: (ch, l, clip) => rec({ t: 'send', line: `LOADBG ${ch}-${l} ${clip}` }),
		_send: (line) => rec({ t: 'send', line }),
	}
	base.batchSend = base.batchSendChunked
	const amcp = new Proxy(base, {
		get(o, k) {
			if (k in o) return o[k]
			if (typeof k !== 'string' || k === 'then') return undefined
			return (...a) => rec({ t: 'send', line: `${k.toUpperCase()} ${a.filter((x) => typeof x !== 'object').join(' ')}`.trim() })
		},
	})
	return { amcp, ev }
}

const PGM_ONLY = { screen_count: 1, screenDestinations: { version: 1, destinations: [{ id: 'd1', mode: 'pgm_only', mainScreenIndex: 0, videoMode: '1080p5000' }] } }
const look = (id, clips) => ({
	id,
	defaultTransition: { type: 'CUT' },
	layers: clips.map((value, i) => ({ layerNumber: 10 + i, source: { type: 'media', value } })),
})
function makeCtx(bank = 'a') {
	const { amcp, ev } = recordingAmcp()
	return { ctx: { amcp, config: PGM_ONLY, log() {}, _playbackMatrix: {}, programLayerBankByChannel: { 1: bank } }, ev }
}
const all = (ev) => ev.flatMap((e) => (e.t === 'batch' ? e.lines : [e.line]))
const take = (ctx, inc, extra = {}) => handleSceneTake(JSON.stringify({ channel: 1, sceneId: inc.id, incomingScene: inc, forceCut: true, previewExchange: false, ...extra }), ctx)

describe('WO-1075 — PGM-only cut', () => {
	beforeEach(async () => {
		liveSceneState.clearChannel?.(1)
		const on = look('L1', ['a.mov', 'b.mov'])
		await liveSceneState.setChannel(1, { sceneId: on.id, scene: on })
	})
	const idx = (lines, re) => lines.findIndex((l) => re.test(l))
	for (const [bank, on, next] of [['a', 10, 110], ['b', 110, 10]]) {
		it(`on bank ${bank.toUpperCase()}: the look on air is cleared only after the PLAY of the new look`, async () => {
			const { ctx, ev } = makeCtx(bank)
			const res = await take(ctx, look('L2', ['c.mov']))
			assert.equal(res.status, 200, res.body)
			const lines = all(ev)
			const play = idx(lines, new RegExp(`^PLAY 1-${next}$`))
			assert.ok(play >= 0, JSON.stringify(lines))
			for (const L of [on, on + 1]) {
				const stop = idx(lines, new RegExp(`^STOP 1-${L}$`))
				assert.ok(stop > play, `layer ${L} of the old look is stopped after the PLAY (stop ${stop}, play ${play})`)
				assert.ok(idx(lines, new RegExp(`^(CG|MIXER) 1-${L} CLEAR$`)) > play, `layer ${L} is not cleared before the PLAY`)
			}
			assert.equal(ctx.programLayerBankByChannel[1], bank === 'a' ? 'b' : 'a')
		})
	}

	it('a second cut right after: the first new look is again cleared only after the next PLAY', async () => {
		const { ctx, ev } = makeCtx('a')
		await take(ctx, look('L2', ['c.mov']))
		await liveSceneState.setChannel(1, { sceneId: 'L2', scene: look('L2', ['c.mov']) })
		ev.length = 0
		const res = await take(ctx, look('L3', ['d.mov']))
		assert.equal(res.status, 200, res.body)
		const lines = all(ev)
		assert.ok(idx(lines, /^STOP 1-110$/) > idx(lines, /^PLAY 1-10$/), JSON.stringify(lines))
		assert.ok(idx(lines, /^PLAY 1-10$/) >= 0)
	})

	it('a take with a fade keeps the old order (sweep before the LOADBG) — only cuts changed', async () => {
		const { ctx, ev } = makeCtx('a')
		const inc = { ...look('L2', ['c.mov']), defaultTransition: { type: 'MIX', duration: 25 } }
		const res = await take(ctx, inc, { forceCut: false })
		assert.equal(res.status, 200, res.body)
		const lines = all(ev)
		assert.ok(idx(lines, /^STOP 1-10$/) >= 0 && idx(lines, /^STOP 1-10$/) < idx(lines, /^PLAY 1-110$/), JSON.stringify(lines))
	})

	it('source: the deferral is limited to PGM-only cuts and runs after the phase-B abort check', () => {
		const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')
		assert.match(src, /opts\.pgmOnly && fadeDur === 0 && !isMergeTransition && !banklessTake/)
		assert.ok(src.indexOf('if (sweepAfterPlay.length > 0)') > src.indexOf('fadeClockRef.phaseBError'))
	})
})
