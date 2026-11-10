'use strict'
/**
 * WO-1012 — the Zoom device: Zoom's X windows are listed (on-screen, useful size, role guess), a meeting link becomes the
 * zoommtg:// join URL, and a source (presenter / share / gallery) grabs a window into the ring zoom-<source>: hidden =
 * Openbox BELOW layer at the operator GUI's rect, sized to the ring; one window feeds one source; a window Zoom
 * recreates is re-bound by title; quit stops every grab. No X, no Zoom, no grabber binary — all injected.
 */
const test = require('node:test')
const assert = require('node:assert')

const { parseWindowDump, guessRole } = require('../../src/zoom/zoom-windows')
const { createZoomSession, joinUrl, cleanSize } = require('../../src/zoom/zoom-session')
const routesZoom = require('../../src/api/routes-zoom')

const DUMP = `@@ 33554451
xwininfo: Window id: 0x2000013 "Zoom Workplace - Free account"
  Absolute upper-left X:  320
  Absolute upper-left Y:  60
  Width: 1280
  Height: 960
  Depth: 24
  Map State: IsViewable
_NET_WM_STATE(ATOM) = _NET_WM_STATE_SKIP_TASKBAR, _NET_WM_STATE_BELOW
_NET_WM_NAME(UTF8_STRING) = "Zoom Workplace - Free account"
_NET_WM_PID(CARDINAL) = 4242
@@ 33554460
  Absolute upper-left X:  0
  Absolute upper-left Y:  0
  Width: 1600
  Height: 900
  Map State: IsViewable
_NET_WM_STATE(ATOM) =
_NET_WM_NAME(UTF8_STRING) = "Zoom Meeting"
@@ 33554470
  Width: 1920
  Height: 1080
  Map State: IsUnMapped
_NET_WM_NAME(UTF8_STRING) = "Zoom Meeting"
@@ 33554480
  Width: 300
  Height: 40
  Map State: IsViewable
_NET_WM_NAME(UTF8_STRING) = "as_toolbar"
`

test('Zoom windows: on-screen ones of a useful size, biggest first, with BELOW state and a role guess', () => {
	const w = parseWindowDump(DUMP)
	assert.deepStrictEqual(w.map((x) => [x.id, x.role, x.below]), [['0x200001c', 'meeting', false], ['0x2000013', 'home', true]])
	assert.deepStrictEqual([w[1].x, w[1].y, w[1].width, w[1].height, w[1].pid], [320, 60, 1280, 960, 4242])
	assert.strictEqual(guessRole('Zoom Meeting'), 'meeting')
	assert.strictEqual(guessRole('Screen share viewing options'), 'share')
	assert.strictEqual(guessRole('Participants'), 'other')
})

test('a meeting link or number → the zoommtg:// join URL; anything else is refused', () => {
	assert.strictEqual(joinUrl('https://us05web.zoom.us/j/81234567890?pwd=ab.c1'), 'zoommtg://us05web.zoom.us/join?action=join&confno=81234567890&pwd=ab.c1')
	assert.strictEqual(joinUrl('812 3456 7890'), 'zoommtg://zoom.us/join?action=join&confno=81234567890')
	assert.strictEqual(joinUrl('zoommtg://zoom.us/join?confno=1'), 'zoommtg://zoom.us/join?confno=1')
	assert.strictEqual(joinUrl('https://evil.example/j/81234567890'), '')
	assert.strictEqual(joinUrl('hello'), '')
	assert.strictEqual(cleanSize('1281x721'), '1280x720')
	assert.strictEqual(cleanSize('huge'), '1920x1080')
})

function fakeSession(windows) {
	const grabs = []
	const st = { windows, timers: [] }
	const s = createZoomSession({
		exec: async () => ({ stdout: '4242\n' }),
		spawn: () => ({ unref() {} }),
		exists: () => true,
		listWindows: async () => st.windows,
		guiRect: async () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
		ensureBinary: () => ({ ok: true, bin: '/x/window_grab' }),
		timers: { setInterval: (f) => (st.timers.push(f), { unref() {} }), clearInterval: () => {} },
		createGrab: (o) => {
			const g = { ...o, alive: true, sent: [], status: { window: o.window, mapped: true, published: 0 } }
			g.setWindow = (id) => (g.status.window = id, g.sent.push(`window ${id}`))
			g.below = () => g.sent.push('below')
			g.normal = () => g.sent.push('normal')
			g.move = (x, y, w, h) => g.sent.push(`move ${x} ${y} ${w} ${h}`)
			g.stop = () => (g.alive = false)
			grabs.push(g)
			return g
		},
	})
	return { s, grabs, st }
}

