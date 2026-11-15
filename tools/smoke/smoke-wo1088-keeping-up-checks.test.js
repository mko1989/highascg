'use strict'
/**
 * WO-1088: the keeping-up checks — thresholds per data source, and the normal states that must NOT alarm (nothing
 * playing, a paused shm layer, an output the screen gate never started, preshow, Caspar restarting, an idle box,
 * DeckLink inputs without a cable, detection off, a camera slower than the detection rate).
 * The OSC side is fed through the real OscState (int64 counters arrive as osc.js Long objects).
 */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const osc = require('osc')
const { OscState } = require('../../src/osc/osc-state')
const { evaluate } = require('../../src/health/keeping-up-checks')
const { parseNvLine, channelNames } = require('../../src/health/keeping-up-service')
const { KeepingUpModel } = require('../../src/health/keeping-up-model')

const pkt = (address, args) => osc.readPacket(osc.writePacket({ address, args }), { metadata: false, unpackSingleArgs: true })
const L = (n) => ({ type: 'h', value: { high: 0, low: n } })
const I = (n) => ({ type: 'i', value: n })
const S = (v) => ({ type: 's', value: v })

/** One Caspar tick of ch2 (screen 600 + portaudio 501 + shm preview 741 + the Visuals shm layer 1) into an OscState. */
function tick(st, c) {
	st.handleOscMessage(pkt('/channel/2/framerate', [I(50), I(1)]))
	st.handleOscMessage(pkt('/channel/2/output/port/600/consumer', [S('screen')]))
	st.handleOscMessage(pkt('/channel/2/output/port/600/screen/presented_frames', [L(c.presented)]))
	st.handleOscMessage(pkt('/channel/2/output/port/600/screen/dropped_frames', [L(c.dropped || 29)]))
	st.handleOscMessage(pkt('/channel/2/output/port/501/consumer', [S('portaudio')]))
	st.handleOscMessage(pkt('/channel/2/output/port/501/fifo-underruns', [I(c.underruns || 246)]))
	st.handleOscMessage(pkt('/channel/2/output/port/741/consumer', [S('shm')]))
	st.handleOscMessage(pkt('/channel/2/output/port/741/shm/published', [L(c.published ?? c.presented)]))
	st.handleOscMessage(pkt('/channel/2/output/port/741/shm/dropped', [L(c.shmDropped || 2)]))
	if (c.shm != null) {
		st.handleOscMessage(pkt('/channel/2/stage/layer/1/foreground/producer', [S(c.producer || 'shm')]))
		st.handleOscMessage(pkt('/channel/2/stage/layer/1/foreground/paused', [{ type: c.paused ? 'T' : 'F', value: !!c.paused }]))
		st.handleOscMessage(pkt('/channel/2/stage/layer/1/foreground/shm/name', [S('visuals')]))
		st.handleOscMessage(pkt('/channel/2/stage/layer/1/foreground/shm/frames', [L(c.shm)]))
	}
}

/** Two OSC snapshots 2 s apart → a sample (layers carry their producer type / paused like the service adds). */
function sampleFrom(a, b, extra = {}) {
	let t = 1000000
	const st = new OscState(() => {}, { emitIntervalMs: 1e9 })
	st.health._now = () => t
	tick(st, a)
	const snap = () => {
		const s = st.health.snapshot()
		for (const l of s.layers) Object.assign(l, st.layerState(l.ch, l.layer) || {})
		return s
	}
	const oscPrev = snap()
	t += 2000
	tick(st, b)
	const s = { at: t, caspar: { connected: true }, oscEnabled: true, osc: snap(), oscPrev, names: { 2: 'Dioda' }, ringFps: { visuals: 50 }, ...extra }
	st.destroy()
	return s
}

const byKey = (results) => Object.fromEntries(results.map((r) => [r.key, r]))

