'use strict'

/**
 * WO-1029 part 2 — the air snapshot around an Apply: capture (Caspar INFO + node state) → serialise → restore on the
 * restarted Caspar, with the exact AMCP lines and take calls, a fake clock (7 s between snapshot and restore) and a
 * renumbering apply (channels map by destination, never by number).
 *   src/engine/air-snapshot*.js, src/engine/restore-on-screens.js restoreOnConnect
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { fakeCaspar, memPersistence, memLive, dests } = require('./lib/wo1029-apply-fixtures')
const Air = require('../../src/engine/air-snapshot')
const { planChannelRestore, clipPosition } = require('../../src/engine/air-snapshot-plan')
const { parseChannelInfo } = require('../../src/engine/air-snapshot-parse')
const { restoreOnConnect } = require('../../src/engine/restore-on-screens')

const T0 = 1_000_000_000
const OLD_MAP = () => ({ programChannels: [1, 3], previewChannels: [2, 4], screenLabels: ['A', 'B'] })
/* The apply put the operator GUI on channel 1 (WO-868): every main moved up one. */
const NEW_MAP = () => ({ programChannels: [2, 4], previewChannels: [3, 5], operatorGuiChannels: [1], screenLabels: ['A', 'B'] })
const look = (id, name) => ({ sceneId: id, scene: { id, name, layers: [{ source: { type: 'file', value: 'CLIP_A' } }] } })

/** What was on air before the apply. */
function onAir() {
	return {
		1: {
			1: { producer: 'route', route: { channel: 7 } }, // audio bus: routing setup owns it
			10: { clip: 'CLIP_A', time: 10, len: 60 }, // the look's clip, playing
			20: { clip: 'LOOPER', time: 50, len: 55, loop: true }, // by hand, looping
			30: { clip: 'PAUSED_CLIP', time: 12.5, len: 100, paused: true }, // by hand, paused
			40: { clip: 'ENDING', time: 58, len: 60 }, // ends in 2 s
			50: { producer: 'route', route: { channel: 2 } }, // a route from this screen's preview
			60: { producer: 'html', url: 'http://127.0.0.1:4200/templates/lower.html' }, // a CG / html layer
			999: { producer: 'html', url: 'http://127.0.0.1:4200/templates/led-test-card.html' }, // the test card
		},
		2: { 10: { clip: 'CLIP_P', time: 3, len: 30 } }, // PRV of A
		3: { 10: { producer: 'html', url: 'http://h/b.html' }, 20: { producer: 'html', url: 'http://h/b2.html' } }, // PGM of B
	}
}

function captureCtx(caspar, extra = {}) {
	return {
		config: dests(['da', 'db']),
		amcp: caspar.amcp,
		_ledTestPatternActive: true,
		_ledTestCardSource: 'control',
		streamingChannelRtmp: { active: true, outputId: 'yt' },
		streamingChannelRecords: { rec1: { active: true, path: 'rec1.mov', outputId: 'rec1' } },
		...extra,
	}
}

async function snapshotNow(caspar, live) {
	const ctx = captureCtx(caspar)
	Air.rememberConnectRoles(ctx, OLD_MAP) // the roles of the Caspar that is running
	return Air.captureAirSnapshot(ctx, {
		deps: {
			now: () => T0,
			uptimeMs: () => 3_600_000,
			info: caspar.xml,
			liveLooks: () => live.getAll(),
			timeline: () => ({ timelineId: 'TL1', playing: true, position: 5000, loop: false }),
			getChannelMap: OLD_MAP,
		},
	})
}

