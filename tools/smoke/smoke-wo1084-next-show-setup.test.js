'use strict'

/**
 * WO-1084 — "next show setup" harness. Owner 15.11.26: back in the warehouse with one monitor, picked "start GUI here",
 * and the GUI was covered by screen destinations; "the consumers that dont have their connectors up shouldnt be
 * started/turned on". Connector state is injected (src/utils/connector-state.js seam: HIGHASCG_CONNECTOR_STATE /
 * HIGHASCG_OPERATOR_OUTPUT_FILE, or `heads` passed directly), Caspar is a fake AMCP — no X, no GPU, no :5250.
 *
 * Scenarios: all up · only operator up · operator + one of three · a connector name this GPU no longer has ·
 * a connector appears later · a connector disappears · the operator screen is a head that used to be a program
 * output (the recorded 15.11 box: work/notes/wo1084-evidence/).
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..', '..')
const EVIDENCE = path.join(ROOT, 'work', 'notes', 'wo1084-evidence')
const gate = require('../../src/config/screen-connector-gate')
const cs = require('../../src/utils/connector-state')
const hp = require('../../src/system/screen-hotplug')
const status = require('../../src/system/screen-output-status')

const screen = (dev, x, w = 1920, keyOnly = false) =>
	`<screen><device>${dev}</device><windowed>true</windowed><key-only>${keyOnly}</key-only><always-on-top>true</always-on-top><x>${x}</x><y>0</y><width>${w}</width><height>1080</height></screen>`
const channel = (comment, consumers) => `        <!-- HighAsCG: ${comment} -->\n        <channel><video-mode>1080p5000</video-mode><consumers>${consumers}</consumers></channel>\n`
const { enforceScreenConsumerPolicy } = require('../../src/config/screen-consumer-policy')
const policy = (xml) => enforceScreenConsumerPolicy(xml).xml // WO-717: what every launch does to the file anyway
/** Operator-first show (WO-868): ch1 GUI, ch2/3 screen 1, ch4 screen 2, ch5 screen 3 — on DP-0 | DP-2 | DP-4 | DP-6. */
const SHOW = policy(`<configuration><channels>\n${[
	channel('Caspar channel 1: Operator GUI channel "Operator GUI" — SHARED MEMORY', screen(1, 0)),
	channel('Caspar channel 2: Screen 1 program output (PGM)', screen(2, 1920)),
	channel('Caspar channel 3: Screen 1 preview output (PRV)', '<shm/>'),
	channel('Caspar channel 4: Screen 2 program output (PGM)', screen(3, 3840)),
	channel('Caspar channel 5: Screen 3 program output (PGM)', screen(4, 5760) + '<!-- --> <ffmpeg><path>x</path></ffmpeg>'),
].join('')}    </channels></configuration>\n`)

const head = (name, x, on = true) => ({ name, connected: on, active: on, x, y: 0, width: on ? 1920 : 0, height: on ? 1080 : 0 })
const HEADS = { 'DP-0': 0, 'DP-2': 1920, 'DP-4': 3840, 'DP-6': 5760 }
const heads = (...lit) => Object.keys(HEADS).map((n) => head(n, HEADS[n], lit.includes(n)))
const decide = (xml, h, op = ['DP-0']) => gate.gateScreenConsumers(xml, { heads: h, operatorNames: op })
const startedCh = (r) => r.started.map((w) => w.channel)
const offlineCh = (r) => r.offline.map((w) => w.channel)

test('all up: every window starts, nothing is marked', () => {
	const r = decide(SHOW, heads('DP-0', 'DP-2', 'DP-4', 'DP-6'))
	assert.deepEqual(startedCh(r), [1, 2, 4, 5])
	assert.deepEqual(offlineCh(r), [])
	assert.equal(r.changed, false)
	assert.equal(r.xml, SHOW)
})

