'use strict'

/**
 * WO-1029 plan 07 (C1b) — engine consumers with HOLES in the channel map (`cluster.channelsWhereCabled` on).
 *
 * Fixture: highascg5867 with the rule on (tools/smoke/lib/cwc-fixtures.js) → programChannels [null,null,2,4],
 * previewChannels [null,null,3,5], operator GUI 1, DeckLink inputs 6/7. Screens 0 and 1 are NOT on this server.
 * Every test: an operation on screen 2 (here) gives the exact channels / AMCP lines, and NOTHING is sent or stored for
 * screens 0 and 1 — in particular nothing lands on screen 2's channels (2/3) or the operator GUI (1) instead.
 * Flag off is covered by the existing per-module smokes (untouched) plus the byte-identity checks at the end.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')

const { boxConfig, clone } = require('./lib/cwc-fixtures')
const { getChannelMap } = require('../../src/config/routing')
const { buildChannelMap } = require('../../src/config/channel-map-from-ctx')
const { notHereError, isNotHere, NOT_HERE } = require('../../src/config/not-here')
const sc = require('../../src/config/screen-channels')

function on5867() {
	const c = boxConfig('5867')
	c.cluster = { channelsWhereCabled: true }
	return c
}
/** 5867 with the rule on plus a multiview destination cabled here (its channel: 6). */
function on5867WithMultiview() {
	const c = on5867()
	c.screenDestinations.destinations.push({ id: 'mv1', label: 'MV', mode: 'multiview' })
	c.deviceGraph.connectors.push(
		{ id: 'dst_in_mv1', deviceId: 'destinations', kind: 'destination_in', externalRef: 'mv1' },
		{ id: 'gpu_mvx', deviceId: 'caspar_host', kind: 'gpu_out' },
	)
	c.deviceGraph.edges.push({ id: 'emv', sourceId: 'dst_in_mv1', sinkId: 'gpu_mvx' })
	return c
}
const off5867 = () => boxConfig('5867')

const HOLE_CHANNELS_OFF = [2, 3, 4] // what screens 0/1 had on the flag-off map — must never appear for them
const isNotHereErr = (idx) => (e) => isNotHere(e) && e.code === NOT_HERE && e.status === 409 && e.screenIdx === idx

describe('WO-1029 C1b the fixture and the convention', () => {
	it('5867 with the rule on: screens 0/1 are holes, 2/3 are here', () => {
		const m = getChannelMap(on5867())
		assert.deepEqual(m.programChannels, [null, null, 2, 4])
		assert.deepEqual(m.previewChannels, [null, null, 3, 5])
		assert.deepEqual(sc.loopScreens(m), [2, 3])
		assert.deepEqual(sc.loopScreens(getChannelMap(off5867())), [0, 1, 2, 3], 'flag off: every screen, as the legacy loops')
		assert.deepEqual(sc.loopScreens({ screenCount: 0 }, 1), [0], 'flag off: the caller’s legacy `|| 1`')
	})

	it('NOT_HERE is one thrown shape: code, status 409, 0-based screenIdx', () => {
		const e = notHereError(1)
		assert.equal(e.message, 'Screen 2 is not on this server')
		assert.ok(isNotHereErr(1)(e))
		assert.equal(isNotHere(new Error('x')), false)
	})
})