describe('WO-1088 keeping-up checks', () => {
	it('a healthy channel: everything ok, plain numbers against the channel rate', () => {
		const r = byKey(evaluate(sampleFrom({ presented: 1000, shm: 500 }, { presented: 1100, shm: 600 })))
		assert.equal(r['out:2:600'].level, 0)
		assert.equal(r['out:2:600'].text, '50 / 50 fps')
		assert.equal(r['out:2:600'].name, 'Dioda output')
		assert.equal(r['src:2:1'].level, 0)
		assert.equal(r['src:2:1'].name, 'Visuals')
		assert.equal(r['out:2:501'].level, 0)
		assert.equal(r['out:2:741'].level, 0)
		assert.equal(r['caspar-osc'].level, 0)
	})
	it('a dropped screen frame is behind at once; heavy dropping or a slow present is failing', () => {
		let r = byKey(evaluate(sampleFrom({ presented: 1000, dropped: 29 }, { presented: 1100, dropped: 30 })))
		assert.equal(r['out:2:600'].level, 1)
		assert.equal(r['out:2:600'].rise, 1)
		assert.equal(r['out:2:600'].label, 'Dioda output dropping frames')
		r = byKey(evaluate(sampleFrom({ presented: 1000 }, { presented: 1070 })))
		assert.equal(r['out:2:600'].level, 2, '35 of 50 presented')
		assert.equal(r['out:2:600'].label, 'Dioda output at 35 of 50 fps')
	})
	it('the Visuals ring: 45/50 behind, 20/50 failing, frozen = not arriving', () => {
		assert.equal(byKey(evaluate(sampleFrom({ presented: 0, shm: 0 }, { presented: 100, shm: 88 })))['src:2:1'].level, 1)
		const f = byKey(evaluate(sampleFrom({ presented: 0, shm: 0 }, { presented: 100, shm: 40 })))['src:2:1']
		assert.equal(f.level, 2)
		assert.equal(f.label, 'Visuals at 20 of 50 fps')
		assert.equal(byKey(evaluate(sampleFrom({ presented: 0, shm: 7 }, { presented: 100, shm: 7 })))['src:2:1'].label, 'Visuals not arriving (0 of 50 fps)')
	})
	it('a ring written slower on purpose is judged against its own rate (25 fps camera ring on a 50 fps channel)', () => {
		const r = byKey(evaluate(sampleFrom({ presented: 0, shm: 0 }, { presented: 100, shm: 50 }, { ringFps: { visuals: 25 } })))
		assert.equal(r['src:2:1'].level, 0)
		assert.equal(r['src:2:1'].text, '25 / 25 fps')
	})
	it('portaudio under/overruns: a lone one is clock drift (ok), a burst of 3 → behind, 10 → failing', () => {
		assert.equal(byKey(evaluate(sampleFrom({ presented: 0 }, { presented: 100, underruns: 247 })))['out:2:501'].level, 0)
		assert.equal(byKey(evaluate(sampleFrom({ presented: 0 }, { presented: 100, underruns: 249 })))['out:2:501'].level, 1)
		assert.equal(byKey(evaluate(sampleFrom({ presented: 0 }, { presented: 100, underruns: 256 })))['out:2:501'].level, 2)
	})
	it('no false alarm: paused shm layer, layer no longer shm, output not started (screen gate), first sample, Caspar restarted', () => {
		assert.equal(byKey(evaluate(sampleFrom({ presented: 0, shm: 5, paused: true }, { presented: 100, shm: 5, paused: true })))['src:2:1'], undefined)
		assert.equal(byKey(evaluate(sampleFrom({ presented: 0, shm: 5, producer: 'ffmpeg' }, { presented: 100, shm: 5, producer: 'ffmpeg' })))['src:2:1'], undefined)
		const s = sampleFrom({ presented: 0 }, { presented: 100 })
		s.osc.outputs = s.osc.outputs.filter((o) => o.port !== 600) // the gate never started the screen: no counters
		assert.equal(byKey(evaluate(s))['out:2:600'], undefined)
		assert.equal(byKey(evaluate({ ...s, oscPrev: null }))['out:2:600'], undefined, 'one sample = no rate yet')
		const restarted = byKey(evaluate(sampleFrom({ presented: 90000, shm: 9000 }, { presented: 100, shm: 50 })))
		assert.equal(restarted['out:2:600'], undefined, 'counters went backwards → no rate this window')
		assert.equal(restarted['src:2:1'], undefined)
	})
	it('Caspar down: one clearly worded failing check, nothing else from OSC; preshow: nothing at all', () => {
		const s = sampleFrom({ presented: 0, shm: 0 }, { presented: 100, shm: 100 })
		const down = evaluate({ ...s, caspar: { connected: false } })
		assert.deepEqual(down.map((r) => r.key), ['caspar'])
		assert.equal(down[0].level, 2)
		assert.equal(down[0].label, 'Caspar not connected — outputs unwatched')
		assert.deepEqual(evaluate({ ...s, offline: true }), [])
		const silent = byKey(evaluate({ ...s, osc: { ...s.osc, lastAt: s.at - 9000 } }))
		assert.equal(silent['caspar-osc'].level, 1)
	})
	it('an idle box and a quiet server are ok; saturation / stalls / backlog are named', () => {
		const calm = byKey(evaluate({ at: 1, host: { cpuPct: 4, memPct: 12, gpu: { util: 40, vramPct: 7, thermal: false }, cpuThrottleDelta: 0 },
			loop: { maxMs: 3, p99Ms: 1, meanMs: 0.2 }, ws: [{ id: 1, addr: 'on this box', buffered: 0 }] }))
		for (const k of ['cpu', 'ram', 'gpu', 'vram', 'gpu-thermal', 'cpu-thermal', 'server-loop']) assert.equal(calm[k].level, 0, k)
		assert.equal(calm['ws:1'], undefined, 'a client keeping up is not listed')
		const hot = byKey(evaluate({ at: 1, host: { cpuPct: 99, memPct: 50, gpu: { util: 98, vramPct: 98, thermal: true }, cpuThrottleDelta: 3 },
			loop: { maxMs: 650, p99Ms: 40, meanMs: 5 }, ws: [{ id: 2, addr: '10.0.0.5', buffered: 2 * 1024 * 1024 }] }))
		assert.equal(hot.cpu.level, 2)
		assert.equal(hot.cpu.label, 'CPU saturated (99 %)')
		assert.equal(hot.gpu.level, 1, 'a busy GPU is behind, never failing on its own')
		assert.equal(hot.gpu.label, 'GPU saturated (98 %)')
		assert.equal(hot.vram.level, 2)
		assert.equal(hot['gpu-thermal'].level, 1)
		assert.equal(hot['cpu-thermal'].level, 1)
		assert.equal(hot['server-loop'].level, 1)
		assert.equal(hot['server-loop'].rise, 1, 'a long stall counts at once')
		assert.equal(hot['server-loop'].label, 'Server stalled 650 ms')
		assert.equal(hot['ws:2'].label, 'Updates to client 10.0.0.5 backing up')
	})
	it('DMX follow: only with a patch; late gaps and slow ticks are named', () => {
		assert.deepEqual(evaluate({ at: 1, follow: { fixtures: 0, ticks: 44, tickMs: 23, meanWorkMs: 0.1, maxWorkMs: 0.3, maxGapMs: 24 } }), [])
		const ok = evaluate({ at: 1, follow: { fixtures: 12, ticks: 44, tickMs: 23, meanWorkMs: 0.4, maxWorkMs: 1.2, maxGapMs: 30 } })[0]
		assert.equal(ok.level, 0)
		const late = evaluate({ at: 1, follow: { fixtures: 12, ticks: 40, tickMs: 23, meanWorkMs: 0.4, maxWorkMs: 1.2, maxGapMs: 140 } })[0]
		assert.equal(late.level, 1)
		assert.equal(late.label, 'DMX follow late (gap 140 ms)')
		assert.equal(evaluate({ at: 1, follow: { fixtures: 12, ticks: 20, tickMs: 23, meanWorkMs: 30, maxWorkMs: 40, maxGapMs: 40 } })[0].level, 2)
	})
	it('tracking: behind only when detection itself is too slow, not when the camera is', () => {
		const tr = (fps, ms) => evaluate({ at: 1, tracking: { intervalMs: 67, cameras: [{ id: 'cam1', state: 'ok', fps, ms }] } })[0]
		assert.equal(tr(14.9, 20).level, 0)
		assert.equal(tr(6, 20).level, 0, 'a 6 fps camera with fast detection is not a keeping-up problem')
		assert.equal(tr(9, 110).level, 1)
		assert.equal(tr(9, 110).label, 'Tracking 6 fps behind')
		assert.equal(tr(5, 190).level, 2)
		assert.deepEqual(evaluate({ at: 1, tracking: { intervalMs: 67, cameras: [{ id: 'c', state: 'stale', fps: 0, ms: 0 }] } }), [])
	})
	it('client reports pass through; the model turns them into the shared list', () => {
		const m = new KeepingUpModel()
		m.update(evaluate({ at: 1, reported: [{ key: 'client:x:fps', group: 'client', name: 'Operator client', level: 1, label: 'This client at 61 of 100 fps', text: '61 / 100 fps' }] }))
		assert.equal(m.summary().label, 'This client at 61 of 100 fps')
	})
	it('nvidia-smi loop line and channel names', () => {
		assert.deepEqual(parseNvLine('43, 1698, 24467, 65, Not Active, Not Active'), { util: 43, vramPct: (1698 / 24467) * 100, tempC: 65, thermal: false })
		assert.equal(parseNvLine('99, 1, 2, 90, Active, Not Active').thermal, true)
		assert.equal(parseNvLine('[N/A]'), null)
		assert.deepEqual(channelNames({ programChannels: [2, 4], previewChannels: [3, null], screenLabels: ['Dioda', ''], operatorGuiChannels: [1] }),
			{ 1: 'Operator GUI', 2: 'Dioda', 3: 'Dioda preview', 4: 'Screen 2' })
	})
})