const WINS = [
	{ id: '0x2000013', title: 'Zoom Workplace - Free account', role: 'home' },
	{ id: '0x200001c', title: 'Zoom Meeting', role: 'meeting' },
]

test('a hidden source grabs its window into zoom-<source>, BELOW the operator GUI, sized to the ring', async () => {
	const { s, grabs } = fakeSession(WINS)
	const r = await s.assign('presenter', { window: '0x200001c', hidden: true, size: '1280x720' })
	assert.strictEqual(grabs.length, 1)
	assert.deepStrictEqual([grabs[0].ring, grabs[0].size, grabs[0].fps], ['zoom-presenter', '1280x720', 30])
	assert.deepStrictEqual(grabs[0].sent, ['window 0x200001c', 'below', 'move 1 1 1278 718'])
	assert.strictEqual(r.sources.presenter.value, 'shm://zoom-presenter')
	assert.strictEqual(r.sources.presenter.hidden, true)
	await assert.rejects(s.assign('share', { window: '0x200001c' }), /already feeds "presenter"/)
	await assert.rejects(s.assign('share', { window: '0xdead' }), /no Zoom window/)
	await assert.rejects(s.assign('stage', { window: '0x200001c' }), /unknown Zoom source/)
	await s.assign('presenter', { hidden: false })
	assert.strictEqual(grabs[0].sent.at(-1), 'normal', 'shown again: back to the normal layer')
	await s.assign('presenter', { window: null })
	assert.strictEqual(grabs[0].alive, false, 'window null stops the source')
})

test('a window Zoom recreates is re-bound by its title and hidden again; quit stops every grab', async () => {
	const { s, grabs, st } = fakeSession(WINS)
	await s.assign('gallery', { window: '0x200001c', hidden: true })
	grabs[0].status.window = null // the grabber said "window gone"
	st.windows = [WINS[0], { id: '0x2000099', title: 'Zoom Meeting', role: 'meeting' }]
	await s.rebind()
	assert.deepStrictEqual(grabs[0].sent.slice(-3), ['window 0x2000099', 'below', 'move 1 1 1918 1078'])
	assert.strictEqual((await s.status()).sources.gallery.window, '0x2000099')
	const q = await s.quit()
	assert.strictEqual(grabs[0].alive, false)
	assert.ok(q.ok)
})

test('routes: GET /api/zoom and POST bodies arrive as raw JSON strings', async () => {
	const h = {}
	const routes = { get: (p, f) => (h['GET ' + p] = f), post: (p, f) => (h['POST ' + p] = f) }
	routesZoom.register(routes)
	assert.deepStrictEqual(Object.keys(h).sort(), ['GET /api/zoom', 'POST /api/zoom/launch', 'POST /api/zoom/quit', 'POST /api/zoom/source'])
	const bad = await h['POST /api/zoom/source']({ ctx: {}, body: JSON.stringify({ source: 'stage' }) })
	assert.strictEqual(bad.status, 400)
	assert.match(String(bad.body), /unknown Zoom source/)
	const badUrl = await h['POST /api/zoom/launch']({ ctx: {}, body: JSON.stringify({ url: 'hello' }) })
	assert.match(String(badUrl.body), /not a Zoom meeting link|not installed/)
})