describe('WO-1029 C1b timeline', () => {
	const { TimelineEngine } = require('../../src/engine/timeline-engine')
	const engines = []
	after(() => {
		for (const eng of engines) for (const tl of eng.getAll()) eng.stop(tl.id)
	})
	function makeEngine(config) {
		const sent = []
		const rec = (n) => (...a) => {
			sent.push(`${n} ${a.join('-')}`)
			return Promise.resolve()
		}
		const amcp = {
			raw: (c) => (sent.push(c), Promise.resolve()),
			stop: rec('STOP'),
			pause: rec('PAUSE'),
			resume: rec('RESUME'),
			call: rec('CALL'),
			mixerFill: rec('FILL'),
			mixerOpacity: rec('OPACITY'),
			mixerVolume: rec('VOLUME'),
			mixerCommit: rec('COMMIT'),
			batchSendChunked: (lines) => (sent.push(...lines), Promise.resolve()),
		}
		const self = { amcp, config, log: () => {}, variables: {} }
		const eng = new TimelineEngine(self)
		engines.push(eng)
		return { eng, sent, self }
	}
	const clip = (id) => ({ id, startTime: 0, duration: 30000, source: { type: 'media', value: id } })

	it('_channelsFor: all screens = the screens here; a hole routes nowhere (no programCh(1) / channel-1 fallback)', () => {
		const { eng } = makeEngine(on5867())
		assert.deepEqual(eng._channelsFor({ preview: true, program: true, screenIdx: null }), [3, 2, 5, 4])
		assert.deepEqual(eng._channelsFor({ preview: true, program: true, screenIdx: 2 }), [3, 2])
		assert.deepEqual(eng._channelsFor({ preview: false, program: true, screenIdx: 0 }), [])
		assert.deepEqual(eng._channelsFor({ preview: true, program: true, screenIdx: 1 }), [])
	})

	it('_screenChannelSet / _layerChannels: a layer pinned to a hole plays nowhere', () => {
		const { eng } = makeEngine(on5867())
		assert.deepEqual([...eng._screenChannelSet(0)], [])
		assert.deepEqual([...eng._screenChannelSet(2)].sort(), [2, 3])
		eng.create({ id: 'T', sendTo: { preview: true, program: true, screenIdx: null }, layers: [{ id: 'a', screenIdx: 0 }, { id: 'b', screenIdx: 2 }] })
		eng._airTimelineId = 'T'
		const ch = eng._channels()
		assert.deepEqual(eng._layerChannels(0, ch), [])
		assert.deepEqual(eng._layerChannels(1, ch).sort(), [2, 3])
		eng._airTimelineId = null
	})

	it('play: layer on screen 2 → PLAY 2-211 only; the layer on hole screen 0 sends nothing anywhere', () => {
		const { eng, sent } = makeEngine(on5867())
		eng.create({
			id: 'T',
			duration: 30000,
			sendTo: { preview: false, program: true, screenIdx: null },
			layers: [
				{ id: 'a', screenIdx: 0, clips: [clip('A')] },
				{ id: 'b', screenIdx: 2, clips: [clip('B')] },
			],
		})
		eng.play('T', 1000)
		const plays = sent.filter((l) => l.startsWith('PLAY')).map((l) => l.split(' ').slice(0, 2).join(' '))
		assert.deepEqual(plays, ['PLAY 2-211'])
		assert.equal(sent.filter((l) => /\b\d+-210\b/.test(l)).length, 0, 'nothing for the hole layer (210) on any channel')
	})

	it('runTimelineDirectTake: a hole screen is NOT_HERE before any AMCP; "all" touches only 2 and 4', async () => {
		const { runTimelineDirectTake } = require('../../src/engine/timeline-take')
		const { eng, sent, self } = makeEngine(on5867())
		eng.create({ id: 'T', duration: 30000, sendTo: { preview: false, program: true, screenIdx: null }, layers: [{ id: 'b', clips: [clip('B')] }] })
		await assert.rejects(runTimelineDirectTake(self, eng, 'T', { screenIdx: 0, transition: 'CUT' }), isNotHereErr(0))
		assert.deepEqual(sent, [])
		await runTimelineDirectTake(self, eng, 'T', { screenIdx: 'all', transition: 'CUT' })
		const chans = new Set(sent.map((l) => /\b(\d+)-\d+/.exec(l)?.[1]).filter(Boolean).map(Number))
		assert.deepEqual([...chans].sort(), [2, 4], 'screen 2 and 3 PGM only — nothing on 1 or a hole')
	})
})

