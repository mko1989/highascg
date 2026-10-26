'use strict'

/** WO-770 — VR session: D-Bus status parse, on-demand start (never enable), pairing, stop, exit watcher. */

const test = require('node:test')
const assert = require('node:assert/strict')
const { createVrSession, isXrClientArgv } = require('../../src/vr/vr-session')

const KEY = 'FAKE-PUBLIC-KEY-NOT-A-REAL-HEADSET='

function props({ keys = [[ 'Oculus Quest 3', KEY, 1792956626 ]], headset = false, session = true, pin = '' } = {}) {
	return [
		{ type: 'b', data: headset },
		{ type: 'b', data: session },
		{ type: 'b', data: false },
		{ type: 's', data: pin },
		{ type: 's', data: 'Meta Quest 3' },
		{ type: 'a(ssx)', data: keys },
	].map((o) => JSON.stringify(o)).join('\n') + '\n'
}

function rig(opts = {}) {
	const calls = []
	const spawns = []
	const kills = []
	const st = { active: opts.active ?? true, clients: opts.clients ?? [], keys: opts.keys, dbusFails: opts.dbusFails ?? 0, ivFn: null, cleared: 0, t: 0 }
	const exec = async (file, args, o) => {
		calls.push({ file, args, env: o.env })
		if (file === 'systemctl') {
			if (args[1] === 'is-active') {
				if (!st.active) throw Object.assign(new Error('inactive'), { stdout: 'inactive\n' })
				return { stdout: 'active\n', stderr: '' }
			}
			if (args[1] === 'start') st.active = true
			if (args[1] === 'stop') st.active = false
			return { stdout: '', stderr: '' }
		}
		if (args.includes('get-property')) {
			if (!st.active) throw new Error('no bus name')
			if (st.dbusFails > 0) { st.dbusFails--; throw new Error('not ready') }
			return { stdout: props(st.keys ? { keys: st.keys } : {}), stderr: '' }
		}
		if (args.includes('call')) return { stdout: '{"type":"s","data":["123456"]}\n', stderr: '' }
		throw new Error('unexpected ' + args.join(' '))
	}
	const vr = createVrSession({
		uid: 1000,
		env: { PATH: '/usr/bin' },
		exec,
		spawn: (file, o) => spawns.push({ file, env: o.env }),
		procScan: () => st.clients,
		kill: (pid, sig) => kills.push([pid, sig]),
		sleep: async () => { st.t += 250 },
		now: () => st.t,
		installed: () => true,
		getXAuthority: () => '/run/user/1000/gdm/Xauthority',
		godotBin: '/home/x/godot',
		godotExists: () => true,
		setInterval: (fn) => { st.ivFn = fn; return { unref() {} } },
		clearInterval: () => { st.cleared++; st.ivFn = null },
	})
	return { vr, calls, spawns, kills, st }
}

const sysctl = (calls, verb) => calls.filter((c) => c.file === 'systemctl' && c.args[1] === verb)

test('isXrClientArgv: godot with --xr-mode, or run-xr.sh still waiting for the headset', () => {
	assert.ok(isXrClientArgv(['/x/godot', '--path', '/p', '--xr-mode', 'on']))
	assert.ok(!isXrClientArgv(['/x/godot', '--path', '/p']))
	assert.ok(!isXrClientArgv(['/bin/bash', '-c', 'godot --xr-mode on']))
	assert.ok(isXrClientArgv(['/usr/bin/bash', '/home/c/highascg/godot/client/run-xr.sh']))
	assert.ok(isXrClientArgv(['/home/c/highascg/godot/client/run-xr.sh']))
	assert.ok(!isXrClientArgv(['/usr/bin/bash', '-c', 'tail run-xr.sh.log']))
})

