'use strict'

/**
 * WO-974: LTC reader lock states and the timeline chase decision; config normalizer; settings persistence
 * (memory settings-post-newconfig-hand-listed: a section left out of newConfig silently reverts); the live-audio
 * bridge LTC tee.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const { LtcLock, decideChase, chaseOps } = require('../../src/timecode/ltc-lock')
const { normalizeLtcConfig } = require('../../src/timecode/ltc-config')

function feed(lock, from, count, t0, frameMs = 40) {
	for (let i = 0; i < count; i++) lock.push(from + i, t0 + i * frameMs)
	return t0 + (count - 1) * frameMs
}

describe('WO-974: LtcLock', () => {
	it('acquires, locks on consecutive frames, freewheels, then loses', () => {
		const l = new LtcLock({ fps: 25, lockFrames: 4, dropoutMs: 400, freewheelMs: 2000 })
		assert.equal(l.state(0), 'none')
		const t = feed(l, 1000, 3, 0)
		assert.equal(l.state(t), 'acquiring')
		l.push(1003, t + 40)
		assert.equal(l.state(t + 40), 'locked')
		assert.equal(l.snapshot(t + 40).tc, '00:00:40:04', 'at arrival the frame has ended: position = frame + 1')
		assert.equal(l.state(t + 40 + 1000), 'freewheel')
		assert.equal(Math.floor(l.positionFrames(t + 40 + 1000)), 1004 + 25, 'freewheel extrapolates at fps')
		assert.equal(l.state(t + 40 + 2500), 'lost')
	})
	it('a jump restarts the consecutive run; a repeating frame is `still`', () => {
		const l = new LtcLock({ fps: 25 })
		let t = feed(l, 0, 6, 0)
		l.push(5000, t + 40)
		assert.equal(l.state(t + 40), 'acquiring')
		assert.equal(l.jumps, 1)
		t = feed(l, 5001, 4, t + 80)
		assert.equal(l.state(t), 'locked')
		for (let i = 1; i <= 5; i++) l.push(5004, t + i * 40)
		assert.equal(l.state(t + 200), 'still')
		assert.equal(l.positionFrames(t + 200), 5004)
	})
	it('the stale frame a decoder hands over after silence does not re-lock (box 06.11 campaign)', () => {
		const l = new LtcLock({ fps: 25, lockFrames: 4, dropoutMs: 400, freewheelMs: 2000 })
		const t = feed(l, 1000, 10, 0)
		assert.equal(l.state(t), 'locked')
		// 1 s of silence, then the frame from before it arrives (one step after the last): acquisition restarts
		l.push(1010, t + 1000)
		assert.equal(l.state(t + 1000), 'acquiring', 'a stale +1 frame after a gap must not continue the run')
		l.push(1035, t + 1040)
		const t2 = feed(l, 1036, 3, t + 1080)
		assert.equal(l.state(t2), 'locked', 'four fresh consecutive frames lock again')
		assert.equal(l.snapshot(t2).frames, 1039)
	})
	it('locks across midnight', () => {
		const l = new LtcLock({ fps: 25 })
		const t = feed(l, 25 * 86400 - 2, 5, 0)
		assert.equal(l.state(t), 'locked')
	})
})

describe('WO-974: decideChase', () => {
	const cfg = { fps: 25, thresholdFrames: 3, now: 10000 }
	const pb = (position, playing) => ({ position, playing, duration: 60000 })
	it('starts a paused timeline where the LTC is (minus offset)', () => {
		const d = decideChase({ state: 'locked', frames: 25 * 3600 + 250 }, pb(0, false), { ...cfg, offsetFrames: 25 * 3600 })
		assert.deepEqual(d, { action: 'play', ms: 10000, reason: 'ltc_running' })
	})
	it('free-runs inside the threshold, locates on a larger jump', () => {
		assert.equal(decideChase({ state: 'locked', frames: 250 }, pb(10080, true), cfg).action, 'none')
		const d = decideChase({ state: 'locked', frames: 250 }, pb(12000, true), cfg)
		assert.equal(d.action, 'seek')
		assert.equal(d.ms, 10000)
		assert.equal(decideChase({ state: 'locked', frames: 250 }, pb(12000, true), { ...cfg, lastActionAt: 9900 }).action, 'none', 'actions are rate-limited')
	})
	it('freewheel keeps running; loss pauses only a chase-started timeline', () => {
		assert.equal(decideChase({ state: 'freewheel', frames: 250 }, pb(10000, true), cfg).action, 'none')
		assert.equal(decideChase({ state: 'lost', frames: 250 }, pb(10000, true), { ...cfg, engaged: true }).action, 'pause')
		assert.equal(decideChase({ state: 'lost', frames: 250 }, pb(10000, true), cfg).action, 'none')
		assert.equal(decideChase({ state: 'lost', frames: 250 }, pb(10000, true), { ...cfg, engaged: true, stopOnLoss: false }).action, 'none')
	})
	it('a parked source pauses and parks the timeline on its frame', () => {
		assert.equal(decideChase({ state: 'still', frames: 250 }, pb(10000, true), cfg).action, 'pause')
		assert.deepEqual(decideChase({ state: 'still', frames: 250 }, pb(5000, false), cfg), { action: 'seek', ms: 10000, reason: 'ltc_still' })
	})
	it('LTC before the offset or past the end never starts the timeline', () => {
		assert.equal(decideChase({ state: 'locked', frames: 10 }, pb(0, false), { ...cfg, offsetFrames: 100 }).action, 'none')
		assert.equal(decideChase({ state: 'locked', frames: 25 * 70 }, pb(0, false), cfg).action, 'none')
		assert.equal(decideChase({ state: 'locked', frames: 25 * 70 }, pb(59000, true), { ...cfg, engaged: true }).action, 'pause')
	})
	it('targets the fractional LTC position and reports the chase error', () => {
		const d = decideChase({ state: 'locked', frames: 250, pos: 250.5 }, pb(0, false), cfg)
		assert.equal(d.ms, 10020, 'floor(frames) alone lagged the reader by half a frame on average')
		assert.deepEqual(decideChase({ state: 'locked', frames: 250, pos: 250 }, pb(10012, true), cfg), { action: 'none', errorMs: 12 })
		assert.equal(decideChase({ state: 'locked', frames: 250, pos: 250 }, pb(9800, true), cfg).errorMs, -200)
	})
	it('a resume off the parked frame seeks first (engine RESUME ignores the from-position)', () => {
		assert.deepEqual(chaseOps({ action: 'play' }, pb(45000, false), 45218, 25), [['seek', 45218], ['play', 45218]])
		assert.deepEqual(chaseOps({ action: 'play' }, pb(45010, false), 45018, 25), [['play', 45018]], 'within half a frame: plain resume')
		assert.deepEqual(chaseOps({ action: 'pause' }, pb(1, true), 45000, 25), [['pause'], ['seek', 45000]])
		assert.deepEqual(chaseOps({ action: 'pause' }, pb(1, true), undefined, 25), [['pause']])
		assert.deepEqual(chaseOps({ action: 'none' }, pb(1, true), 5, 25), [])
	})
	it('preroll: a locate parks, seeks ahead and resumes when the LTC gets there', () => {
		const o = { prerollMs: 500 }
		assert.deepEqual(chaseOps({ action: 'seek' }, pb(1000, true), 40000, 25, o), [['pause'], ['seek', 40500], ['wait', 500], ['play']])
		assert.deepEqual(chaseOps({ action: 'play' }, pb(45000, false), 45200, 25, o), [['seek', 45700], ['wait', 500], ['play']])
		assert.deepEqual(chaseOps({ action: 'play' }, pb(0, false), 5000, 25, { prerollMs: 500 }), [['seek', 5500], ['wait', 500], ['play']], 'stopped: the seek loads it paused')
		assert.deepEqual(chaseOps({ action: 'seek' }, pb(1000, false), 40000, 25, o), [['seek', 40000]], 'a parked timeline just seeks')
		assert.deepEqual(chaseOps({ action: 'pause' }, pb(1, true), 45000, 25, o), [['pause'], ['seek', 45000]])
	})
	it('latency is part of the target: no re-seek loop once applied', () => {
		const c = { ...cfg, latencyMs: 500 }
		const d = decideChase({ state: 'locked', frames: 250, pos: 250 }, pb(0, false), c)
		assert.equal(d.ms, 10500)
		assert.equal(decideChase({ state: 'locked', frames: 250, pos: 250 }, pb(10500, true), c).action, 'none', 'the timeline at LTC + latency is in sync')
	})
	it('29.97 DF: positions are real time, not labels', () => {
		const d = decideChase({ state: 'locked', frames: 900 }, pb(0, false), { ...cfg, fps: '29.97df' })
		assert.equal(Math.round(d.ms), 30030)
	})
})

describe('WO-974: LTC out judges an encoder report at its own time', () => {
	const { targetFramesAt } = require('../../src/timecode/ltc-output')
	const { fpsMode } = require('../../src/timecode/timecode-math')
	const m30 = fpsMode('30')
	const cfg = { source: 'timeline', leadMs: 60 }
	it('a report read 90 ms late (event-loop stall) is not a 2-frame error (box 06.11: one repeated frame)', () => {
		const pb = { playing: true, position: 70000 }
		const now = 1e12
		const late = targetFramesAt(cfg, m30, 0, pb, now)
		const atReport = targetFramesAt(cfg, m30, 0, pb, now, now - 90)
		assert.ok(late - atReport >= 2, 'judged against NOW the healthy encoder looks 2+ frames behind')
		assert.equal(atReport, Math.floor(((70000 - 90 + 60) * 30) / 1000))
	})
	it('silence while paused; the age is capped', () => {
		assert.equal(targetFramesAt(cfg, m30, 0, { playing: false, position: 5000 }, 1e12, 1e12 - 50), null)
		const pb = { playing: true, position: 5000 }
		assert.equal(targetFramesAt(cfg, m30, 0, pb, 1e12, 1e12 - 60000), targetFramesAt(cfg, m30, 0, pb, 1e12, 1e12 - 1000))
	})
})

describe('WO-974: config', () => {
	it('everything is off by default and garbage is clamped', () => {
		const c = normalizeLtcConfig(undefined)
		assert.equal(c.input.enabled, false)
		assert.equal(c.output.enabled, false)
		assert.equal(c.fps, '25')
		const g = normalizeLtcConfig({ fps: 29.97, input: { source: 'x', channels: 4, channel: 9, chase: { offset: 'nope' } }, output: { volumeDb: 12 } })
		assert.equal(g.fps, '29.97df')
		assert.equal(g.input.source, 'alsa')
		assert.equal(g.input.channel, 4)
		assert.equal(g.input.chase.offset, '00:00:00:00')
		assert.equal(g.output.volumeDb, 0)
	})
	it('an invalid timecode edit keeps the previous offset (RULES: never salvage, never reset)', () => {
		const prev = normalizeLtcConfig({ output: { offset: '01:00:00:00' } })
		assert.equal(normalizeLtcConfig({ output: { offset: '1:00' } }, prev).output.offset, '01:00:00:00')
		assert.equal(normalizeLtcConfig({ output: { offset: '02:00:00:00' } }, prev).output.offset, '02:00:00:00')
	})
	it('defaults-core carries the section (one reset root)', () => {
		assert.deepEqual(require('../../src/config/defaults').ltc, normalizeLtcConfig({}))
	})
})

describe('WO-974: settings POST persists ltc', () => {
	const defaults = require('../../src/config/defaults')
	const { handlePost } = require('../../src/api/settings-post')
	it('an ltc patch reaches the saved config, merged over the stored section', async () => {
		const saved = []
		const config = { streaming: {}, ...JSON.parse(JSON.stringify(defaults)) }
		const ctx = { config, configManager: { get: () => JSON.parse(JSON.stringify(defaults)), save: (c) => saved.push(c) }, log: () => {} }
		const res = await handlePost('/api/settings', JSON.stringify({ ltc: { fps: '30', output: { enabled: true, device: 'plughw:3,0' } } }), ctx)
		assert.equal(res.status, 200)
		assert.equal(saved[0].ltc.fps, '30')
		assert.equal(saved[0].ltc.output.enabled, true)
		assert.equal(saved[0].ltc.output.device, 'plughw:3,0')
		assert.equal(saved[0].ltc.output.leadMs, 60, 'untouched fields keep defaults')
		await handlePost('/api/settings', JSON.stringify({ usbIngest: { enabled: true } }), ctx)
		assert.equal(saved[1].ltc.output.device, 'plughw:3,0', 'an unrelated save keeps it')
	})
	it('a save that re-posts an unchanged ltc section does not restart LTC (the web modal re-posts …prevAll)', async () => {
		let restarts = 0
		const config = { streaming: {}, ...JSON.parse(JSON.stringify(defaults)) }
		const ctx = { config, configManager: { get: () => JSON.parse(JSON.stringify(defaults)), save: () => {} }, log: () => {}, _ltcService: { restart: () => restarts++ } }
		await handlePost('/api/settings', JSON.stringify({ ltc: { output: { enabled: true } } }), ctx)
		assert.equal(restarts, 1, 'a real change restarts')
		await handlePost('/api/settings', JSON.stringify({ usbIngest: { enabled: true }, ltc: JSON.parse(JSON.stringify(config.ltc)) }), ctx)
		assert.equal(restarts, 1, 'the same section again: the chase lock and LTC out keep running')
	})
	it('GET /api/settings returns the section (the clients hydrate their Timecode pane from it)', async () => {
		const { handleGet } = require('../../src/api/settings-get')
		const config = { streaming: {}, ...JSON.parse(JSON.stringify(defaults)), ltc: { fps: '24' } }
		const res = await handleGet('/api/settings', { config, log: () => {} })
		assert.equal(JSON.parse(res.body).ltc.fps, '24')
	})
})

describe('WO-974: live-audio bridge LTC tee', () => {
	const { buildLiveAudioBridgeFfmpegArgs } = require('../../src/audio/live-audio-bridge')
	it('only the configured slot tees, as raw mono s16le of the chosen channel to 52240+slot', () => {
		const ltc = normalizeLtcConfig({ input: { enabled: true, source: 'bridge', slot: 1, channel: 2 } })
		const a = buildLiveAudioBridgeFfmpegArgs({ ltc }, 1, 'hw:2,0').join(' ')
		assert.match(a, /-af pan=mono\|c0=c1,aresample=48000 -c:a pcm_s16le -f s16le udp:\/\/127\.0\.0\.1:52241\?pkt_size=1316/)
		assert.doesNotMatch(buildLiveAudioBridgeFfmpegArgs({ ltc }, 2, 'hw:3,0').join(' '), /5224\d/)
		const off = normalizeLtcConfig({ input: { enabled: false, source: 'bridge', slot: 1 } })
		assert.doesNotMatch(buildLiveAudioBridgeFfmpegArgs({ ltc: off }, 1, 'hw:2,0').join(' '), /5224\d/)
	})
})

describe('WO-974 incident 06.11: a FIFO with nobody on the other end never blocks node', () => {
	const fs = require('fs')
	const os = require('os')
	const path = require('path')
	const { spawnSync } = require('child_process')
	it('reader with no writer + sink with no reader: stop() returns and the process exits by itself', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo974-fifo-'))
		try {
			const a = path.join(dir, 'in.fifo')
			const b = path.join(dir, 'out.fifo')
			assert.equal(spawnSync('mkfifo', [a, b]).status, 0)
			const root = path.join(__dirname, '..', '..')
			const script = `
				const { createLtcInput } = require(${JSON.stringify(path.join(root, 'src/timecode/ltc-input'))})
				const { createLtcOutput } = require(${JSON.stringify(path.join(root, 'src/timecode/ltc-output'))})
				const { normalizeLtcConfig } = require(${JSON.stringify(path.join(root, 'src/timecode/ltc-config'))})
				const c = normalizeLtcConfig({ input: { source: 'fifo', path: ${JSON.stringify(a)} },
					output: { source: 'clock', sink: 'fifo', path: ${JSON.stringify(b)} } })
				const i = createLtcInput({ cfg: c.input, fps: 25 }); i.start()
				const o = createLtcOutput({ cfg: c.output, fps: 25 }); o.start()
				// a node-side open() of either FIFO would park a libuv worker here for good
				require('fs').readFile(__filename, () => {})
				setTimeout(() => { i.stop(); o.stop(); console.log('stopped') }, 400)`
			const t0 = Date.now()
			const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 8000 })
			assert.equal(r.signal, null, 'the process exited by itself (not killed by the 8 s timeout)')
			assert.match(r.stdout, /stopped/)
			assert.ok(Date.now() - t0 < 5000, `exited in ${Date.now() - t0} ms`)
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})