describe('WO-1029 C1b FTB / test card / defaults', () => {
	it('LED test card "all program channels" = the local PGMs only (never the [1] default)', () => {
		const { planTargets } = require('../../src/engine/led-test-card-control')
		const cm = buildChannelMap({ config: on5867() })
		const settings = { channelsEnabled: {}, gridByChannel: {} }
		assert.deepEqual(planTargets(settings, cm, true), [2, 4])
		const allHoles = { ...cm, programChannels: [null, null, null, null], previewChannels: [null, null, null, null] }
		assert.deepEqual(planTargets(settings, allHoles, true), [], 'no screen here → no target (not channel 1)')
	})

	it('FTB: the timeline-channel check matches only channels of screens here', () => {
		const { collectLayersToFadeOnChannel } = require('../../src/engine/ftb-pgm-prv')
		const tl = { layers: [{}, {}] }
		const timelineEngine = { getPlayback: () => ({ timelineId: 'T', sendTo: { preview: true, program: true, screenIdx: 0 } }), timelines: { get: () => tl } }
		const self = { config: on5867(), _playbackMatrix: {}, timelineEngine }
		// sendTo screen 0 (a hole): its timeline is on no channel here — FTB of ch2 (screen 2) fades no timeline layer
		assert.deepEqual(collectLayersToFadeOnChannel(self, 2), [])
		timelineEngine.getPlayback = () => ({ timelineId: 'T', sendTo: { preview: true, program: true, screenIdx: 2 } })
		assert.deepEqual(collectLayersToFadeOnChannel(self, 2), [210, 211])
	})

	it('defaultProgramChannel = the first screen HERE; no screen here → NOT_HERE (never 1 = the operator GUI)', () => {
		const { defaultProgramChannel } = require('../../src/config/operator-gui-first')
		assert.equal(defaultProgramChannel(on5867()), 2)
		const none = on5867()
		none.deviceGraph.edges = none.deviceGraph.edges.filter((e) => !/^dst_in_dst_mw(989wyz|9orj4o)_1$/.test(e.sourceId))
		assert.deepEqual(getChannelMap(none).programChannels, [null, null, null, null])
		assert.throws(() => defaultProgramChannel(none), isNotHereErr(0))
		assert.equal(defaultProgramChannel(off5867()), 2, 'flag off: unchanged')
	})

	it('cg-routing: an explicit hole screen is NOT_HERE; an explicit channel never consults the default', () => {
		const { resolveCgRequestChannel } = require('../../src/engine/cg-routing')
		const ctx = { config: on5867() }
		assert.throws(() => resolveCgRequestChannel({ mainScreenIndex: 1 }, ctx), isNotHereErr(1))
		assert.equal(resolveCgRequestChannel({ mainScreenIndex: 3 }, ctx), 4)
		assert.equal(resolveCgRequestChannel({}, ctx), 2)
		assert.equal(resolveCgRequestChannel({ mainScreenIndex: 1 }, { config: off5867() }), 4, 'flag off: unchanged')
	})

	it('channel → screen fallbacks pick the first screen here (scene take timeline / authoring resolution)', () => {
		const { programChannelToScreenIdx } = require('../../src/engine/scene-transition')
		assert.equal(programChannelToScreenIdx(on5867(), 4), 3)
		assert.equal(programChannelToScreenIdx(on5867(), 1), 2, 'operator GUI channel is no screen → first screen here, not hole 0')
		assert.equal(programChannelToScreenIdx(off5867(), 1), 0, 'flag off: 0 as before')
	})
})