test('only the operator screen up: no program window opens; all stay configured, reversibly', () => {
	const r = decide(SHOW, heads('DP-0'))
	assert.deepEqual(startedCh(r), [1], 'only the Operator GUI channel window (its own, under the GUI)')
	assert.deepEqual(offlineCh(r), [2, 4, 5])
	for (const w of r.offline) assert.match(w.reason, /no connected screen there/)
	assert.equal((r.xml.match(/<screen>/g) || []).length, 4, 'blocks kept in the file')
	assert.equal(gate.restoreOfflineScreens(r.xml), SHOW, 'restore = byte-identical original')
	assert.deepEqual(gate.listOfflineScreens(r.xml).map((m) => m.channel), [2, 4, 5])
	assert.equal(decide(r.xml, heads('DP-0')).xml, r.xml, 'idempotent: gating a gated file changes nothing')
	const odd = '<screen><x>1920</x><y>0</y><width>9</width><height>9</height><!-- a -- b --></screen>'
	const marked = gate.markOffline(odd, 'r--"x"')
	assert.match(marked, /^<!--HACG-OFFLINE64 reason="r-'x'" /, 'a block with -- is carried base64 (a comment cannot hold it)')
	assert.equal(gate.restoreOfflineScreens(`a${marked}b`), `a${odd}b`)
})

test('operator + one of three: only that destination starts', () => {
	const r = decide(SHOW, heads('DP-0', 'DP-4'))
	assert.deepEqual(startedCh(r), [1, 4])
	assert.deepEqual(offlineCh(r), [2, 5])
	assert.equal(r.started.find((w) => w.channel === 4).reason, 'on DP-4')
})

test('a connector name this GPU no longer has: its window does not start (X would clamp it onto the GUI)', () => {
	const h = heads('DP-0', 'DP-2', 'DP-4').filter((x) => x.name !== 'DP-6') // DP-6 is not in xrandr at all
	const r = decide(SHOW, h)
	assert.deepEqual(offlineCh(r), [5])
	assert.match(r.offline[0].reason, /no connected screen there/)
	const modeless = decide(SHOW, [...heads('DP-0'), { name: 'DP-2', connected: true, active: false, x: 0, y: 0, width: 0, height: 0 }])
	assert.match(modeless.offline[0].reason, /connected without a mode: DP-2/)
})

test('fail open: no readable display state starts everything (a probe error never darkens a show)', () => {
	const r = decide(SHOW, null)
	assert.deepEqual(startedCh(r), [1, 2, 4, 5])
	assert.equal(r.xml, SHOW)
	assert.equal(gate.decideScreen(null, heads('DP-0')).start, true, 'a window with no position is Caspar\'s to place')
})

test('the GUI is never covered: a program window over the operator screen does not start, even half over it', () => {
	const r = decide(SHOW, heads('DP-0', 'DP-2', 'DP-4', 'DP-6'), ['DP-2'])
	assert.deepEqual(offlineCh(r), [2])
	assert.match(r.offline[0].reason, /would cover the operator screen DP-2/)
	const straddle = gate.decideScreen({ x: 1000, y: 0, width: 1920, height: 1080 }, heads('DP-0', 'DP-2'), { operatorNames: ['DP-0'] })
	assert.equal(straddle.start, false)
	const fallback = gate.decideScreen({ x: 0, y: 0, width: 3072, height: 1024 }, heads('DP-0'), { operatorNames: ['DP-0'] })
	assert.equal(fallback.start, false, 'X fallback placement at 0,0 = on the GUI')
})