describe('WO-1029 air snapshot — capture', () => {
	it('INFO parse: clip / loop / paused / time / length / route / html, fps from [num, den]', async () => {
		const c = fakeCaspar(onAir())
		const p = await parseChannelInfo(await c.xml(1))
		assert.equal(p.fps, 50)
		const by = Object.fromEntries(p.layers.map((l) => [l.layer, l]))
		assert.deepEqual(by[10], { layer: 10, producer: 'ffmpeg', paused: false, loop: false, clip: 'CLIP_A', time_s: 10, length_s: 60 })
		assert.equal(by[20].loop, true)
		assert.equal(by[30].paused, true)
		assert.deepEqual(by[50].route, { channel: 2, layer: null })
		assert.equal(by[60].url, 'http://127.0.0.1:4200/templates/lower.html')
	})

	it('captures every channel with its role, the looks, card, timeline, stream and recording — and survives JSON', async () => {
		const live = memLive({ 1: look('L1', 'Look one'), 3: look('L2', 'Look two') })
		const snap = JSON.parse(JSON.stringify(await snapshotNow(fakeCaspar(onAir()), live)))
		assert.equal(snap.taken_at, T0)
		assert.deepEqual(snap.roles, { 1: 'pgm:da', 2: 'prv:da', 3: 'pgm:db', 4: 'prv:db' })
		assert.deepEqual(snap.channels.map((c) => [c.channel, c.kind, c.layers.length]), [[1, 'program', 8], [2, 'preview', 1], [3, 'program', 2], [4, 'preview', 0]])
		assert.deepEqual(snap.looks.map((l) => [l.channel, l.role, l.scene_id]), [[1, 'pgm:da', 'L1'], [3, 'pgm:db', 'L2']])
		assert.deepEqual(snap.card, { active: true, source: 'control' })
		assert.deepEqual(snap.timeline, { id: 'TL1', playing: true, position_ms: 5000, loop: false })
		assert.deepEqual(snap.consumers, { stream: { active: true, outputId: 'yt' }, records: [{ key: 'rec1', outputId: 'rec1', path: 'rec1.mov' }] })
	})

	it('an unreadable channel is listed, the rest is still captured', async () => {
		const c = fakeCaspar(onAir())
		const ctx = captureCtx(c)
		Air.rememberConnectRoles(ctx, OLD_MAP)
		const snap = await Air.captureAirSnapshot(ctx, {
			deps: { now: () => T0, uptimeMs: () => 1, info: async (ch) => (ch === 2 ? Promise.reject(new Error('timeout')) : c.xml(ch)), liveLooks: () => ({}), timeline: () => null, getChannelMap: OLD_MAP },
		})
		assert.deepEqual(snap.errors, [{ channel: 2, error: 'timeout' }])
		assert.equal(snap.channels.length, 3)
	})
})

describe('WO-1029 air snapshot — positions (pure)', () => {
	it('playing +7 s, loop wraps, ended is not restarted, paused stays at its frame', () => {
		assert.deepEqual(clipPosition({ time_s: 10, length_s: 60 }, 7), { state: 'playing', at_s: 10, target_s: 17 })
		assert.deepEqual(clipPosition({ time_s: 50, length_s: 55, loop: true }, 7), { state: 'playing', at_s: 50, target_s: 2 })
		assert.equal(clipPosition({ time_s: 58, length_s: 60 }, 7).state, 'ended')
		assert.deepEqual(clipPosition({ time_s: 12.5, length_s: 100, paused: true }, 7), { state: 'paused', at_s: 12.5, target_s: 12.5 })
		assert.equal(clipPosition({ time_s: 0 }, 7), null, 'a still / unknown length gets no position')
	})

	it('a destination that is gone drops its route source; an occupied layer with other content is left and reported', () => {
		const plan = planChannelRestore(
			{ channel: 1, fps: 50, layers: [{ layer: 50, producer: 'route', route: { channel: 9, layer: null } }, { layer: 70, producer: 'ffmpeg', clip: 'X', time_s: 1, length_s: 9 }] },
			{ fps: 50, layers: [{ layer: 70, producer: 'ffmpeg', clip: 'OTHER' }] },
			{ channel: 2, elapsedS: 7, mapChannel: () => null },
		)
		assert.deepEqual(plan.lines, [])
		assert.equal(plan.skipped.length, 2)
		assert.match(plan.skipped[0].why, /route source channel 9 no longer exists/)
		assert.match(plan.skipped[1].why, /layer now shows OTHER/)
	})
})

