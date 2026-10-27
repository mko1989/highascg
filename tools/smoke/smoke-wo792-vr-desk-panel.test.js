'use strict'

/** WO-792 — the MagicQ panel in the headset: WayVR --headless + MagicQ on its X display; stop leaves a desktop MagicQ. */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createDeskPanel, classify, findWayvr, pgrpOf } = require('../../src/vr/vr-desk-panel')
const { createVrSession } = require('../../src/vr/vr-session')

function rig(opts = {}) {
	const st = { procs: opts.procs ? [...opts.procs] : [], state: opts.state ?? null, t: 0, nextPid: 500 }
	const spawns = []
	const kills = []
	const desk = createDeskPanel({
		uid: 1000,
		env: { PATH: '/usr/bin', WAYLAND_DISPLAY: 'wayland-0', XAUTHORITY: '/x' },
		wayvrDir: '/w',
		magicqRun: '/opt/magicq/runmagicq.sh',
		readdir: () => opts.files ?? ['WayVR-v26.8.0-x86_64.AppImage', 'notes.txt'],
		exists: (p) => opts.magicq !== false && p === '/opt/magicq/runmagicq.sh',
		getXAuthority: () => '/home/x/.Xauthority',
		procScan: () => st.procs,
		spawn: (file, args, o, log) => {
			spawns.push({ file, args, env: o.env, cwd: o.cwd, log })
			const pid = st.nextPid++
			if (/WayVR/.test(file) && opts.satellite !== false)
				st.procs.push({ pid, pgid: pid, kind: 'wayvr' }, { pid: pid + 1, pgid: pid, kind: 'satellite', display: ':20' })
			if (/runmagicq/.test(file)) st.procs.push({ pid: pid + 1, pgid: pid, kind: 'magicq' })
			return { pid }
		},
		kill: (pid, sig) => {
			kills.push([pid, sig])
			st.procs = st.procs.filter((p) => p.pid !== pid)
		},
		readState: () => {
			if (!st.state) throw new Error('ENOENT')
			return st.state
		},
		writeState: (o) => {
			st.state = o
		},
		sleep: async () => {
			st.t += 250
		},
		now: () => st.t,
	})
	return { desk, st, spawns, kills }
}

test('argv classification, process group, newest AppImage', () => {
	assert.deepEqual(classify(['./WayVR-v26.8.0-x86_64.AppImage', '--openxr']), { kind: 'wayvr' })
	assert.deepEqual(classify(['/tmp/.mount_WayVR-PpoOFm/usr/bin/wayvr']), { kind: 'wayvr' })
	assert.deepEqual(classify(['/tmp/.mount_WayVR-PpoOFm/usr/bin/xwayland-satellite', ':20']), {
		kind: 'satellite',
		display: ':20',
	})
	assert.deepEqual(classify(['/opt/magicq/bin/mqqt']), { kind: 'magicq' })
	assert.equal(classify(['/usr/bin/wayvr-dashboard']), null)
	assert.equal(classify(['bash', '/opt/magicq/runmagicq.sh']), null)
	assert.equal(pgrpOf('1494049 (mqqt (x)) S 1494040 1494040 1494040 0 -1'), 1494040)
	const dir = ['WayVR-v26.8.0-x86_64.AppImage', 'WayVR-v26.10.0-x86_64.AppImage', 'WayVR.zsync']
	assert.equal(
		findWayvr('/w', () => dir),
		'/w/WayVR-v26.10.0-x86_64.AppImage'
	)
	assert.equal(
		findWayvr('/w', () => {
			throw new Error('ENOENT')
		}),
		''
	)
})

