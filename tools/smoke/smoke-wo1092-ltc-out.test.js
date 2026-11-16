'use strict'

/**
 * WO-1092: LTC out — the generator checked bit for bit by an independent SMPTE 12M decoder (tools/ltc/ltc-biphase.js,
 * not libltc) at 23.976 / 24 / 25 / 29.97 DF / 29.97 NDF / 30, user bits, the 24 h wrap and channel placement; the new
 * settings normaliser; the LTC rate a timeline gets; the lock maths (align / slew); the channel-share ALSA config
 * builder (LTC and program audio on disjoint channels of one card) and its ~/.asoundrc block; the keeping-up check.
 * The libltc parts skip without libltc11.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { probeLibltc, HELPER } = require('../../src/timecode/ltc-helper')
const T = require('../../src/timecode/timecode-math')
const { frameBits, decodeLtc } = require('../ltc/ltc-biphase')
const { normalizeLtcConfig } = require('../../src/timecode/ltc-config')
const S = require('../../src/timecode/ltc-out-sync')
const share = require('../../src/timecode/ltc-share')
const { ltcChecks } = require('../../src/health/keeping-up-ltc')

const lib = probeLibltc()
const skip = lib.ok ? false : `libltc not available (${lib.hint})`

/** Encode with the real helper to stdout; return the PCM as interleaved Int16. */
function encode(args, seconds, channels = 1) {
	const bytes = 48000 * 2 * channels * seconds
	const cmd = `(sleep 3; echo quit) | python3 -I ${HELPER} encode --report 0 --channels ${channels} ${args} | head -c ${bytes}`
	const r = spawnSync('bash', ['-c', cmd], { timeout: 20000, maxBuffer: 64 * 1024 * 1024 })
	const b = r.stdout
	return new Int16Array(b.buffer, b.byteOffset, b.length >> 1)
}

function channelOf(pcm, channels, c) {
	const out = new Int16Array(pcm.length / channels)
	for (let i = 0; i < out.length; i++) out[i] = pcm[i * channels + c]
	return out
}

const CASES = [
	{ key: '23.976', fps: '23.976', rate: 24000 / 1001, start: '00:59:59:20', df: false },
	{ key: '24', fps: '24', rate: 24, start: '00:59:59:20', df: false },
	{ key: '25', fps: '25', rate: 25, start: '00:59:59:20', df: false },
	{ key: '29.97df', fps: '29.97', rate: 30000 / 1001, start: '00:00:59:25', df: true },
	{ key: '29.97ndf', fps: '29.97', rate: 30000 / 1001, start: '00:00:59:25', df: false, extra: '--df 0' },
	{ key: '30', fps: '30', rate: 30, start: '00:59:59:25', df: false },
]