/* ── The recorded box (15.11.26): GUI picked on DP-3, the head PGM/PRV 1 used to own; PGM 2 cabled to dark jacks ── */
test('operator screen = a head that used to be a program output (recorded evidence)', () => {
	const xml = fs.readFileSync(path.join(EVIDENCE, 'casparcg.config.generated'), 'utf8')
	const h = cs.headsFromXrandr(fs.readFileSync(path.join(EVIDENCE, 'xrandr-query.txt'), 'utf8'))
	const r = gate.gateScreenConsumers(xml, { heads: h, operatorNames: ['DP-3'] })
	assert.deepEqual(r.started.map((w) => w.port), [], 'no Caspar window on the warehouse monitor')
	assert.deepEqual(r.offline.map((w) => `${w.channel}-${w.port}`), ['2-600', '4-611', '4-660'], 'the three windows seen covering the GUI')
	assert.match(r.offline[0].reason, /would cover the operator screen DP-3/)

	const sd = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'screen_destinations.json'), 'utf8'))
	const dg = JSON.parse(fs.readFileSync(path.join(EVIDENCE, 'device_graph.json'), 'utf8'))
	const config = { screenDestinations: sd.screenDestinations || sd, deviceGraph: dg.deviceGraph || dg }
	const st = status.screenOutputStatus(config, { xml: r.xml, heads: h, channelMap: { programChannels: [2, 4], previewChannels: [3, null] } })
	assert.deepEqual(status.offlineLogLines(st), [
		'PGM/PRV 1: DP-3 is the operator screen — not started',
		'PGM 2: DP-4/DP-5 + DP-6/DP-7 not connected — not started',
	])
	assert.equal(st.destinations.dst_mwced94x_1.state, 'offline')

	// Root-cause fix in the plan: the operator wins a jack shared with a destination the boot answer left there.
	const plan = require('../../src/utils/os-layout-calculator-assign').collectGpuLayoutAssignments(config)
	assert.deepEqual(plan.operatorGuiAssignments.map((a) => a.sysId), ['DP-3'])
	assert.ok(!Object.values(plan.allGpuAssignments || {}).some((a) => a?.sysId === 'DP-3'), 'no program screen planned on the operator jack')
})

/* ── The launch choke point: run.sh → tools/runtime/gate-screen-consumers.js, connector state injected ── */
test('run.sh gate tool end to end: marks, logs, decides again on the next launch', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-wo1084-'))
	try {
		const cfg = path.join(dir, 'casparcg.config')
		const state = path.join(dir, 'connectors.json')
		const opFile = path.join(dir, 'operator-output.json')
		fs.writeFileSync(cfg, SHOW)
		cs.writeOperatorNames(['DP-0'], opFile)
		const run = (lit) => {
			fs.writeFileSync(state, JSON.stringify({ heads: heads(...lit) }))
			return execFileSync(process.execPath, [path.join(ROOT, 'tools/runtime/gate-screen-consumers.js'), cfg], {
				env: { ...process.env, HIGHASCG_CONNECTOR_STATE: state, HIGHASCG_OPERATOR_OUTPUT_FILE: opFile },
				encoding: 'utf8',
			})
		}
		const out1 = run(['DP-0'])
		assert.match(out1, /^\[screen gate\] lit: DP-0; operator: DP-0 — 1 started .*3 not started/)
		assert.deepEqual(gate.listOfflineScreens(fs.readFileSync(cfg, 'utf8')).map((m) => m.channel), [2, 4, 5])
		const out2 = run(['DP-0', 'DP-2', 'DP-4', 'DP-6']) // the show rig is plugged back in
		assert.match(out2, /— 4 started \(.*\), 0 not started$/m)
		assert.equal(fs.readFileSync(cfg, 'utf8'), SHOW, 'next launch: all back, file identical to the generator output')
		assert.match(execFileSync(process.execPath, [path.join(ROOT, 'tools/runtime/gate-screen-consumers.js'), path.join(dir, 'missing')], { encoding: 'utf8' }), /cannot read/, 'never blocks the launch')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
	const sh = fs.readFileSync(path.join(ROOT, 'run.sh'), 'utf8')
	const runCaspar = sh.slice(sh.indexOf('run_caspar()'))
	const iGate = runCaspar.indexOf('tools/runtime/gate-screen-consumers.js" "$CONFIG_PATH"')
	assert.ok(iGate > 0, 'run.sh gates the file Caspar reads')
	assert.ok(iGate < runCaspar.indexOf('"$CASPAR_BIN" "$CONFIG_PATH"'), '…before launching it')
})