test('start: WayVR headless with the session env, then MagicQ on its X display (xcb, no Wayland)', async () => {
	const { desk, st, spawns } = rig()
	const r = await desk.start({ serverRunning: true })
	assert.equal(r.ok, true, r.error)
	assert.equal(spawns.length, 2)
	const [w, m] = spawns
	assert.equal(w.file, '/w/WayVR-v26.8.0-x86_64.AppImage')
	assert.deepEqual(w.args, ['--openxr', '--headless', '--show', '--no-autostart', '--wait'])
	assert.equal(w.env.XDG_RUNTIME_DIR, '/run/user/1000')
	assert.equal(w.env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/run/user/1000/bus')
	assert.equal(w.env.DISPLAY, ':0')
	assert.equal(m.file, '/opt/magicq/runmagicq.sh')
	assert.equal(m.cwd, '/opt/magicq')
	assert.equal(m.env.DISPLAY, ':20')
	assert.equal(m.env.QT_QPA_PLATFORM, 'xcb')
	assert.equal(m.env.WAYLAND_DISPLAY, undefined)
	assert.equal(m.env.XAUTHORITY, undefined)
	assert.deepEqual(st.state, { pgid: 501, display: ':20' })
	assert.equal(r.magicqRunning, true)
	assert.equal(r.display, ':20')
	const again = await desk.start({ serverRunning: true })
	assert.equal(again.ok, true)
	assert.equal(spawns.length, 2, 'a second Start launches nothing')
})

test('start refuses: no VR session, nothing installed, a desktop MagicQ, no X display', async () => {
	assert.match((await rig().desk.start({ serverRunning: false })).error, /Start the VR session first/)
	assert.match((await rig({ files: [] }).desk.start({ serverRunning: true })).error, /WayVR is not installed/)
	assert.match((await rig({ magicq: false }).desk.start({ serverRunning: true })).error, /MagicQ is not installed/)
	const desktop = rig({ procs: [{ pid: 77, pgid: 70, kind: 'magicq' }] })
	const r = await desktop.desk.start({ serverRunning: true })
	assert.match(r.error, /already running on the desktop/)
	assert.equal(r.magicqOnDesktop, true)
	assert.equal(desktop.spawns.filter((s) => /runmagicq/.test(s.file)).length, 0)
})

test('no headset yet: WayVR waits, MagicQ opens once its X display appears; End cancels the wait', async () => {
	const late = rig({ satellite: false })
	const r = await late.desk.start({ serverRunning: true })
	assert.equal(r.ok, true)
	assert.equal(r.pending, true)
	assert.equal(late.spawns.length, 1, 'WayVR only, for now')
	assert.equal((await late.desk.start({ serverRunning: true })).pending, true, 'a second Start waits on the same')
	late.st.procs.push({ pid: 900, pgid: 500, kind: 'satellite', display: ':21' })
	await late.desk._settled()
	assert.equal(late.spawns.length, 2)
	assert.equal(late.spawns[1].env.DISPLAY, ':21')
	assert.equal(late.desk.status().pending, false)

	const never = rig({ satellite: false })
	await never.desk.start({ serverRunning: true })
	await never.desk._settled()
	assert.match(never.desk.status().error, /no X display.*headset connected.*xwayland/)
	assert.equal(never.spawns.length, 1)

	const cancelled = rig({ satellite: false })
	await cancelled.desk.start({ serverRunning: true })
	await cancelled.desk.stop()
	cancelled.st.procs.push({ pid: 900, pgid: 500, kind: 'satellite', display: ':21' })
	await cancelled.desk._settled()
	assert.equal(
		cancelled.spawns.filter((x) => /runmagicq/.test(x.file)).length,
		0,
		'stopped before the display came: no MagicQ'
	)
})

test('stop: our MagicQ first, then WayVR; a desktop MagicQ is left alone', async () => {
	const { desk, st, kills } = rig({ procs: [{ pid: 77, pgid: 70, kind: 'magicq' }] })
	st.state = { pgid: 501, display: ':20' }
	st.procs.push({ pid: 500, pgid: 500, kind: 'wayvr' }, { pid: 502, pgid: 501, kind: 'magicq' })
	const r = await desk.stop()
	assert.equal(r.ok, true)
	assert.deepEqual(kills, [
		[502, 'SIGTERM'],
		[500, 'SIGTERM'],
	])
	assert.equal(st.state, null)
	assert.deepEqual(st.procs, [{ pid: 77, pgid: 70, kind: 'magicq' }])
})

test('VR session: status carries the desk, End and the exit watcher stop it before WiVRn', async () => {
	const order = []
	const desk = {
		status: () => ({ available: true, magicqRunning: true }),
		start: async (ctx) => ({ ok: true, ctx }),
		stop: async () => {
			order.push('desk')
			return { ok: true }
		},
	}
	let active = true
	let clients = [{ pid: 9 }]
	let tick = null
	const exec = async (file, args) => {
		if (args[1] === 'is-active') {
			if (!active) throw new Error('inactive')
			return { stdout: 'active\n', stderr: '' }
		}
		if (args[1] === 'stop') {
			order.push('wivrn')
			active = false
		}
		if (args.includes('get-property')) {
			if (!active) throw new Error('no bus')
			const v = [false, true, false, '', 'Quest', [['Quest', 'k', 1]]]
			return { stdout: v.map((data) => JSON.stringify({ data })).join('\n') + '\n', stderr: '' }
		}
		return { stdout: '', stderr: '' }
	}
	const vr = createVrSession({
		uid: 1000,
		desk,
		exec,
		procScan: () => clients,
		kill: () => {},
		installed: () => true,
		setInterval: (fn) => {
			tick = fn
			return { unref() {} }
		},
		clearInterval: () => {},
	})
	assert.deepEqual((await vr.status()).desk, { available: true, magicqRunning: true })
	assert.deepEqual((await vr.deskStart()).ctx, { serverRunning: true })
	await vr.stop()
	assert.deepEqual(order, ['desk', 'wivrn'])
	order.length = 0
	active = true
	// watcher: the client was seen, then gone → desk, then WiVRn
	assert.equal((await vr.start()).ok, true)
	assert.ok(tick && vr._watching())
	await vr.watchTick()
	clients = []
	await vr.watchTick()
	assert.deepEqual(order, ['desk', 'wivrn'])
	const plain = createVrSession({ exec, procScan: () => [], installed: () => true })
	assert.equal((await plain.status()).desk, undefined, 'only the box instance has a desk panel')
	assert.equal((await plain.deskStart()).ok, false)
})