describe('WO-1092: generator bit-exact against an independent decoder', { skip }, () => {
	for (const c of CASES) {
		it(`${c.key}: every frame is the next label, bit for bit (sync, parity, DF flag), across a minute/hour boundary`, () => {
			const mode = T.fpsMode(c.key)
			const frames = decodeLtc(encode(`--fps ${c.fps} --start ${c.start} ${c.extra || ''}`, 1.5), { fps: c.rate })
			assert.ok(frames.length >= Math.floor(c.rate * 1.5) - 2, `decoded ${frames.length}`)
			let n = T.tcToFrames(T.parseTc(c.start), mode)
			for (const f of frames) {
				const want = T.framesToTc(n, mode)
				assert.deepEqual([f.h, f.m, f.s, f.f], [want.h, want.m, want.s, want.f], `frame ${n}`)
				assert.deepEqual([...f.bits], [...frameBits(want, { fps: c.rate, df: c.df })], `bits of ${f.tc}`)
				assert.equal(f.parityOk, true)
				n++
			}
			if (c.df) assert.ok(frames.some((f) => f.tc === '00:01:00;02') && !frames.some((f) => /00:01:00;0[01]/.test(f.tc)))
			if (c.key === '29.97ndf') assert.ok(frames.some((f) => f.tc === '00:01:00:00'), 'NDF labels do not skip')
		})
	}
	it('user bits land in groups 1…8 (first hex digit = group 1), parity still even', () => {
		const frames = decodeLtc(encode('--fps 25 --start 10:00:00:00 --userbits 1234ABCD', 0.5), { fps: 25 })
		assert.ok(frames.length >= 10)
		for (const f of frames) {
			assert.equal(f.userBits, '1234abcd')
			assert.deepEqual([...f.bits], [...frameBits(f, { fps: 25, userBits: '1234ABCD' })])
		}
	})
	it('24 h wrap: 23:59:59:24 → 00:00:00:00', () => {
		const tcs = decodeLtc(encode('--fps 25 --start 23:59:59:23', 0.4), { fps: 25 }).map((f) => f.tc)
		assert.deepEqual(tcs.slice(0, 3), ['23:59:59:23', '23:59:59:24', '00:00:00:00'])
	})
	it('a pair of a multichannel device: the same LTC on channels 7 and 8, silence on 1…6', () => {
		const pcm = encode('--fps 25 --channel 7,8', 0.5, 8)
		const rms = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => {
			const m = channelOf(pcm, 8, c)
			return Math.sqrt(m.reduce((a, v) => a + v * v, 0) / m.length)
		})
		assert.deepEqual(rms.slice(0, 6), [0, 0, 0, 0, 0, 0])
		assert.ok(rms[6] > 3000 && rms[6] === rms[7], `LTC on 7+8 (${rms[6]}, ${rms[7]})`)
		const a = decodeLtc(channelOf(pcm, 8, 6), { fps: 25 }).map((f) => f.tc)
		assert.deepEqual(a, decodeLtc(channelOf(pcm, 8, 7), { fps: 25 }).map((f) => f.tc))
		assert.equal(a[0], '00:00:00:00')
	})
	it('level: -18 dBFS peak by default, the volume setting moves it', () => {
		const peak = (v) => 20 * Math.log10(Math.max(...encode(`--fps 25 --volume ${v}`, 0.3).map(Math.abs)) / 32768)
		assert.ok(Math.abs(peak(-18) + 18) < 0.5, `${peak(-18)}`)
		assert.ok(Math.abs(peak(-6) + 6) < 0.5, `${peak(-6)}`)
	})
})

