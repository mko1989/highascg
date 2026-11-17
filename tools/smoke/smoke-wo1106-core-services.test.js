'use strict'

/**
 * WO-1106 B10 / B11 / B12 / B13 — request paths and watchdogs that a client or a dead device could make expensive
 * (offline: fake tools on a temp PATH, fake `bluetoothctl`, a fake AMCP; never the box's devices):
 *   B10  a keeping-up report: target / measured are finite numbers or null; live checks capped per client and in total
 *   B11  `aplay -l` and `fc-list` run async (the event loop keeps ticking), one run shared by concurrent requests
 *   B12  overlapping Bluetooth status polls share one `bluetoothctl` run and a 2 s answer; a change reads afresh
 *   B13  a live input that cannot start backs off 15 s → 5 min per slot, is said once per reason, resets when it opens
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wo1106-svc-'))
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))

test('B10: report values are coerced; live checks are capped per client and in total', () => {
	const { startKeepingUp } = require('../../src/health/keeping-up-service')
	const ctx = { config: { osc: { enabled: true } }, _casparStatus: { connected: true }, log() {}, _wsBroadcast() {} }
	const svc = startKeepingUp(ctx, { autostart: false, gpu: false, wsClients: [] })
	try {
		const base = { client: 'phone', key: 'fps', name: 'Phone', level: 1, label: 'Phone behind', text: 'x' }
		assert.equal(svc.report({ ...base, target: 'lots', measured: { evil: 1 }, severity: 'Infinity' }).ok, true)
		svc.sampleOnce()
		let c = svc.summary().checks.find((x) => x.key === 'client:phone:fps')
		assert.deepEqual([c.target, c.measured, c.severity], [null, null, 0])
		svc.report({ ...base, target: '60', measured: 41.5, severity: 19 })
		svc.sampleOnce()
		c = svc.summary().checks.find((x) => x.key === 'client:phone:fps')
		assert.deepEqual([c.target, c.measured, c.severity], [60, 41.5, 19])
		for (let i = 0; i < 3; i++) assert.equal(svc.report({ ...base, key: `k${i}` }).ok, true)
		const over = svc.report({ ...base, key: 'k-too-many' })
		assert.equal(over.ok, false)
		assert.match(over.error, /at most 4 checks per client/)
		assert.equal(svc.report({ ...base, key: 'fps', level: 0 }).ok, true, 'an existing key still updates')
		let refused = 0
		for (let i = 0; i < 40; i++) if (!svc.report({ ...base, client: `c${i}`, key: 'fps' }).ok) refused++
		assert.equal(refused, 40 - (32 - 4), 'at most 32 live client checks in total')
	} finally {
		svc.stop()
	}
})

/** A fake tool on a temp PATH: sleeps, prints `out`, counts its runs. */
function fakeTool(name, out, sleepS = 0.4) {
	const bin = path.join(TMP, 'bin')
	fs.mkdirSync(bin, { recursive: true })
	const count = path.join(TMP, `${name}.count`)
	fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho run >> '${count}'\nsleep ${sleepS}\ncat <<'EOF'\n${out}\nEOF\n`, { mode: 0o755 })
	return () => (fs.existsSync(count) ? fs.readFileSync(count, 'utf8').split('\n').filter(Boolean).length : 0)
}
async function ticksDuring(p) {
	let ticks = 0
	const t = setInterval(() => ticks++, 20)
	try {
		return { value: await p, ticks }
	} finally {
		clearInterval(t)
	}
}

test('B11: aplay -l and fc-list run async; concurrent requests share one run; results are cached', async () => {
	const runsAplay = fakeTool('aplay', 'card 1: USB [Scarlett Solo USB], device 0: USB Audio [USB Audio]')
	const runsFc = fakeTool('fc-list', 'Nimbus Sans,Nimbus Sans L\nDejaVu Serif')
	const PATH = process.env.PATH
	process.env.PATH = `${path.join(TMP, 'bin')}:${PATH}`
	try {
		const { listAlsaCardsAsync } = require('../../src/audio/audio-devices')
		const { installedFonts, handleGet } = require('../../src/api/routes-screen-timers')
		const a = await ticksDuring(Promise.all([listAlsaCardsAsync('playback'), listAlsaCardsAsync('playback')]))
		assert.ok(a.ticks >= 5, `the event loop kept ticking (${a.ticks} ticks)`)
		assert.equal(runsAplay(), 1, 'one aplay for two requests')
		assert.deepEqual(a.value[0], a.value[1])
		assert.deepEqual(a.value[0].cards.map((c) => c.value), ['plughw:CARD=USB,DEV=0'])
		await listAlsaCardsAsync('playback')
		assert.equal(runsAplay(), 1, 'cached')
		const f = await ticksDuring(Promise.all([installedFonts(), handleGet('/api/timers/fonts', {})]))
		assert.ok(f.ticks >= 5, `the event loop kept ticking (${f.ticks} ticks)`)
		assert.equal(runsFc(), 1, 'one fc-list for two requests')
		assert.deepEqual(f.value[0], ['DejaVu Serif', 'Nimbus Sans'])
		assert.deepEqual(JSON.parse(f.value[1].body).fonts, ['DejaVu Serif', 'Nimbus Sans'])
	} finally {
		process.env.PATH = PATH
	}
})

test('B12: overlapping Bluetooth status polls share one run and a short answer; a change reads afresh', async () => {
	const { createBluetoothPads } = require('../../src/bluetooth/bluetooth-pads')
	let t = 1000
	const calls = []
	const run = async (args) => {
		calls.push(args[0])
		await new Promise((r) => setTimeout(r, 20))
		if (args[0] === 'show') return { ok: true, out: 'Controller 00:11:22:33:44:55\n\tPowered: yes\n', err: '' }
		if (args[0] === 'devices') return { ok: true, out: 'Device AA:BB:CC:DD:EE:01 Wireless Controller\nDevice AA:BB:CC:DD:EE:02 Phone\n', err: '' }
		if (args[0] === 'info') return { ok: true, out: '\tName: x\n\tIcon: input-gaming\n', err: '' }
		return { ok: true, out: '', err: '' }
	}
	const pads = createBluetoothPads({ run, spawn: () => ({ on() {}, kill() {} }), now: () => t })
	const [a, b, c] = await Promise.all([pads.status(), pads.status(), pads.status()])
	assert.deepEqual(a, b)
	assert.deepEqual(a, c)
	const one = calls.length
	assert.equal(one, 4, `one run of show + devices + 2 × info, not three (${calls.join(' ')})`)
	t += 1000
	await pads.status()
	assert.equal(calls.length, one, 'answered from the 2 s cache')
	t += 1500
	await pads.status()
	assert.equal(calls.length, one * 2, 'stale after 2 s: asked again')
	await pads.forget('AA:BB:CC:DD:EE:01')
	const before = calls.length
	await pads.status()
	assert.equal(calls.length, before + one, 'a change (forget) reads afresh')
})

test('B13: a live input that cannot start backs off 15 s → 5 min, said once, resets when it opens; force skips the wait', async () => {
	const { listConfiguredLiveAudioSlots } = require('../../src/config/live-audio-input')
	const health = require('../../src/audio/live-audio-health')
	const cfg = { caspar_global_portaudio: true, live_audio_input_count: 1, live_audio_input_1_device: 'alsa://hw:0,0', live_audio_capture_bridge: false, live_audio_meter_null_consumer: false }
	const { slots } = listConfiguredLiveAudioSlots(cfg)
	const slot = slots[0]
	let alive = false
	const raw = []
	const logs = []
	const ctx = {
		config: cfg,
		amcp: {
			isConnected: true,
			info: async () => ({ data: alive ? '<type>ffmpeg</type><clip>alsa://dsnoop:0,0</clip>' : '<foreground><type>empty</type></foreground> alsa://hw:0,0 cannot open audio device' }),
			raw: async (cmd) => (raw.push(cmd), {}),
		},
		oscState: { getSnapshot: () => ({ channels: {} }) }, // meters absent = stale every tick
		log: (level, msg) => logs.push(`${level} ${msg}`),
	}
	const fast = { slots, verifyMs: 0, verifyGraceMs: 0, clearSettleMs: 0 }
	const plays = () => raw.filter((c) => c.startsWith('PLAY')).length
	const warns = () => logs.filter((l) => /could not start|failed to start/.test(l)).length
	health._backoff.clear()
	let now = 0
	const tick = (o = {}) => health.ensureLiveAudioInputsHealthy(ctx, { ...fast, now, ...o })

	await tick()
	assert.ok(plays() > 0)
	assert.equal(warns(), 2, 'the first failure is said (its reason + the summary line)')
	const delays = [health._backoff.get(slot.slot).delayMs]
	const p0 = plays()
	now += 5000
	const skipped = await tick()
	assert.equal(plays(), p0, 'within the wait: no CLEAR / PLAY')
	assert.equal(skipped.failed[0].reason, 'backoff')
	for (let i = 0; i < 7; i++) {
		now = health._backoff.get(slot.slot).until
		await tick()
		delays.push(health._backoff.get(slot.slot).delayMs)
	}
	assert.deepEqual(delays, [15000, 30000, 60000, 120000, 240000, 300000, 300000, 300000])
	assert.equal(warns(), 2, 'the same reason is not said again')
	const pf = plays()
	await tick({ force: true })
	assert.ok(plays() > pf, 'a forced repair (startup / config change) skips the wait')
	alive = true
	now = health._backoff.get(slot.slot).until
	const ok = await tick()
	assert.equal(ok.repaired.length, 1)
	assert.equal(health._backoff.has(slot.slot), false, 'reset when the capture opens')
	assert.ok(logs.some((l) => /capture running again/.test(l)))
})
