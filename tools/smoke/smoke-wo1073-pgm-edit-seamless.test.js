'use strict'

/**
 * WO-1073 (owner 14.11): "I changed settings such as the speed of a clip and parameters of a PiP border on pgm2 … each
 * change made the clip or the border reload. I'd like whatever possible to show seamlessly on the screen."
 *
 *   1. a PIP-overlay-only edit of the look on PGM is the nudge + overlay CG lines on the ACTIVE bank's slots (no take);
 *   2. an edit-take (`editOnAir`, only from the edit pushes) reloads the changed layers only — unchanged ones keep
 *      playing and are SWAPped to the new bank inside the PLAY batch with their overlay slots; a normal take is unchanged;
 *   3. a reloaded layer showing the same file resumes at its OSC playhead when it ran at 1x (no reliable clip position
 *      at another speed — said in the log, not faked);
 *   4. the PRV edit take uses the same rule; a stale edit on PGM is refused (409), never re-taken.
 */

const { describe, it, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { handleSceneTake } = require('../../src/api/routes-scene-take')
const { handlePreviewPush } = require('../../src/api/routes-scene-preview-push')
const { pushPgmPipOverlays } = require('../../src/api/routes-scene-preview-pip')
const { editLayerKeepsPlaying } = require('../../src/engine/scene-take-edit-on-air')
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
const PGM_PRV = { screen_count: 1 }
const border = (over = {}) => ({ type: 'border', params: { width: 8, color: '#ff0000', radius: 0, opacity: 1, side: 'outside', ...over } })
const look = (id = 'L1') => ({
	id,
	defaultTransition: { type: 'CUT' },
	layers: [
		{ layerNumber: 10, source: { type: 'media', value: 'bg.mov' } },
		{ layerNumber: 11, source: { type: 'media', value: 'pip.mov' }, fill: { x: 0.6, y: 0.6, scaleX: 0.3, scaleY: 0.3 }, pipOverlays: [border()] },
	],
})
/** OSC: ch 1 layer 10 (bank A) at frame 500, sampled now. */
const osc = () => ({
	on() {},
	off() {},
	removeListener() {},
	getSnapshot: () => ({ channels: { 1: { layers: { 10: { type: 'ffmpeg', file: { frameElapsed: 500, duration: 60 }, _lastOscAt: Date.now() } } } } }),
})

function makeCtx(config, extra = {}) {
	const { amcp, ev } = recordingAmcp()
	const logs = []
	const ctx = { amcp, config, log: (_lv, m) => logs.push(String(m)), _playbackMatrix: {}, programLayerBankByChannel: { 1: 'a' }, ...extra }
	return { ctx, ev, logs }
}

async function seed(map) {
	for (const ch of [1, 2]) liveSceneState.clearChannel?.(ch)
	for (const [ch, scene] of Object.entries(map)) await liveSceneState.setChannel(Number(ch), { sceneId: scene.id, scene })
}

const all = (ev) => ev.flatMap((e) => (e.t === 'batch' ? e.lines : [e.line]))
const playBatch = (ev) => ev.find((e) => e.t === 'batch' && e.lines.some((l) => /^PLAY /.test(l)))

async function take(ctx, body) {
	return handleSceneTake(JSON.stringify({ channel: 1, sceneId: 'L1', forceCut: true, ...body }), ctx)
}

describe('WO-1073 point 2 — an edit-take on PGM reloads only the changed layer', () => {
	beforeEach(() => seed({ 1: look() }))

	for (const [name, config] of [['PGM-only screen', PGM_ONLY], ['screen with PRV', PGM_PRV]]) {
		it(`${name}: speed change on L10 → L10 reloads, L11 + its border SWAP to bank B inside the PLAY batch`, async () => {
			const { ctx, ev } = makeCtx(config)
			const edited = look()
			edited.layers[0].speed = 1.5
			const res = await take(ctx, { incomingScene: edited, previewExchange: false, editOnAir: true })
			assert.equal(res.status, 200, res.body)
			const lines = all(ev)
			assert.ok(lines.some((l) => /^LOADBG 1-110 BG .*setpts/.test(l)), 'the changed layer reloads on bank B')
			assert.ok(!lines.some((l) => /^(LOADBG|PLAY|STOP|CG ADD) 1-1?11( |$)/.test(l)), `L11 keeps playing: ${JSON.stringify(lines)}`)
			assert.ok(!lines.some((l) => /^CG 1-6\d\d ADD /.test(l)), 'its border is not re-added')
			assert.ok(!lines.some((l) => /^(CG|STOP|MIXER) 1-1[01] CLEAR$/.test(l) && lines.indexOf(l) < lines.findIndex((x) => /^PLAY /.test(x))),
				'nothing on air is cleared before the PLAY')
			assert.deepEqual(playBatch(ev).lines, ['SWAP 1-11 1-111 TRANSFORMS', 'SWAP 1-264 1-624 TRANSFORMS', 'PLAY 1-110'])
			assert.ok(lines.includes('CG 1-264 CLEAR'), 'the vacated border slot is cleared after the take')
			assert.equal(ctx.programLayerBankByChannel[1], 'b')
		})
	}

	it('a normal operator take of the same look still reloads every layer (unchanged contract)', async () => {
		const { ctx, ev } = makeCtx(PGM_PRV)
		const edited = look()
		edited.layers[0].speed = 1.5
		const res = await take(ctx, { incomingScene: edited, previewExchange: false })
		assert.equal(res.status, 200, res.body)
		const lines = all(ev)
		assert.ok(lines.some((l) => /^LOADBG 1-111 PIP/.test(l)))
		assert.deepEqual(playBatch(ev).lines, ['PLAY 1-110', 'PLAY 1-111'])
		assert.ok(!lines.some((l) => /^SWAP /.test(l)))
	})

	it('the look left PGM before its turn in the take chain → 409 not_on_air, nothing sent', async () => {
		await seed({ 1: look('OTHER') })
		const { ctx, ev } = makeCtx(PGM_ONLY)
		const res = await take(ctx, { incomingScene: look(), previewExchange: false, editOnAir: true })
		assert.equal(res.status, 409)
		assert.match(JSON.parse(res.body).error, /not_on_air/)
		assert.deepEqual(all(ev), [])
	})

	it('the edit compare: canonical media, strict otherwise, playlists never kept', () => {
		const a = look().layers[1]
		assert.equal(editLayerKeepsPlaying(a, { ...a, source: { type: 'file', value: 'PIP.mov' } }, {}), true)
		assert.equal(editLayerKeepsPlaying(a, { ...a, playSeekFrames: 40 }, {}), true, 'a take-time seek is not an edit')
		assert.equal(editLayerKeepsPlaying(a, { ...a, pipOverlays: [border({ width: 9 })] }, {}), false)
		assert.equal(editLayerKeepsPlaying(a, { ...a, sourceMode: 'list' }, {}), false)
	})
})

describe('WO-1073 point 3 — a reloaded layer resumes at its playhead (1x only)', () => {
	beforeEach(() => seed({ 1: look() }))

	it('on air at 1x, speed → 1.5: LOADBG … SEEK = the OSC playhead projected to the PLAY deadline', async () => {
		const { ctx, ev, logs } = makeCtx(PGM_ONLY, { oscState: osc() })
		const edited = look()
		edited.layers[0].speed = 1.5
		assert.equal((await take(ctx, { incomingScene: edited, previewExchange: false, editOnAir: true })).status, 200)
		// 500 + (350 ms lead + 35 ms pipe) × 50 fps = 519
		assert.ok(all(ev).includes('LOADBG 1-110 BG IN 0 SEEK 519 VF "setpts=(PTS-STARTPTS)/1.5+STARTPTS" AF "atempo=1.5"'), JSON.stringify(all(ev)))
		assert.ok(logs.some((m) => /\[edit-on-air\] 1-10 L10: resumes at playhead 519 → SEEK 519/.test(m)))
	})
	it('a normal take of the same edit starts the clip at its own start (SEEK 0)', async () => {
		const { ctx, ev } = makeCtx(PGM_ONLY, { oscState: osc() })
		const edited = look()
		edited.layers[0].speed = 1.5
		assert.equal((await take(ctx, { incomingScene: edited, previewExchange: false })).status, 200)
		assert.ok(all(ev).some((l) => /^LOADBG 1-110 BG IN 0 SEEK 0 /.test(l)))
	})
	it('on air at 1.5x: Caspar reports filter-output time → no resume, and the log says why', async () => {
		const onAir = look()
		onAir.layers[0].speed = 1.5
		await seed({ 1: onAir })
		const { ctx, ev, logs } = makeCtx(PGM_ONLY, { oscState: osc() })
		assert.equal((await take(ctx, { incomingScene: look(), previewExchange: false, editOnAir: true })).status, 200)
		assert.ok(all(ev).some((l) => /^LOADBG 1-110 BG IN 0 SEEK 0$/.test(l)), JSON.stringify(all(ev)))
		assert.ok(logs.some((m) => /on air at 1\.5x — Caspar reports filter-output time/.test(m)))
	})
})

describe('WO-1073 point 1 — PIP overlay edit on PGM: nudge + overlay lines, no take', () => {
	const map = { programChannels: [1], previewChannels: [null], programResolutions: [{ w: 1920, h: 1080, fps: 50 }] }
	const deps = (edited, live, calls, pipReply = { ok: true, lines: 3 }) => ({
		resolveSceneById: () => edited,
		getChannelMap: () => map,
		getStaged: (ch) => (calls.push(['live', ch]), live),
		nudge: async () => (calls.push(['nudge']), { status: 200, body: JSON.stringify({ ok: true, lines: 4 }) }),
		pushPip: async (a) => (calls.push(['pip', a.pgmCh]), pipReply),
		takeLook: async (b) => (calls.push(['take', b]), { status: 200, body: JSON.stringify({ ok: true }) }),
		registerLive: async () => calls.push(['register']),
	})
	const widened = () => {
		const e = look()
		e.layers[1].pipOverlays = [border({ width: 14 })]
		return e
	}

	it('border width change → mode overlay: nudge, overlay push on the program channel, live entry updated — no take', async () => {
		const calls = []
		const res = await handlePreviewPush({ sceneId: 'L1', mainIdx: 0, target: 'pgm' }, {}, deps(widened(), { sceneId: 'L1', scene: look() }, calls))
		assert.equal(res.status, 200)
		assert.equal(JSON.parse(res.body).mode, 'overlay')
		assert.deepEqual(calls.map((c) => c[0]), ['live', 'nudge', 'pip', 'register'])
		assert.equal(calls[2][1], 1)
	})
	it('the look left air inside the overlay chain → 409, never re-taken', async () => {
		const calls = []
		const res = await handlePreviewPush({ sceneId: 'L1', mainIdx: 0, target: 'pgm' }, {}, deps(widened(), { sceneId: 'L1', scene: look() }, calls, { ok: false, lines: 0 }))
		assert.equal(res.status, 409)
		assert.equal(JSON.parse(res.body).mode, 'not_on_air')
		assert.ok(!calls.some((c) => c[0] === 'take' || c[0] === 'register'))
	})

	it('pushPgmPipOverlays on bank B: CG UPDATE of the outside border on slot 624 (layer 111), no ADD, no reload', async () => {
		await seed({ 1: look() })
		const { ctx, ev } = makeCtx(PGM_ONLY, { programLayerBankByChannel: { 1: 'b' } })
		const r = await pushPgmPipOverlays(ctx, { sceneId: 'L1', scene: widened(), live: liveSceneState.getChannel(1), pgmCh: 1, canvas: { w: 1920, h: 1080 } })
		assert.equal(r.ok, true)
		assert.equal(r.bank, 'b')
		const lines = all(ev)
		assert.ok(lines.some((l) => l.startsWith('CG 1-624 UPDATE 0 ') && l.includes('14')), JSON.stringify(lines))
		assert.ok(lines.some((l) => /^MIXER 1-624 FILL /.test(l)), 'the ring follows the wider border')
		assert.ok(!lines.some((l) => / ADD | CLEAR$|^(LOADBG|PLAY|STOP) /.test(l)), JSON.stringify(lines))
		assert.ok(lines.every((l) => / 1-624( |$)/.test(l)), 'only the slot of the active bank')
	})
	it('pushPgmPipOverlays on bank A addresses slot 264; a look that left air sends nothing', async () => {
		await seed({ 1: look() })
		const a = makeCtx(PGM_ONLY)
		await pushPgmPipOverlays(a.ctx, { sceneId: 'L1', scene: widened(), live: liveSceneState.getChannel(1), pgmCh: 1, canvas: null })
		assert.ok(all(a.ev).length > 0 && all(a.ev).every((l) => / 1-264( |$)/.test(l)), JSON.stringify(all(a.ev)))
		await seed({ 1: look('OTHER') })
		const gone = makeCtx(PGM_ONLY)
		const r = await pushPgmPipOverlays(gone.ctx, { sceneId: 'L1', scene: widened(), live: { sceneId: 'L1', scene: look() }, pgmCh: 1, canvas: null })
		assert.equal(r.ok, false)
		assert.deepEqual(all(gone.ev), [])
	})
})

describe('WO-1073 point 4 — the PRV edit take uses the same rule', () => {
	it('staged same look on PRV ch 2: only the changed layer reloads, bankless (no SWAP)', async () => {
		await seed({ 2: look() })
		const { ctx, ev } = makeCtx(PGM_PRV)
		const edited = look()
		edited.layers[0].speed = 1.5
		const res = await take(ctx, { incomingScene: edited, target: 'preview', editOnAir: true })
		assert.equal(res.status, 200, res.body)
		const lines = all(ev)
		assert.ok(lines.some((l) => /^LOADBG 2-10 BG .*setpts/.test(l)), JSON.stringify(lines))
		assert.ok(!lines.some((l) => /^(LOADBG|PLAY|STOP) 2-11( |$)/.test(l) || /^CG 2-264 ADD /.test(l)), JSON.stringify(lines))
		assert.ok(!lines.some((l) => /^SWAP /.test(l)))
	})
	it('another look staged meanwhile → a plain staging take (every layer), not a refusal', async () => {
		await seed({ 2: look('OTHER') })
		const { ctx, ev } = makeCtx(PGM_PRV)
		const res = await take(ctx, { incomingScene: look(), target: 'preview', editOnAir: true })
		assert.equal(res.status, 200, res.body)
		assert.ok(all(ev).some((l) => /^LOADBG 2-11 PIP/.test(l)))
	})
	it('take-look carries editOnAir to the take engine and through a cluster relay', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/routes-scene-take-look.js'), 'utf8')
		assert.match(src, /if \(b\.editOnAir === true\) out\.editOnAir = true/)
		assert.match(src, /\.\.\.\(b\.editOnAir === true \? \{ editOnAir: true \} : \{\}\)/)
	})
})