test('launch: Zoom audio env (PULSE_* only) joins the user-session env; nothing else from the caller', async () => {
	const seen = []
	const s = createZoomSession({
		exists: () => true,
		spawn: (bin, args, o) => (seen.push({ bin, args, env: o.env }), { unref() {} }),
		timers: { setInterval: () => ({ unref() {} }), clearInterval: () => {} },
	})
	await s.launch({ url: '81234567890', env: { PULSE_SERVER: 'unix:/run/user/1000/highascg-zoom-audio/native', PULSE_SINK: 'highascg_zoom_in', LD_PRELOAD: '/evil.so' } })
	assert.strictEqual(seen[0].env.PULSE_SERVER, 'unix:/run/user/1000/highascg-zoom-audio/native')
	assert.strictEqual(seen[0].env.PULSE_SINK, 'highascg_zoom_in')
	assert.notStrictEqual(seen[0].env.LD_PRELOAD, '/evil.so')
	// in its own user scope (a node restart must not end the meeting)
	assert.strictEqual(seen[0].bin, '/usr/bin/systemd-run')
	assert.deepStrictEqual(seen[0].args, ['--user', '--scope', '--collect', '--quiet', '--', '/usr/bin/zoom', '--url=zoommtg://zoom.us/join?action=join&confno=81234567890'])
	assert.ok(seen[0].env.DBUS_SESSION_BUS_ADDRESS, 'systemd-run --user needs the session bus')
	await s.launch({})
	assert.strictEqual(seen[1].env.PULSE_SERVER, process.env.PULSE_SERVER, 'audio off: no PULSE_* added')
})

test('a Zoom started from the dock or the app launcher gets the same session + audio env (10.11: it had none)', async () => {
	const { zoomClientEnv, isZoomBin, prepareZoomAppLaunch } = require('../../src/zoom/zoom-launch-env')
	assert.ok(isZoomBin('/usr/bin/zoom'))
	assert.ok(!isZoomBin('/usr/bin/zoomies') && !isZoomBin('/usr/bin/firefox'))
	assert.deepStrictEqual(zoomClientEnv({ PULSE_SERVER: 'unix:/x/native', LD_PRELOAD: '/evil.so' }, 1000), {
		XDG_RUNTIME_DIR: '/run/user/1000',
		DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
		PULSE_SERVER: 'unix:/x/native',
	})
	let restored = 0
	const audio = { restore: async () => void restored++, zoomEnv: () => ({ PULSE_SERVER: 'unix:/x/native', PULSE_SINK: 'highascg_zoom_in', PULSE_SOURCE: 'highascg_zoom_out' }) }
	const deps = { resolveAppLaunch: (a) => (a === 'app:Zoom' ? { bin: '/usr/bin/zoom', args: [] } : a === 'app:vlc' ? { bin: '/usr/bin/vlc', args: [] } : null), getZoomAudio: () => audio }
	const env = await prepareZoomAppLaunch('app:Zoom', {}, deps)
	assert.strictEqual(restored, 1, 'the private daemon is brought back before Zoom looks for a sound server')
	assert.strictEqual(env.PULSE_SINK, 'highascg_zoom_in')
	assert.strictEqual(env.PULSE_SOURCE, 'highascg_zoom_out')
	assert.ok(env.XDG_RUNTIME_DIR)
	assert.strictEqual(await prepareZoomAppLaunch('app:vlc', {}, deps), null)
	assert.strictEqual(await prepareZoomAppLaunch('app:gone', {}, deps), null)
	assert.strictEqual(await prepareZoomAppLaunch('firefox', {}, deps), null)
	assert.strictEqual(restored, 1)

	// the dock passes it on to the spawn
	const { launchOrFocus } = require('../../src/system/operator-dock')
	const spawned = []
	const r = await launchOrFocus('app:Zoom', { config: {} }, {
		isHelperAction: () => true,
		findGuiWindowIds: async () => [],
		spawnGuiDetached: (a, o) => (spawned.push(o), '/usr/bin/zoom'),
		prepareZoomAppLaunch: async () => env,
	})
	assert.strictEqual(r.status, 200)
	assert.strictEqual(spawned[0].extraEnv.PULSE_SERVER, 'unix:/x/native')
})

test('user scope: plain argv when there is no systemd-run or no user manager', () => {
	const { userScopeArgv } = require('../../src/zoom/zoom-launch-env')
	assert.deepStrictEqual(userScopeArgv('/usr/bin/zoom', ['x'], { exists: () => false }), { bin: '/usr/bin/zoom', args: ['x'], scoped: false })
	assert.deepStrictEqual(userScopeArgv('/usr/bin/zoom', [], { exists: (p) => p === '/usr/bin/systemd-run', uid: 1000 }).scoped, false)
	assert.strictEqual(userScopeArgv('/usr/bin/zoom', [], { exists: () => true, uid: 1000 }).scoped, true)
})