describe('WO-1029 C1b live state / air', () => {
	it('invalidateIfProgramChannel and air-state see only local program channels', () => {
		const liveSceneState = require('../../src/state/live-scene-state')
		assert.equal(liveSceneState.invalidateIfProgramChannel(on5867(), 1), false, 'channel 1 (operator GUI) is no program here')
		const { programLooks } = require('../../src/cluster/air-state')
		const orig = liveSceneState.getAll
		liveSceneState.getAll = () => ({ 2: { sceneId: 's2', scene: { name: 'S2' } }, 3: { sceneId: 'p3', scene: {} } })
		try {
			assert.deepEqual(programLooks({ config: on5867() }), [{ channel: 2, sceneId: 's2', name: 'S2' }], 'ch3 is screen 2’s PRV')
		} finally {
			liveSceneState.getAll = orig
		}
	})

	it('air snapshot: a look of a screen that moved to another server is dropped as NOT_HERE, never moved', async () => {
		const { rolesOf } = require('../../src/engine/air-snapshot-roles')
		const { rekeyLiveLooks, restoreChannels } = require('../../src/engine/air-snapshot-restore')
		const before = rolesOf(off5867())
		const snap = { roles: Object.fromEntries([...before.byChannel].map(([c, r]) => [String(c), r])), looks: [], channels: [] }
		const after = rolesOf(on5867())
		assert.ok(after.notHere.has('pgm:dst_mw7t9epz_1'))
		assert.equal(after.byRole.get('pgm:dst_mw989wyz_1'), 2, 'screen 2 is now channel 2')
		// flag-off ch2 was screen 0's PGM; ch5 was screen 2's PGM
		snap.looks = [{ channel: 2, scene_id: 'a', name: 'A' }, { channel: 5, scene_id: 'c', name: 'C' }]
		const store = { 2: { sceneId: 'a' }, 5: { sceneId: 'c' } }
		const liveSceneState = {
			getAll: () => ({ ...store }),
			clearChannel: async (ch) => void delete store[ch],
			setChannel: async (ch, e) => void (store[ch] = e),
		}
		const r = await rekeyLiveLooks({ config: on5867() }, snap, { deps: { liveSceneState, getChannelMap }, newRoles: after })
		assert.deepEqual(r.moved, [{ from: 5, to: 2 }])
		assert.equal(r.dropped.length, 1)
		assert.match(r.dropped[0].why, /not on this server/)
		assert.deepEqual(store, { 2: { sceneId: 'c' } }, 'screen 0’s look is gone, screen 2’s look is on its new channel')
		snap.channels = [{ channel: 3, role: snap.roles['3'], label: 'PGM/PRV 1 preview', kind: 'preview', layers: [{ layer: 10 }] }]
		const out = await restoreChannels({ config: on5867() }, snap, { deps: { getChannelMap, airHeld: () => null }, newRoles: after })
		assert.equal(out.skipped.length, 1)
		assert.match(out.skipped[0].why, /NOT_HERE/)
		assert.equal(rolesOf(off5867()).notHere.size, 0, 'flag off: no role is ever "not here"')
	})
})

