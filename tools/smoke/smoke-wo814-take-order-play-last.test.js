'use strict'

/**
 * WO-814 (owner 29.10): "the commands need to be … sent as batch..commit commands in a right sequence where play
 * (multiple channels layers in most cases) is the last one. also there is a wrong path for playing a look, where it
 * first gets sent to prv then to pgm … we only need the look that was on the screen pre transition gets into prv after
 * the pgm take is settled."
 *
 * Drives the real POST /api/scene/take handler (PGM 1 / PRV 2, and two screens PGM 1+3 / PRV 2+4) against a recording
 * AMCP stub and asserts the wire order: the incoming look goes straight to PGM (one LOADBG batch, then one PLAY batch
 * whose last lines are the PLAYs), nothing reaches PRV before the PGM PLAY batch, and the PRV copy of the previous PGM
 * look follows the PGM commit.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const { handleSceneTake } = require('../../src/api/routes-scene-take')
const liveSceneState = require('../../src/state/live-scene-state')
const { playLinesLast } = require('../../src/engine/scene-route-deps')

function recordingAmcp(twoPhase = true) {
	const ev = []
	const rec = async (e) => {
		ev.push(e)
		await new Promise((r) => setImmediate(r))
		return { ok: true, data: '202 OK' }
	}
	const base = {
		_context: { config: { take_two_phase_batch: twoPhase, amcp_batch: false } },
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

const lay = (n, v) => ({ layerNumber: n, source: { type: 'media', value: v } })
const MIX = { type: 'MIX', duration: 12, tween: 'linear' }
const look = (id, files) => ({ id, defaultTransition: MIX, layers: files.map((f, i) => lay(10 + i, f)) })
const linesOf = (e) => (e.t === 'batch' ? e.lines : [e.line])
const onCh = (ch) => (l) => new RegExp(`^(\\w+) ${ch}(-|\\s|$)`).test(l) || new RegExp(`^MIXER ${ch} COMMIT$`).test(l)
const idx = (ev, pred) => ev.findIndex((e) => linesOf(e).some(pred))

async function take(ctx, body) {
	const res = await handleSceneTake(JSON.stringify(body), ctx)
	assert.equal(res.status, 200, res.body)
}

function makeCtx(amcp, screens = 1) {
	return { amcp, config: { screen_count: screens }, log: () => {}, _playbackMatrix: {}, programLayerBankByChannel: {} }
}

const OLD = look('old', ['o1.mov', 'o2.mov', 'o3.mov'])
const NEW = look('new', ['n1.mov', 'n2.mov', 'n3.mov'])

async function seed(map) {
	for (const ch of [1, 2, 3, 4]) liveSceneState.clearChannel?.(ch)
	for (const [ch, scene] of Object.entries(map)) await liveSceneState.setChannel(Number(ch), { sceneId: scene.id, scene })
}

/** The PGM take of one screen: one LOADBG batch, one PLAY batch with PLAYs last, then PRV. */
function assertScreenOrder(ev, pgm, prv) {
	const pgmBatches = ev.filter((e) => e.t === 'batch' && e.lines.every(onCh(pgm)))
	const loadBatches = pgmBatches.filter((b) => b.lines.some((l) => /^LOADBG /.test(l)))
	assert.equal(loadBatches.length, 1, `one BEGIN…COMMIT with every PGM LOADBG: ${JSON.stringify(ev)}`)
	assert.equal(loadBatches[0].lines.filter((l) => l.startsWith(`LOADBG ${pgm}-`)).length, 3)
	assert.ok(!loadBatches[0].lines.some((l) => /^PLAY /.test(l)), 'no PLAY in the LOADBG phase')
	const playEv = ev.filter((e) => linesOf(e).some((l) => l.startsWith(`PLAY ${pgm}-`)))
	assert.equal(playEv.length, 1, 'every PGM PLAY in ONE batch')
	assert.equal(playEv[0].t, 'batch')
	const pl = playEv[0].lines
	const firstPlay = pl.findIndex((l) => /^PLAY /.test(l))
	assert.ok(pl.slice(firstPlay).every((l) => /^PLAY /.test(l)), `PLAY lines are the last of the batch: ${JSON.stringify(pl)}`)
	assert.equal(pl.filter((l) => l.startsWith(`PLAY ${pgm}-`)).length, 3)
	const iLoad = ev.indexOf(loadBatches[0])
	const iPlay = ev.indexOf(playEv[0])
	assert.ok(iLoad < iPlay)
	assert.ok(!ev.slice(iLoad + 1, iPlay).some((e) => e.t === 'batch' && e.lines.every(onCh(pgm))), 'no third PGM batch in between')
	// Nothing on PRV before the PGM PLAY batch; the PRV copy (old look) comes after the PGM commit.
	const firstPrv = idx(ev, onCh(prv))
	assert.ok(firstPrv > iPlay, `first PRV command (#${firstPrv}) after the PGM PLAY batch (#${iPlay}): ${JSON.stringify(ev.slice(0, firstPrv + 1))}`)
	const prvLoad = idx(ev, (l) => l.startsWith(`LOADBG ${prv}-`))
	assert.ok(prvLoad > iPlay, 'PRV LOADBG after the PGM PLAY')
	assert.ok(linesOf(ev[prvLoad]).some((l) => / O1 /i.test(l)), 'PRV gets the PREVIOUS PGM look')
	assert.ok(!ev.some((e) => linesOf(e).some((l) => l.startsWith(`LOADBG ${prv}-`) && / N1 /i.test(l))), 'the incoming look is never sent to PRV')
	assert.equal(ev[iPlay + 1]?.t === 'send' && ev[iPlay + 1].line, `MIXER ${pgm} COMMIT`, 'trailing PGM commit right after the PLAY batch, before PRV')
}

