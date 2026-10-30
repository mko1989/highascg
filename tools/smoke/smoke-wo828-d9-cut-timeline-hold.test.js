'use strict'

/**
 * WO-828 D9 — a CUT from a normal look into a timeline look showed 3 black PGM frames: the outgoing look was cleared in
 * the same millisecond as the timeline's `PLAY 1-210` (no LOADBG ahead), before its first frame decoded. Fix: on a CUT
 * over an on-air look, `startSceneTimelineLayer` waits for the timeline transport ack + 5 channel frames before the take
 * goes on to the teardown (scene-take-lbg-jobs.js `cutHoldMs`, timeline-take.js `holdForTransportAcks`).
 *
 * Drives the real POST /api/scene/take handler against a recording AMCP stub (as smoke-wo814).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { handleSceneTake } = require('../../src/api/routes-scene-take')
const liveSceneState = require('../../src/state/live-scene-state')
const { TimelineEngine } = require('../../src/engine/timeline-engine')

const PLAY_ACK_MS = 60

function recordingAmcp() {
	const ev = []
	const t0 = Date.now()
	const rec = async (e) => {
		e.at = Date.now() - t0
		ev.push(e)
		// The timeline's PLAY is acked late (a clip open); everything else on the next turn.
		const slow = (e.lines || [e.line]).some((l) => /^PLAY \d+-21\d /.test(l))
		await new Promise((r) => (slow ? setTimeout(r, PLAY_ACK_MS) : setImmediate(r)))
		if (slow) e.ackAt = Date.now() - t0
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
		raw: (line) => rec({ t: 'send', line }),
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

const flat = (ev) => ev.map((e) => (e.t === 'batch' ? 'B| ' + e.lines.join(' ; ') : e.line))
const lay = (n, v) => ({ layerNumber: n, source: { type: 'media', value: v } })
const CUT = { type: 'CUT', duration: 0, tween: 'linear' }
const MIX = { type: 'MIX', duration: 12, tween: 'linear' }
const look = (id, files, t) => ({ id, defaultTransition: t, layers: files.map((f, i) => lay(10 + i, f)) })

async function seed(map) {
	for (const ch of [1, 2, 3, 4]) liveSceneState.clearChannel?.(ch)
	for (const [ch, scene] of Object.entries(map)) await liveSceneState.setChannel(Number(ch), { sceneId: scene.id, scene })
}

function makeCtx(amcp, withTimeline) {
	const ctx = { amcp, config: { screen_count: 1 }, log: () => {}, _playbackMatrix: {}, programLayerBankByChannel: {} }
	if (withTimeline) {
		ctx.timelineEngine = new TimelineEngine(ctx)
		ctx.timelineEngine.create({
			id: 'tl1',
			duration: 2000,
			fps: 25,
			layers: [{ id: 'l1', name: 'L1', clips: [{ id: 'c1', startTime: 0, duration: 2000, source: { value: 'a.mov' } }] }],
		})
	}
	return ctx
}

async function take(ctx, body) {
	const res = await handleSceneTake(JSON.stringify(body), ctx)
	assert.equal(res.status, 200, res.body)
}

/* Captured from the pre-D9 tree (HEAD 2346492d) with this same stub: a normal → normal CUT is byte-identical. */
const NORMAL_CUT_GOLDEN = [
	'B| MIXER 1-110 CLEAR ; LOADBG 1-110 N1 IN 0 SEEK 0 ; MIXER 1-111 CLEAR ; LOADBG 1-111 N2 IN 0 SEEK 0 ; MIXER 1-110 FILL 0 0 1 1 0 ; MIXER 1-110 CLIP 0 0 1 1 0 DEFER ; MIXER 1-110 ANCHOR 0 0 0 ; MIXER 1-110 ROTATION 0 0 DEFER ; MIXER 1-110 OPACITY 1 0 DEFER ; MIXER 1-110 VOLUME 1 DEFER ; MIXER 1-111 FILL 0 0 1 1 0 ; MIXER 1-111 CLIP 0 0 1 1 0 DEFER ; MIXER 1-111 ANCHOR 0 0 0 ; MIXER 1-111 ROTATION 0 0 DEFER ; MIXER 1-111 OPACITY 1 0 DEFER ; MIXER 1-111 VOLUME 1 DEFER',
	'MIXER 1 COMMIT',
	'B| PLAY 1-110 ; PLAY 1-111',
	'MIXER 1 COMMIT',
	'CLEAR 2',
	'CG 1-10 CLEAR',
	'MIXER 2 COMMIT',
	'STOP 1-10',
	'B| MIXER 2-10 CLEAR ; LOADBG 2-10 O1 IN 0 SEEK 0 ; MIXER 2-11 CLEAR ; LOADBG 2-11 O2 IN 0 SEEK 0 ; MIXER 2-10 FILL 0 0 1 1 0 ; MIXER 2-10 CLIP 0 0 1 1 0 DEFER ; MIXER 2-10 ANCHOR 0 0 0 ; MIXER 2-10 ROTATION 0 0 DEFER ; MIXER 2-10 OPACITY 1 0 DEFER ; MIXER 2-10 VOLUME 1 DEFER ; MIXER 2-11 FILL 0 0 1 1 0 ; MIXER 2-11 CLIP 0 0 1 1 0 DEFER ; MIXER 2-11 ANCHOR 0 0 0 ; MIXER 2-11 ROTATION 0 0 DEFER ; MIXER 2-11 OPACITY 1 0 DEFER ; MIXER 2-11 VOLUME 1 DEFER',
	'MIXER 1-10 CLEAR',
	'CG 1-11 CLEAR',
	'STOP 1-11',
	'MIXER 1-11 CLEAR',
	'MIXER 1 COMMIT',
	'MIXER 2 COMMIT',
	'B| PLAY 2-10 ; PLAY 2-11',
	'MIXER 2 COMMIT',
]