describe('WO-1029 C1b multiview / operator GUI / previews', () => {
	it('routeForCell: PGM/PRV cells of a hole get NO route; screen 2 cells their own channels', () => {
		const { routeForCell } = require('../../src/engine/multiview-layout-helper')
		const m = getChannelMap(on5867())
		assert.equal(routeForCell({ id: 'pgm_0' }, m, null, [3, 5]), null)
		assert.equal(routeForCell({ id: 'prv_1' }, m, null, [3, 5]), null)
		assert.equal(routeForCell({ id: 'pgm_2' }, m, null, [3, 5]), 'route://2')
		assert.equal(routeForCell({ id: 'prv_2' }, m, null, [3, 5]), 'route://3')
		assert.equal(routeForCell({ id: 'weird', type: 'weird' }, m, null, [3, 5]), 'route://2', 'unknown cell → first screen here')
		assert.equal(routeForCell({ id: 'pgm_0' }, getChannelMap(off5867()), null, [3, 6, 8]), 'route://2', 'flag off unchanged')
	})

	it('multiview apply: the hole cell stays empty (no PLAY), the screen-2 cell plays route://2', async () => {
		const { applyMultiviewLayout } = require('../../src/engine/multiview-apply')
		const calls = []
		const stub = (name) => async (...args) => (calls.push([name, ...args]), { data: '' })
		const amcp = {}
		for (const n of ['play', 'mixerFill', 'mixerCommit', 'cgAdd', 'cgUpdate', 'cgClear', 'stop', 'raw', 'clear', 'info', 'batchSend']) amcp[n] = stub(n)
		const ctx = { config: on5867WithMultiview(), _ledTestPatternActive: true, log: () => {}, amcp }
		const layout = [
			{ id: 'pgm_0', type: 'pgm', label: 'PGM 1', x: 0, y: 0, w: 0.5, h: 0.5 },
			{ id: 'pgm_2', type: 'pgm', label: 'PGM 3', x: 0.5, y: 0, w: 0.5, h: 0.5 },
		]
		await applyMultiviewLayout({ n: 1, showOverlay: false, layout }, ctx, { infoXml: '<channel><stage></stage></channel>' })
		const plays = calls.filter((c) => c[0] === 'play' && /^route:/.test(String(c[3])))
		assert.deepEqual(plays.map((c) => [c[1], c[3]]), [[6, 'route://2']])
		assert.ok(!calls.some((c) => c.some((a) => /route:\/\/(null|undefined)/.test(String(a)))))
	})

	it('operator GUI cells of a hole resolve to no channel (skipped), screen 2 to its own', () => {
		const { resolveCellSourceChannel } = require('../../src/system/operator-gui-channel-geometry')
		const m = getChannelMap(on5867())
		assert.equal(resolveCellSourceChannel({ role: 'pgm', mainIndex: 0 }, m), null)
		assert.equal(resolveCellSourceChannel({ role: 'prv', mainIndex: 1 }, m), null)
		assert.equal(resolveCellSourceChannel({ role: 'prv', mainIndex: 2 }, m), 3)
	})

	it('routing-setup default multiview cells show the first screen here', async () => {
		const { setupMultiview } = require('../../src/config/routing-setup')
		const plays = []
		const self = { config: on5867WithMultiview(), amcp: { play: async (...a) => plays.push(a), mixerFill: async () => {}, mixerCommit: async () => {} } }
		await setupMultiview(self, [])
		assert.deepEqual(plays, [[6, 11, 'route://2'], [6, 12, 'route://3']])
	})

	it('live thumbnails, shm surfaces, compose cells: holes have no channel', () => {
		const { listLiveThumbnailChannels } = require('../../src/media/live-thumbnail-input-capture')
		const cm = buildChannelMap({ config: on5867() })
		const thumbs = listLiveThumbnailChannels(cm)
		for (const c of [2, 3, 4, 5]) assert.ok(thumbs.includes(c), `ch${c}`)
		assert.ok(!thumbs.includes(null) && !thumbs.includes(0))
		const { resolveRoleChannel } = require('../../src/system/video-surfaces')
		const m = getChannelMap(on5867())
		assert.equal(resolveRoleChannel('pgm1', m), null)
		assert.equal(resolveRoleChannel('prv2', m), null)
		assert.equal(resolveRoleChannel('pgm3', m), 2)
		assert.equal(resolveRoleChannel('prv3', m), 3)
	})

	it('mapping slices: a window on a hole screen sends no APPLY', () => {
		const { applyLineFor } = require('../../src/engine/mapping-slices-apply')
		const ctx = { config: on5867() }
		assert.equal(applyLineFor(ctx, { screenIndex: 1, consumerIndex: 3, window: {} }), null)
		assert.match(applyLineFor(ctx, { screenIndex: 3, consumerIndex: 3, window: {} }), /^APPLY 2-3 /)
	})
})