describe('WO-1092: settings', () => {
	it('defaults: follow the timeline rate, no latency trim, silence while paused, no user bits, mono on channel 1', () => {
		const o = normalizeLtcConfig({}).output
		assert.deepEqual({ fps: o.fps, latencyMs: o.latencyMs, whenPaused: o.whenPaused, userBits: o.userBits, pair: o.pair, channel: o.channel },
			{ fps: 'timeline', latencyMs: 0, whenPaused: 'silence', userBits: '', pair: false, channel: 1 })
		assert.equal('leadMs' in o, false, 'leadMs (an internal pipeline guess) is gone')
	})
	it('clamps and validates', () => {
		const o = normalizeLtcConfig({ output: { channels: 8, channel: 8, pair: true, fps: '29.97ndf', latencyMs: 5000, whenPaused: 'x',
			userBits: '12ab34cd', source: 'test' } }).output
		assert.equal(o.channel, 7, 'a pair starting on the last channel moves down one')
		assert.equal(o.fps, '29.97ndf')
		assert.equal(o.latencyMs, 1000)
		assert.equal(o.whenPaused, 'silence')
		assert.equal(o.userBits, '12AB34CD')
		assert.equal(o.source, 'test')
		assert.equal(normalizeLtcConfig({ output: { channels: 1, pair: true } }).output.pair, false, 'no pair on a mono device')
		assert.equal(normalizeLtcConfig({ output: { userBits: 'nothex' } }).output.userBits, '')
		assert.equal(normalizeLtcConfig({ output: { fps: '50' } }).output.fps, 'timeline', 'LTC has no 50: the timeline mapping handles it')
	})
	it('the owner config (Pro device, mono, 25) survives unchanged', () => {
		const o = normalizeLtcConfig({ fps: '25', output: { enabled: true, device: 'plughw:CARD=Pro,DEV=0', channels: 1, source: 'timeline' } })
		assert.deepEqual([o.fps, o.output.enabled, o.output.device, o.output.channels, o.output.source], ['25', true, 'plughw:CARD=Pro,DEV=0', 1, 'timeline'])
	})
	it('LTC rate for a timeline rate: 50 → 25, 59.94 → 29.97 DF, 60 → 30, 23.976 stays', () => {
		const m = { 23.976: '23.976', 24: '24', 25: '25', 29.97: '29.97df', 30: '30', 50: '25', 59.94: '29.97df', 60: '30', 48: '24', 0: '25' }
		for (const [r, k] of Object.entries(m)) assert.equal(T.ltcModeForRate(r), k, `${r}`)
		assert.equal(T.ltcModeForRate(29.97, true), '29.97ndf')
	})
	it('LTC out follows the on-air LTC timeline rate unless forced', () => {
		const { ltcOutMode } = require('../../src/timecode/ltc-service')
		const eng = (tl) => ({ _airTimelineId: 'a', get: () => tl })
		const cfg = (fps) => normalizeLtcConfig({ fps: '25', output: { fps } })
		assert.equal(ltcOutMode(cfg('timeline'), eng({ fps: 50, ltcOut: true })), '25')
		assert.equal(ltcOutMode(cfg('timeline'), eng({ fps: 59.94, ltcOut: true })), '29.97df')
		assert.equal(ltcOutMode(cfg('timeline'), eng({ fps: 30, ltcOut: false })), '25', 'not an LTC timeline: the shared LTC rate')
		assert.equal(ltcOutMode(cfg('24'), eng({ fps: 50, ltcOut: true })), '24', 'forced')
	})
})

describe('WO-1092: lock maths', () => {
	const m25 = T.fpsMode('25')
	const pb = (position, playing = true) => ({ playing, position })
	it('expected frame at play time: the playhead moved on to `at`; latency delays the LTC', () => {
		assert.equal(S.expectedFramesAt({ source: 'timeline' }, m25, 0, pb(1000), 5000, 5040), 26)
		assert.equal(S.expectedFramesAt({ source: 'timeline', latencyMs: 40 }, m25, 0, pb(1000), 5000, 5040), 25)
		assert.equal(S.expectedFramesAt({ source: 'timeline' }, m25, 0, pb(1000, false), 5000), null)
		assert.equal(S.expectedFramesAt({ source: 'test' }, m25, 90000, null, 5000, 5000, 4000), 90025, 'test clock runs from the offset')
	})
	it('align puts the next whole frame on its exact epoch', () => {
		const a = S.alignCommand({ source: 'timeline' }, m25, 0, pb(1000), 1000, 1030) // 1030 ms = frame 25.75
		assert.equal(a.line, 'align 00:00:01:01 1040.00')
		assert.equal(a.frames, 26)
		const b = S.alignCommand({ source: 'timeline' }, T.fpsMode('29.97df'), 0, pb(600000), 0, 0)
		assert.match(b.line, /^align 00:10:00:01 /, 'drop-frame labels (10 min = 17982 frames)')
	})
	it('decide: a whole frame → align; a steady few ms → one slew of that size; jitter inside 1.5 ms → nothing', () => {
		const h = []
		assert.equal(S.decide(1.2, h, m25).action, 'align')
		for (const e of [0.1, 0.1]) assert.equal(S.decide(e, h, m25).action, 'none')
		assert.deepEqual(S.decide(0.1, h, m25), { action: 'slew', samples: 192, driftMs: 4 }, 'LTC 4 ms early → stretch 192 samples')
		const q = []
		for (const e of [0.02, -0.03, 0.01, 0.02]) assert.equal(S.decide(e, q, m25).action, 'none')
	})
	it('errors across the 24 h wrap are small', () => {
		assert.equal(S.errorFrames(0, T.framesPerDay(m25) - 1, m25), 1)
	})
	it('a seek is a playhead jump, a steady play is not', () => {
		const a = { now: 0, pb: pb(1000) }
		assert.equal(S.playheadJumped(a, { now: 40, pb: pb(1040) }, m25), false)
		assert.equal(S.playheadJumped(a, { now: 40, pb: pb(9000) }, m25), true)
		assert.equal(S.playheadJumped(a, { now: 40, pb: pb(1000, false) }, m25), true)
	})
})