/* ── Hot-plug while Caspar runs (fake AMCP) ── */
function fakeBox(lit, running) {
	let file = SHOW
	const sent = []
	const live = new Map(Object.entries(running).map(([ch, ports]) => [Number(ch), new Set(ports)]))
	const state = { lit }
	const deps = {
		readHeads: () => heads(...state.lit),
		readOperatorNames: () => ['DP-0'],
		syncOperator: () => {},
		configPath: () => '/fake/casparcg.config',
		readFile: () => file,
		writeFile: (_p, s) => {
			file = s
		},
		info: async (ch) => {
			if (!live.has(ch)) throw new Error('404')
			return `<channel><output><port>${[...live.get(ch)].map((p) => `<port_${p}><consumer>screen</consumer></port_${p}>`).join('')}<port_9277><consumer>ffmpeg</consumer></port_9277></port></output></channel>`
		},
		send: async (line) => {
			sent.push(line)
			const m = line.match(/^(ADD|REMOVE) (\d+)-(\d+)/)
			if (m[1] === 'ADD') live.get(Number(m[2])).add(Number(m[3]))
			else live.get(Number(m[2])).delete(Number(m[3]))
		},
		applyLayout: async () => {
			state.laidOut = true
		},
		place: async () => {},
		status: () => ({ destinations: {} }),
		now: () => 1e9,
	}
	return { deps, sent, live, state, file: () => file }
}

test('a connector appears later: its window opens with the file\'s own block, the mark goes', async () => {
	const box = fakeBox(['DP-0'], { 1: [600], 2: [], 3: [], 4: [], 5: [] })
	const ctx = { config: {}, log: () => {} }
	await hp.reconcileScreens(ctx, box.deps)
	assert.deepEqual(box.sent, [], 'nothing running that should not')
	assert.deepEqual(gate.listOfflineScreens(box.file()).map((m) => m.channel), [2, 4, 5])
	box.state.lit = ['DP-0', 'DP-4']
	const r = await hp.reconcileScreens(ctx, box.deps)
	assert.deepEqual(r.added, [[4, 602]])
	assert.match(box.sent[0], /^ADD 4-602 XML /)
	assert.equal(Buffer.from(box.sent[0].split(' ').pop(), 'base64').toString('utf8'), policy(screen(3, 3840)))
	assert.deepEqual(gate.listOfflineScreens(box.file()).map((m) => m.channel), [2, 5])
	assert.equal((await hp.reconcileScreens(ctx, box.deps)).added.length, 0, 'idempotent')
})

test('a connector disappears: its window closes, runtime consumers are never touched', async () => {
	const box = fakeBox(['DP-0', 'DP-2', 'DP-4', 'DP-6'], { 1: [600], 2: [601], 3: [], 4: [602], 5: [603] })
	box.state.lit = ['DP-0', 'DP-2', 'DP-6']
	const r = await hp.reconcileScreens({ config: {}, log: () => {} }, box.deps)
	assert.deepEqual(box.sent, ['REMOVE 4-602'])
	assert.deepEqual(r.removed, [[4, 602]])
	assert.ok(!box.sent.some((l) => /9277/.test(l)))
	assert.deepEqual(gate.listOfflineScreens(box.file()).map((m) => m.channel), [4])
})

test('a head that came up without a mode is laid out first; hot-plug off = only offered', async () => {
	const box = fakeBox(['DP-0'], { 1: [600], 2: [], 3: [], 4: [], 5: [] })
	box.deps.readHeads = () => (box.state.laidOut ? heads('DP-0', 'DP-2') : [...heads('DP-0'), { name: 'DP-2', connected: true, active: false, x: 0, y: 0, width: 0, height: 0 }])
	const r = await hp.reconcileScreens({ config: {}, log: () => {} }, box.deps)
	assert.equal(r.laidOut, true)
	assert.deepEqual(r.added, [[2, 601]])
	const off = fakeBox(['DP-0', 'DP-2'], { 1: [600], 2: [], 3: [], 4: [], 5: [] })
	const lines = []
	await hp.reconcileScreens({ config: { operatorTools: { screenHotplug: false } }, log: (_l, m) => lines.push(m) }, off.deps)
	assert.deepEqual(off.sent, [])
	assert.ok(lines.some((l) => /1 window\(s\) to open/.test(l)))
})