test('WO-814: 3-layer MIX take — LOADBG batch, PLAY batch (PLAYs last), then the PRV copy of the old look', async () => {
	const { amcp, ev } = recordingAmcp()
	await seed({ 1: OLD, 2: NEW })
	await take(makeCtx(amcp), { channel: 1, incomingScene: NEW })
	assertScreenOrder(ev, 1, 2)
})

test('WO-814: 3-layer CUT — the on-air look is not stopped before the PGM PLAY (no black gap)', async () => {
	const { amcp, ev } = recordingAmcp()
	await seed({ 1: OLD, 2: NEW })
	await take(makeCtx(amcp), { channel: 1, incomingScene: NEW, forceCut: true })
	assertScreenOrder(ev, 1, 2)
	const iPlay = idx(ev, (l) => l.startsWith('PLAY 1-'))
	const iStop = idx(ev, (l) => /^(STOP|CLEAR) 1-1[0-2]$/.test(l))
	assert.ok(iStop > iPlay, `old layers 1-10..12 stopped only after the PLAY (stop #${iStop}, play #${iPlay})`)
})

test('WO-814: two screens in one take group — one PLAY batch for both, PLAYs last, both PRVs after', async () => {
	const { amcp, ev } = recordingAmcp()
	await seed({ 1: OLD, 2: NEW, 3: OLD, 4: NEW })
	const ctx = makeCtx(amcp, 2)
	const takeGroup = { id: 'wo814-two-screens', size: 2 }
	await Promise.all([
		take(ctx, { channel: 1, incomingScene: NEW, takeGroup }),
		take(ctx, { channel: 3, incomingScene: NEW, takeGroup }),
	])
	const playEv = ev.filter((e) => linesOf(e).some((l) => /^PLAY [13]-/.test(l)))
	assert.equal(playEv.length, 1, `one merged PLAY batch: ${JSON.stringify(playEv)}`)
	const pl = playEv[0].lines
	assert.equal(pl.filter((l) => /^PLAY /.test(l)).length, 6)
	const firstPlay = pl.findIndex((l) => /^PLAY /.test(l))
	assert.ok(pl.slice(firstPlay).every((l) => /^PLAY /.test(l)), `PLAYs of both screens last: ${JSON.stringify(pl)}`)
	const iPlay = ev.indexOf(playEv[0])
	for (const prv of [2, 4]) assert.ok(idx(ev, onCh(prv)) > iPlay, `PRV ${prv} only after the merged PLAY batch`)
})

test('WO-814: no previous look and PRV shows the incoming look — PRV is cleared after the PLAY, not before', async () => {
	const { amcp, ev } = recordingAmcp()
	await seed({ 2: NEW })
	await take(makeCtx(amcp), { channel: 1, incomingScene: NEW })
	const iPlay = idx(ev, (l) => l.startsWith('PLAY 1-'))
	assert.ok(iPlay >= 0)
	const iPrv = idx(ev, onCh(2))
	assert.ok(iPrv > iPlay, 'PRV clear after the PGM PLAY')
	assert.equal(liveSceneState.getChannel(2), null, 'PRV state cleared (it showed the look now on air)')
})

test('WO-814: legacy opt-ins stay reachable — stageOnPreview:true stages on PRV first; take_two_phase_batch:false is unbatched', async () => {
	const staged = recordingAmcp()
	await seed({ 1: OLD, 2: OLD })
	await take(makeCtx(staged.amcp), { channel: 1, incomingScene: NEW, stageOnPreview: true })
	const iPrvNew = idx(staged.ev, (l) => l.startsWith('LOADBG 2-') && / N1 /i.test(l))
	assert.ok(iPrvNew >= 0 && iPrvNew < idx(staged.ev, (l) => l.startsWith('PLAY 1-')), 'explicit stageOnPreview still stages first')

	const legacy = recordingAmcp(false)
	await seed({ 1: OLD, 2: NEW })
	await take(makeCtx(legacy.amcp), { channel: 1, incomingScene: NEW })
	assert.equal(legacy.ev.filter((e) => e.t === 'batch').length, 0, 'flag off: no forced BEGIN…COMMIT')
	const iPlay = idx(legacy.ev, (l) => l.startsWith('PLAY 1-'))
	assert.ok(idx(legacy.ev, onCh(2)) > iPlay, 'flag off: PRV still after the PGM PLAY')
})

test('WO-814: playLinesLast keeps each group in order (route PLAY after its source)', () => {
	assert.deepEqual(
		playLinesLast(['PLAY 1-110', 'MIXER 1-110 OPACITY 0 0', 'PLAY 1-113', 'MIXER 1-110 OPACITY 1 12 linear']),
		['MIXER 1-110 OPACITY 0 0', 'MIXER 1-110 OPACITY 1 12 linear', 'PLAY 1-110', 'PLAY 1-113'],
	)
})