describe('WO-1029 C1b audio / zoom / streaming / art-net', () => {
	it('zoom feeds and the FFT picker offer only the screens here', () => {
		const { defaultFeeds } = require('../../src/zoom/zoom-audio')
		assert.deepEqual(defaultFeeds(on5867()).map((f) => [f.id, f.channel]), [['pgm:3', 2], ['prv:3', 3], ['pgm:4', 4], ['prv:4', 5]])
		const { describeFftSource, resolveFftSourceChannel } = require('../../src/audio/fft-channel-source')
		const ids = describeFftSource(on5867()).options.map((o) => o.id).filter((id) => id.startsWith('channel:'))
		assert.deepEqual(ids, ['channel:3:pgm', 'channel:3:prv', 'channel:4:pgm', 'channel:4:prv'])
		assert.equal(resolveFftSourceChannel(on5867(), { kind: 'channel', destination: 1, bus: 'pgm' }), null)
	})

	it('meters target the local buses only', () => {
		const { listMeterNullTargetChannels } = require('../../src/audio/meter-null-consumer')
		const chans = listMeterNullTargetChannels(on5867())
		assert.ok(chans.every((c) => Number.isInteger(c) && c >= 1))
		for (const c of [2, 3, 4, 5]) assert.ok(chans.includes(c))
	})

	it('audio preview on a hole screen: no bus, no route://null, no screen-1 stand-in', () => {
		const { resolveAudioPreviewChannel, resolveAudioPreviewDefaultRoute } = require('../../src/config/audio-preview')
		const cfg = on5867()
		const ap = { enabled: true, bus: 'preview_1', screenIndex: 1, defaultSource: 'program_1' }
		cfg.audioRouting = { ...(cfg.audioRouting || {}), audioPreview: ap }
		const m = getChannelMap(cfg)
		assert.equal(resolveAudioPreviewChannel(cfg, m), null)
		assert.equal(resolveAudioPreviewDefaultRoute(cfg, m), null)
		ap.defaultSource = 'program_3'
		assert.equal(resolveAudioPreviewDefaultRoute(cfg, getChannelMap(cfg)), 'route://2')
	})

	it('streaming stale-consumer cleanup targets screen 1’s PGM only when it is here', () => {
		const { createStreamingLifecycle } = require('../../src/bootstrap/streaming-lifecycle')
		const mk = (config) =>
			createStreamingLifecycle({ appCtx: { log: () => {} }, config: { ...config, streaming: { basePort: 9000 } }, getChannelMap }).streamingTargets
		assert.deepEqual(mk(on5867()).filter((t) => t.name === 'pgm_1'), [])
		assert.deepEqual(mk(off5867()).filter((t) => t.name === 'pgm_1').map((t) => t.channel), [2], 'flag off unchanged')
	})

	it('Art-Net border: a hole screen resolves to no channel (never screen 1 or channel 1)', () => {
		const { resolveProgramChannel } = require('../../src/artnet/artnet-slot-config')
		assert.equal(resolveProgramChannel({ config: on5867() }, 0), null)
		assert.equal(resolveProgramChannel({ config: on5867() }, 3), 4)
		assert.equal(resolveProgramChannel({ config: off5867() }, 0), 2)
		assert.equal(resolveProgramChannel({ config: off5867() }, 9), 2, 'flag off: past the screens → screen 1, as before')
	})
})

describe('WO-1029 C1b flag off: no change', () => {
	it('the same calls on the flag-off map answer as the legacy code did', () => {
		const m = getChannelMap(off5867())
		assert.equal(m.channelsWhereCabled, undefined)
		const { TimelineEngine } = require('../../src/engine/timeline-engine')
		const eng = new TimelineEngine({ config: clone(off5867()), log: () => {}, variables: {} })
		assert.deepEqual(eng._channelsFor({ preview: true, program: true, screenIdx: null }), [3, 2, 4, 6, 5, 8, 7])
		assert.deepEqual(eng._channelsFor({ preview: false, program: true, screenIdx: 1 }), [4])
		assert.deepEqual(HOLE_CHANNELS_OFF.every((c) => m.programChannels.includes(c) || m.previewChannels.includes(c)), true)
	})
})