test('status parses D-Bus JSON, names only, user-bus env', async () => {
	const { vr, calls } = rig({ clients: [{ pid: 42 }] })
	const s = await vr.status()
	assert.deepEqual(s, {
		installed: true, serverRunning: true, headsetConnected: false, sessionRunning: true, pairingEnabled: false,
		pin: '', systemName: 'Meta Quest 3', paired: ['Oculus Quest 3'], clientRunning: true, starting: false, error: '', clientPid: 42,
	})
	assert.ok(!JSON.stringify(s).includes(KEY))
	for (const c of calls) {
		assert.equal(c.env.XDG_RUNTIME_DIR, '/run/user/1000')
		assert.equal(c.env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/run/user/1000/bus')
	}
})

test('status with server stopped skips D-Bus', async () => {
	const { vr, calls } = rig({ active: false })
	const s = await vr.status()
	assert.equal(s.serverRunning, false)
	assert.equal(s.clientRunning, false)
	assert.deepEqual(s.paired, [])
	assert.ok(!calls.some((c) => c.file === 'busctl'))
})

test('start: starts wivrn (never enable), waits for D-Bus, pairs only with no keys, spawns client with env', async () => {
	const r = rig({ active: false, keys: [], dbusFails: 2 })
	const out = await r.vr.start()
	assert.equal(out.ok, true)
	assert.equal(sysctl(r.calls, 'start').length, 1)
	assert.deepEqual(sysctl(r.calls, 'start')[0].args, ['--user', 'start', 'wivrn'])
	assert.ok(!r.calls.some((c) => c.args.includes('enable')))
	const pairCall = r.calls.find((c) => c.args.includes('EnablePairing'))
	assert.ok(pairCall)
	assert.deepEqual(pairCall.args.slice(-2), ['i', '5'])
	assert.equal(r.spawns.length, 1)
	assert.match(r.spawns[0].file, /godot\/client\/run-xr\.sh$/)
	const e = r.spawns[0].env
	assert.equal(e.XR_WAIT_S, '600')
	assert.equal(e.DISPLAY, ':0')
	assert.equal(e.XAUTHORITY, '/run/user/1000/gdm/Xauthority')
	assert.equal(e.GODOT, '/home/x/godot')
	// WO-780: WiVRn's OpenXR socket lives in the user runtime dir; the node service has none of its own
	assert.equal(e.XDG_RUNTIME_DIR, '/run/user/1000')
	assert.equal(e.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/run/user/1000/bus')
	assert.ok(r.vr._watching())
})

test('start: known keys → no pairing; client already running → no spawn', async () => {
	const r = rig({ clients: [{ pid: 7 }] })
	await r.vr.start()
	assert.ok(!r.calls.some((c) => c.args.includes('EnablePairing')))
	assert.equal(r.spawns.length, 0)
})

test('start: D-Bus never ready → ok:false, error kept, no spawn', async () => {
	const r = rig({ active: false, dbusFails: 999 })
	const out = await r.vr.start()
	assert.equal(out.ok, false)
	assert.match(out.error, /not ready/)
	assert.equal(r.spawns.length, 0)
	assert.equal((await r.vr.status()).starting, false)
})

test('pair clamps minutes; 409 path when server not running', async () => {
	const r = rig()
	assert.deepEqual(await r.vr.pair(), { ok: true, pin: '123456' })
	assert.equal(r.calls.at(-1).args.at(-1), '5')
	await r.vr.pair(999)
	assert.equal(r.calls.at(-1).args.at(-1), '30')
	await r.vr.pair(-4)
	assert.equal(r.calls.at(-1).args.at(-1), '1')
	const off = rig({ active: false })
	const out = await off.vr.pair(5)
	assert.equal(out.ok, false)
	assert.equal(out.notRunning, true)
})

test('stop kills only the matched pids, stops wivrn, clears watcher', async () => {
	const r = rig({ clients: [{ pid: 99 }] })
	await r.vr.start()
	const out = await r.vr.stop()
	assert.equal(out.ok, true)
	assert.deepEqual(r.kills, [[99, 'SIGTERM']])
	assert.equal(sysctl(r.calls, 'stop').length, 1)
	assert.ok(!r.vr._watching())
})

test('watcher: stops wivrn after the client was seen and exited', async () => {
	const r = rig({ keys: [] })
	await r.vr.start()
	r.st.clients = [{ pid: 5 }]
	await r.vr.watchTick()
	assert.equal(sysctl(r.calls, 'stop').length, 0)
	r.st.clients = []
	await r.vr.watchTick()
	assert.equal(sysctl(r.calls, 'stop').length, 1)
	assert.ok(!r.vr._watching())
})

test('watcher: client never appears → waits, then stops after 15 minutes', async () => {
	const r = rig({ keys: [] })
	await r.vr.start()
	await r.vr.watchTick()
	assert.equal(sysctl(r.calls, 'stop').length, 0)
	r.st.t += 15 * 60 * 1000
	await r.vr.watchTick()
	assert.equal(sysctl(r.calls, 'stop').length, 1)
})