/** Restore deps over a fake restarted Caspar; `take` simulates the look re-take (the look's clip from frame 0). */
function restoreRig(snap, { newMap = NEW_MAP, config = dests(['da', 'db']), live } = {}) {
	const persistence = memPersistence()
	Air.storeSnapshot(snap, persistence)
	const caspar = fakeCaspar({})
	const takes = []
	const calls = []
	const tl = { playing: true, position: 12000, played: [], paused: [] }
	const ctx = { config, amcp: caspar.amcp, log: () => {}, _ledTestPatternActive: true, _ledTestCardSource: 'control', streamingChannelRtmp: { active: true }, streamingChannelRecords: { rec1: { active: true } } }
	const deps = {
		persistence,
		now: () => T0 + 7000,
		uptimeMs: () => 3_600_000,
		getChannelMap: newMap,
		liveSceneState: live,
		info: caspar.xml,
		send: (line) => caspar.amcp.raw(line),
		airHeld: () => null,
		clearBorderType: () => {},
		take: async (body) => {
			takes.push([body.channel, body.incomingScene.id, body.forceCut, body.previewExchange])
			if (body.incomingScene.id === 'L1') caspar.state[body.channel] = { 10: { clip: 'CLIP_A', time: 0, len: 60 } }
			if (body.incomingScene.id === 'L2') caspar.state[body.channel] = { 10: { producer: 'html', url: 'http://h/b.html' } }
			return { status: 200, body: '{}' }
		},
		applyCard: async () => (calls.push('card'), { targets: [2, 4], failures: [] }),
		timelineEngine: () => ({
			getPlayback: () => ({ timelineId: 'TL1', playing: tl.playing, position: tl.position }),
			play: (id, pos, o) => tl.played.push([id, pos, o.restart]),
			pause: (id) => tl.paused.push(id),
		}),
		startStream: async (outputId) => (calls.push(`stream:${outputId}`), { status: 200, body: '{}' }),
	}
	return { ctx, deps, caspar, takes, calls, tl, persistence }
}