const CARDS = ` 0 [PCH            ]: HDA-Intel - HDA Intel PCH
                      HDA Intel PCH at 0x485e220000 irq 244
 1 [NVidia         ]: HDA-Intel - HDA NVidia
                      HDA NVidia at 0x74080000 irq 17
`
const prog = (layout = 'stereo', dev = 'hw:0,0') => ({ audioOutputs: [{ id: 'audio_1', label: 'Audio 1', type: 'portaudio', enabled: true, deviceName: dev, channelLayout: layout }] })

describe('WO-1092: LTC on a channel / pair of a multichannel output', () => {
	it('parses card lines and hw names', () => {
		assert.deepEqual(share.parseCards(CARDS).map((c) => [c.index, c.id, c.name]), [[0, 'PCH', 'HDA Intel PCH'], [1, 'NVidia', 'HDA NVidia']])
		assert.deepEqual(share.parseAlsaHw('plughw:CARD=Pro,DEV=0'), { card: 'Pro', dev: 0 })
		assert.deepEqual(share.parseAlsaHw('hw:1,7'), { card: '1', dev: 7 })
	})
	it('a card of its own: plughw at the device width, LTC on the chosen positions', () => {
		const t = share.resolveLtcTarget({ device: 'plughw:CARD=NVidia,DEV=8', channel: 7, pair: true, channels: 8 }, prog(), CARDS, { channels: 8 })
		assert.deepEqual([t.ok, t.share, t.pcm, t.channels, t.positions, t.present], [true, false, 'plughw:CARD=NVidia,DEV=8', 8, [7, 8], true])
	})
	it('a missing card is "not present" (no process gets spawned for it)', () => {
		const t = share.resolveLtcTarget({ device: 'plughw:CARD=Pro,DEV=0', channel: 1, channels: 1 }, prog(), CARDS)
		assert.equal(t.present, false)
	})
	it('the program card: two dshare PCMs on one slave, disjoint channels, one ipc_key', () => {
		const t = share.resolveLtcTarget({ device: 'program', channel: 5, pair: true, channels: 6 }, prog(), CARDS, { channels: 6 })
		assert.deepEqual([t.ok, t.share, t.pcm, t.progPcm, t.channels, t.positions, t.ltcChannels], [true, true, 'hcg_ltc_PCH_0', 'hcg_prog_PCH_0', 2, [1, 2], [5, 6]])
		const keys = [...t.block.matchAll(/ipc_key (\d+)/g)].map((m) => m[1])
		assert.equal(keys.length, 2)
		assert.equal(keys[0], keys[1], 'both sides share one segment (dshare keeps the channel mask there)')
		assert.match(t.block, /pcm_slave\.hcg_slave_PCH_0 \{\n\tpcm "hw:CARD=PCH,DEV=0"\n\tchannels 6\n\trate 48000/)
		assert.match(t.block, /pcm\.hcg_prog_PCH_0 [^]*bindings \{ 0 0 1 1 \}[^]*ttable \{ 0\.0 1 1\.1 1 \}/)
		assert.match(t.block, /pcm\.hcg_ltc_PCH_0 [^]*bindings \{ 0 4 1 5 \}/)
		assert.deepEqual(t.silencedProgram, [])
	})
	it('the same card picked by name counts as the program card too', () => {
		const t = share.resolveLtcTarget({ device: 'plughw:CARD=PCH,DEV=0', channel: 3, channels: 6 }, prog(), CARDS, { channels: 6 })
		assert.equal(t.share, true)
		assert.equal(t.pcm, 'hcg_ltc_PCH_0')
	})
	it('LTC on a program channel: that program channel goes silent (said so), all of it: refused', () => {
		const t = share.resolveLtcTarget({ device: 'program', channel: 2, channels: 2 }, prog(), CARDS, { channels: 2 })
		assert.deepEqual(t.silencedProgram, [2])
		assert.match(t.block, /bindings \{ 0 0 \}[^]*ttable \{ 0\.0 1 \}/)
		const r = share.resolveLtcTarget({ device: 'program', channel: 1, pair: true, channels: 2 }, prog(), CARDS, { channels: 2 })
		assert.equal(r.ok, false)
		assert.match(r.problem, /replace all of Audio 1/)
	})
	it('casparcg.config: the program output plays through the shared PCM only while LTC shares its card', () => {
		const cfg = (ltc) => ({ ...prog(), ltc: { output: { enabled: true, sink: 'alsa', channels: 6, ...ltc } } })
		const out = prog().audioOutputs[0]
		assert.equal(share.programDeviceName(cfg({ device: 'program', channel: 3 }), out, CARDS), 'hcg_prog_PCH_0')
		assert.equal(share.programDeviceName(cfg({ device: 'plughw:CARD=NVidia,DEV=8', channel: 3 }), out, CARDS), 'hw:0,0')
		assert.equal(share.programDeviceName(cfg({ device: 'program', channel: 3, enabled: false }), out, CARDS), 'hw:0,0')
	})
	it('~/.asoundrc: the share block is merged next to hand-written PCMs and replaced in place', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1092-'))
		const file = path.join(dir, 'asoundrc')
		const prev = process.env.HIGHASCG_ASOUNDRC
		process.env.HIGHASCG_ASOUNDRC = file
		try {
			const { writeShareBlock } = require('../../src/timecode/ltc-share-io')
			fs.writeFileSync(file, 'pcm.sc60mon {\n type plug\n}\n')
			assert.equal(writeShareBlock('pcm.a { type null }\n'), true)
			assert.equal(writeShareBlock('pcm.a { type null }\n'), false, 'unchanged: no write')
			writeShareBlock('pcm.b { type null }\n')
			const text = fs.readFileSync(file, 'utf8')
			assert.ok(text.startsWith('pcm.sc60mon {'))
			assert.equal(text.split(share.BLOCK_BEGIN).length, 2)
			assert.match(text, /pcm\.b/)
			assert.doesNotMatch(text, /pcm\.a/)
		} finally {
			if (prev == null) delete process.env.HIGHASCG_ASOUNDRC
			else process.env.HIGHASCG_ASOUNDRC = prev
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe('WO-1092: keeping-up "LTC out"', () => {
	it('off or healthy: no alarm; missing / busy / under-runs / not locked: amber with words', () => {
		assert.deepEqual(ltcChecks({ ltc: null }), [])
		assert.deepEqual(ltcChecks({ ltc: { state: 'off' } }), [])
		assert.equal(ltcChecks({ ltc: { state: 'running', tc: '01:00:00:00', driftMs: 0.4 } })[0].level, 0)
		const m = ltcChecks({ ltc: { state: 'missing', error: 'plughw:CARD=Pro,DEV=0 is not connected' } })[0]
		assert.equal(m.level, 1)
		assert.equal(m.label, 'LTC out: device not connected')
		assert.equal(ltcChecks({ ltc: { state: 'busy' } })[0].label, 'LTC out: device in use by another program')
		assert.match(ltcChecks({ ltc: { state: 'running', underrunsRecent: 2 } })[0].label, /dropping out \(2×/)
		assert.equal(ltcChecks({ ltc: { state: 'running', driftRelocatesRecent: 3 } })[0].label, 'LTC out not locked')
		assert.equal(ltcChecks({ ltc: { state: 'running', driftRelocatesRecent: 1 } })[0].level, 0)
	})
})