test('debounce: a NovaStar re-handshake (down ~1 s, back) never reconciles; a settled change does once', () => {
	const t = hp.createHotplugTracker({ settleMs: 6000 })
	const up = { 'card0-DP-1': 'connected', 'card0-DP-2': 'disconnected' }
	assert.equal(t.step(up, 0), false, 'baseline')
	assert.equal(t.step({ ...up, 'card0-DP-1': 'disconnected' }, 2000), false)
	assert.equal(t.step(up, 3000), false)
	assert.equal(t.step(up, 20000), false, 'flap ended where it started')
	const plugged = { ...up, 'card0-DP-2': 'connected' }
	assert.equal(t.step(plugged, 21000), false)
	assert.equal(t.step(plugged, 25000), false, 'not settled yet')
	assert.equal(t.step(plugged, 27000), true, 'settled')
	assert.equal(t.step(plugged, 40000), false, 'once')
})

/* ── The marks are not a config change (Devices dirty badge) and are never placed (WO-483) ── */
test('dirty check and window placement ignore the marks', () => {
	const { casparConfigDirty, rememberConfigAtConnect } = require('../../src/config/caspar-config-dirty')
	let disk = decide(SHOW, heads('DP-0')).xml
	const deps = { generatedXml: () => SHOW, configPath: () => 'x', readFile: () => disk, persistence: { get: () => null, set: () => {} }, now: () => 1 }
	const ctx = { config: {} }
	rememberConfigAtConnect(ctx, deps)
	assert.equal(casparConfigDirty(ctx, { deps }).dirty, false, 'gated at launch')
	disk = decide(SHOW, heads('DP-0', 'DP-4')).xml
	assert.equal(casparConfigDirty(ctx, { deps }).dirty, false, 'marks moved by a hot-plug')
	disk = SHOW.replace('1920</x>', '1921</x>')
	assert.equal(casparConfigDirty(ctx, { deps }).dirty, true, 'a real change still counts')
	const { parseScreenConsumerRects } = require('../../src/system/screen-consumer-placement')
	assert.equal(parseScreenConsumerRects(decide(SHOW, heads('DP-0')).xml).length, 1)
	assert.equal(parseScreenConsumerRects(SHOW).length, 4)
})

test('INFO parsing and the action plan touch screen consumers only', () => {
	assert.deepEqual([...hp.runningScreenPorts('<port_611><consumer>screen</consumer></port_611><port_9277><consumer>ffmpeg</consumer></port_9277><port_740><consumer>shm</consumer></port_740>')], [611])
	const r = decide(SHOW, heads('DP-0'))
	const plan = hp.planScreenActions(r, new Map([[1, new Set([600])], [2, new Set([601])]]))
	assert.deepEqual(plan.remove.map((a) => a.line), ['REMOVE 2-601'])
	assert.deepEqual(plan.add, [], 'channels with no INFO answer are left alone')
})

test('Devices "running differs": a window the gate held back (or the hot-plug opened) is not a difference', () => {
	const { compareExpectedToServer } = require('../../src/config/config-compare')
	const row = (index, hasScreen) => ({ index, videoMode: '1080p5000', hasScreen, hasDecklinkOutput: false })
	const expected = [row(1, true), row(2, true), row(3, false), row(4, true)]
	const running = [row(1, true), row(2, false), row(3, false), row(4, false)]
	assert.equal(compareExpectedToServer(running, expected).length, 2, 'without the gate: two differences')
	assert.deepEqual(compareExpectedToServer(running, expected, { screenGate: new Set([2, 4]) }), [])
	assert.equal(compareExpectedToServer(running, expected, { screenGate: new Set([2]) }).length, 1, 'only the gated channel is exempt')
	const src = fs.readFileSync(path.join(ROOT, 'src/config/config-compare.js'), 'utf8')
	assert.ok(src.includes('compareExpectedToServer(serverChannels, moduleChannels, { screenGate: screenGateChannels(self) })'))
})