describe('WO-1029 air snapshot — restore after 7 s on a renumbered Caspar', () => {
	it('looks re-taken on their destination’s NEW channel, then every layer at position + 7 s, timeline, card, stream', async () => {
		const live = memLive({ 1: look('L1', 'Look one'), 3: look('L2', 'Look two') })
		const snap = await snapshotNow(fakeCaspar(onAir()), live)
		const rig = restoreRig(snap, { live })
		const report = await restoreOnConnect(rig.ctx, { reconnect: true, answeredAt: T0 + 6000, setup: { restagePersistedPreviewLooks: async () => {} }, deps: rig.deps })
		assert.deepEqual(Object.keys(live.all).sort(), ['2', '4'], 'live looks moved with their destination (1→2, 3→4)')
		assert.deepEqual(rig.takes, [[2, 'L1', true, false], [4, 'L2', true, false]], 'one cut re-take per look, no PGM/PRV exchange')
		assert.deepEqual(rig.caspar.lines, [
			'CALL 2-10 SEEK 850', // look clip: 10 s + 7 s at 50 fps
			'PLAY 2-20 "LOOPER" LOOP', // loop: (50 + 7) mod 55 = 2 s
			'CALL 2-20 SEEK 100',
			'LOAD 2-30 "PAUSED_CLIP" SEEK 625', // paused at 12.5 s
			'PLAY 2-50 route://3', // its source (PRV of A) is channel 3 now
			'PLAY 2-60 [HTML] "http://127.0.0.1:4200/templates/lower.html"',
			'PLAY 4-20 [HTML] "http://h/b2.html"', // program channels first …
			'PLAY 3-10 "CLIP_P" SEEK 500', // … preview after
		])
		assert.ok(!rig.caspar.lines.some((l) => /ENDING|-999 |-1 /.test(l)), 'ended clip, card layer and audio bus are not replayed from INFO')
		assert.deepEqual(rig.tl.played, [['TL1', 12000, true]], 'timeline resumed where its engine is (snapshot + elapsed)')
		assert.deepEqual(rig.calls, ['card', 'stream:yt'], 'card after the layers, stream restarted')
		assert.deepEqual(report.clips.map((c) => [c.channel, c.layer, c.at_s, c.resumed_s, c.paused]), [[2, 10, 10, 17, false], [2, 20, 50, 2, false], [2, 30, 12.5, 12.5, true], [3, 10, 3, 10, false]])
		assert.ok(report.skipped.some((s) => /ENDING/.test(s.what) && /ended/.test(s.why)))
		assert.ok(report.skipped.some((s) => /recording rec1/.test(s.what)), 'a recording is reported, not silently restarted')
		assert.equal(rig.ctx.streamingChannelRecords.rec1.active, false)
		assert.equal(report.ms, 1000, 'measured from when Caspar answered')
		assert.equal(rig.persistence.get(Air.KEY), undefined, 'discarded once restored')
	})

	it('a destination that no longer exists: its look and content are dropped and reported', async () => {
		const live = memLive({ 1: look('L1', 'Look one'), 3: look('L2', 'Look two') })
		const snap = await snapshotNow(fakeCaspar(onAir()), live)
		const rig = restoreRig(snap, { live, config: dests(['da']), newMap: () => ({ programChannels: [1], previewChannels: [2], screenLabels: ['A'] }) })
		const report = await restoreOnConnect(rig.ctx, { reconnect: true, setup: { restagePersistedPreviewLooks: async () => {} }, deps: rig.deps })
		assert.deepEqual(Object.keys(live.all), ['1'])
		assert.deepEqual(rig.takes.map((t) => t[0]), [1])
		assert.ok(report.skipped.some((s) => /Look two/.test(s.what) && /no longer exists/.test(s.why)))
		assert.ok(report.skipped.some((s) => /was ch 3/.test(s.what) && /no longer exists/.test(s.why)))
		assert.ok(!rig.caspar.lines.some((l) => /b2\.html/.test(l)))
	})

	it('a paused clip in a look stays paused at its frame; a failed line does not stop the others', async () => {
		const live = memLive({ 1: look('L1', 'Look one') })
		const air = onAir()
		air[1][10].paused = true
		const snap = await snapshotNow(fakeCaspar(air), live)
		const rig = restoreRig(snap, { live })
		rig.deps.send = (line) => (/LOOPER/.test(line) ? Promise.reject(new Error('404 PLAY FAILED')) : rig.caspar.amcp.raw(line))
		const report = await restoreOnConnect(rig.ctx, { reconnect: true, setup: { restagePersistedPreviewLooks: async () => {} }, deps: rig.deps })
		assert.deepEqual(rig.caspar.lines.slice(0, 2), ['CALL 2-10 SEEK 500', 'PAUSE 2-10'])
		assert.ok(rig.caspar.lines.includes('LOAD 2-30 "PAUSED_CLIP" SEEK 625'), 'the line after the failed one still went')
		assert.ok(report.skipped.some((s) => /LOOPER/.test(s.what) && /PLAY FAILED/.test(s.why)))
		assert.ok(!report.clips.some((c) => c.layer === 20), 'the failed layer is not reported as restored')
	})

	it('a channel the cluster master holds here is left to the master', async () => {
		const live = memLive({})
		const snap = await snapshotNow(fakeCaspar(onAir()), live)
		const rig = restoreRig(snap, { live })
		rig.deps.airHeld = (ch) => (ch === 2 ? { drivenBy: 'highascg5867' } : null)
		const report = await restoreOnConnect(rig.ctx, { reconnect: true, setup: { restagePersistedPreviewLooks: async () => {} }, deps: rig.deps })
		assert.ok(!rig.caspar.lines.some((l) => /^\S+ 2-/.test(l)))
		assert.ok(report.skipped.some((s) => /driven by highascg5867/.test(s.why)))
	})

	it('no snapshot → WO-1013 as before; a stale one is discarded, not restored', async () => {
		const live = memLive({ 1: look('L1', 'Look one') })
		const snap = await snapshotNow(fakeCaspar(onAir()), live)
		const rig = restoreRig(snap, { live })
		rig.deps.now = () => T0 + Air.STALE_MS + 1
		const r = await restoreOnConnect(rig.ctx, { reconnect: true, setup: { restagePersistedPreviewLooks: async () => {} }, deps: rig.deps })
		assert.equal(r, null)
		assert.equal(rig.persistence.get(Air.KEY), undefined)
		assert.deepEqual(rig.caspar.lines, [], 'no INFO pass')
		assert.deepEqual(rig.calls, ['card'], 'the reconnect still repaints the card (WO-1013)')
	})

	it('first connect of a node process: the snapshot only when the box did not reboot since (node restarted by the apply)', () => {
		const p = memPersistence()
		Air.storeSnapshot({ v: 1, id: 'x', taken_at: T0 }, p)
		assert.equal(Air.armedSnapshot({ reconnect: false, persistence: p, now: T0 + 30_000, uptimeMs: 20_000 }).snap, null, 'rebooted: boot rules')
		assert.equal(Air.armedSnapshot({ reconnect: false, persistence: p, now: T0 + 30_000, uptimeMs: 600_000 }).snap.id, 'x')
		assert.equal(Air.armedSnapshot({ reconnect: true, persistence: p, now: T0 + 30_000, uptimeMs: 1 }).snap.id, 'x')
	})
})