test('bindings survive a node restart and a Quit: saved by title, restored when the window is back', async () => {
	const os = require('os')
	const fs = require('fs')
	const path = require('path')
	const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zoom-src-')), 'zoom-sources.json')
	let wins = [
		{ id: '0x1', title: 'Meeting', width: 1188, height: 800, role: 'meeting' },
		{ id: '0x2', title: 'Zoom Workplace', width: 560, height: 244, role: 'home' },
		{ id: '0x3', title: 'Zoom Workplace', width: 1188, height: 800, role: 'home' },
	]
	const mk = () => {
		const grabs = []
		const s = createZoomSession({
			stateFile,
			exists: () => true,
			exec: async () => ({ stdout: '' }),
			listWindows: async () => wins,
			guiRect: async () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
			ensureBinary: () => ({ ok: true, bin: '/x' }),
			createGrab: (o) => {
				const g = { ...o, alive: true, sent: [], status: { window: o.window }, setWindow: (w) => g.sent.push(`window ${w}`), below: () => g.sent.push('below'), normal: () => g.sent.push('normal'), move: (...a) => g.sent.push(`move ${a.join(' ')}`), stop: () => (g.alive = false) }
				grabs.push(g)
				return g
			},
			timers: { setInterval: () => ({ unref() {} }), clearInterval: () => {} },
		})
		return { s, grabs }
	}
	const a = mk()
	await a.s.assign('presenter', { window: '0x1' })
	await a.s.assign('gallery', { window: '0x3', hidden: true })
	assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(stateFile, 'utf8'))).sort(), ['gallery', 'presenter'])

	// "node restart": a new session, Zoom recreated nothing but the ids differ; the dialog shares the title
	wins = [
		{ id: '0xa', title: 'Zoom Workplace', width: 560, height: 244, role: 'home' },
		{ id: '0xb', title: 'Zoom Workplace', width: 1188, height: 800, role: 'home' },
	]
	const b = mk()
	await b.s.restore()
	let st = await b.s.status()
	assert.strictEqual(st.sources.gallery.window, null, 'no meeting window yet: nothing is bound by itself (a starting Zoom titles its home window "Zoom Workplace")')
	assert.strictEqual(st.sources.presenter.window, null)
	wins.push({ id: '0xc', title: 'Meeting', width: 1188, height: 800, role: 'meeting' })
	wins.push({ id: '0xh', title: 'Zoom Workplace - Free account', width: 1280, height: 960, role: 'home' })
	await b.s.restore()
	st = await b.s.status()
	assert.strictEqual(st.sources.gallery.window, '0xb', 'the large window of that title, not the dialog, never the home window')
	assert.strictEqual(st.sources.gallery.hidden, true)
	assert.ok(b.grabs.some((g) => g.sent.includes('below')))
	assert.strictEqual(st.sources.presenter.window, '0xc')

	// Quit keeps them for the next Zoom start; an explicit unbind forgets
	await b.s.quit()
	wins = [{ id: '0xd', title: 'Meeting', width: 1188, height: 800, role: 'meeting' }]
	await b.s.restore()
	assert.strictEqual((await b.s.status()).sources.presenter.window, '0xd')
	await b.s.assign('presenter', { window: null })
	assert.ok(!('presenter' in JSON.parse(fs.readFileSync(stateFile, 'utf8'))))
})

test('automatic binding: only in a meeting, only large windows, never the home window or a dialog', () => {
	const { autoBindable, guessRole } = require('../../src/zoom/zoom-windows')
	assert.strictEqual(guessRole('Meeting'), 'meeting')
	const home = { id: '0x1', title: 'Zoom Workplace', width: 1280, height: 960 } // the home window while Zoom starts
	const preview = { id: '0x2', title: "host's Zoom Meeting", width: 638, height: 510 }
	assert.deepStrictEqual(autoBindable([home, preview]), [], 'no meeting window: nothing')
	const meeting = { id: '0x3', title: 'Meeting', width: 1188, height: 800 }
	const second = { id: '0x4', title: 'Zoom Workplace', width: 1188, height: 800 }
	const dialog = { id: '0x5', title: 'Zoom Workplace', width: 560, height: 244 }
	const realHome = { id: '0x6', title: 'Zoom Workplace - Free account', width: 1280, height: 960 }
	assert.deepStrictEqual(autoBindable([meeting, second, dialog, realHome]).map((w) => w.id), ['0x3', '0x4'])
})