test('D9: normal → normal CUT (forceCut) is byte-identical to the pre-D9 wire', async () => {
	const { amcp, ev } = recordingAmcp()
	const OLD = look('old', ['o1.mov', 'o2.mov'], MIX)
	const NEW = look('new', ['n1.mov', 'n2.mov'], MIX)
	await seed({ 1: OLD, 2: NEW })
	await take(makeCtx(amcp, false), { channel: 1, incomingScene: NEW, forceCut: true })
	assert.deepEqual(flat(ev), NORMAL_CUT_GOLDEN)
})

test('D9: normal → normal CUT (look transition CUT) is byte-identical too — also with a timeline engine present', async () => {
	const { amcp, ev } = recordingAmcp()
	const OLD = look('old', ['o1.mov', 'o2.mov'], CUT)
	const NEW = look('new', ['n1.mov', 'n2.mov'], CUT)
	await seed({ 1: OLD, 2: NEW })
	await take(makeCtx(amcp, true), { channel: 1, incomingScene: NEW })
	assert.deepEqual(flat(ev), NORMAL_CUT_GOLDEN)
})

test('D9: normal → timeline look CUT holds the outgoing look until the timeline PLAY is acked + 5 frames', async () => {
	const { amcp, ev } = recordingAmcp()
	const OLD = look('old', ['o1.mov'], MIX)
	const TL = { id: 'tl', defaultTransition: CUT, layers: [{ layerNumber: 10, loop: true, source: { type: 'timeline', value: 'tl1' } }] }
	await seed({ 1: OLD, 2: TL })
	const ctx = makeCtx(amcp, true)
	await take(ctx, { channel: 1, incomingScene: TL, framerate: 50 })
	ctx.timelineEngine.stop('tl1')
	const play = ev.find((e) => (e.lines || [e.line]).some((l) => /^PLAY 1-210 /.test(l)))
	assert.ok(play && play.ackAt != null, `timeline PLAY sent and acked: ${JSON.stringify(flat(ev))}`)
	const exitIdx = ev.findIndex((e) => (e.lines || [e.line]).some((l) => /^(STOP|CG) 1-10\b/.test(l)))
	assert.ok(exitIdx > ev.indexOf(play), `outgoing look cleared after the timeline PLAY: ${JSON.stringify(flat(ev))}`)
	const exitAt = ev[exitIdx].at
	assert.ok(exitAt >= play.ackAt + 95, `held for ack (${play.ackAt} ms) + 5 frames at 50 fps; cleared at ${exitAt} ms`)
	assert.ok(!flat(ev).some((l) => /^STOP 1-10\b/.test(l) && ev.findIndex((e) => e.line === l) < ev.indexOf(play)), 'nothing stopped before the PLAY')
})

test('D9: the hold is opt-in — startSceneTimelineLayer waits only when cutHoldMs > 0, and never on a fade take', async () => {
	const { startSceneTimelineLayer } = require('../../src/engine/timeline-take.js')
	const timeIt = async (opts) => {
		const { amcp } = recordingAmcp()
		const ctx = makeCtx(amcp, true)
		const t = Date.now()
		await startSceneTimelineLayer(ctx, amcp, 1, { source: { value: 'tl1' } }, { screenIdx: 0, ...opts })
		const ms = Date.now() - t
		ctx.timelineEngine.stop('tl1')
		return ms
	}
	assert.ok((await timeIt({ fadeDur: 0 })) < PLAY_ACK_MS - 20, 'CUT without cutHoldMs returns before the ack')
	assert.ok((await timeIt({ fadeDur: 0, cutHoldMs: 40 })) >= PLAY_ACK_MS + 35, 'CUT with cutHoldMs waits ack + margin')
	assert.ok((await timeIt({ fadeDur: 25, cutHoldMs: 40 })) < PLAY_ACK_MS - 20, 'a fade take ignores cutHoldMs')
})

test('D9: scene-take-lbg-jobs.js asks for the hold only on a non-merge CUT over an on-air look', () => {
	const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../src/engine/scene-take-lbg-jobs.js'), 'utf8')
	assert.match(src, /const cutHoldMs = fadeDur === 0 && !isMergeTransition && currentMap\.size > 0 \? 5000 \//)
})
