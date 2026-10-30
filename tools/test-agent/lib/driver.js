'use strict'

/**
 * WO-836 Part 3c — start / stop the test instance: an Xvfb display of its own + one Godot client (--e2e=99_remote)
 * on it, against the sandbox server (--sandbox) or the box's LIVE node (--live). The operator's :0 GUI is never
 * touched. Everything is spawned detached with its pid recorded, so `ui stop` kills by pid (never by pattern).
 */

const { spawn } = require('child_process')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const state = require('./state')
const remote = require('./remote')

const REPO_ROOT = path.resolve(__dirname, '../../..')
const SIZE = '1920x1080'

function findGodot() {
	const cands = [process.env.GODOT, path.join(os.homedir(), '.local/opt/godot/godot'), '/opt/godot/godot', '/usr/local/bin/godot', '/usr/bin/godot']
	return cands.find((c) => c && fs.existsSync(c))
}

function freeDisplay() {
	for (let n = 120; n < 240; n++) {
		if (!fs.existsSync(`/tmp/.X11-unix/X${n}`) && !fs.existsSync(`/tmp/.X${n}-lock`)) return n
	}
	throw new Error('no free X display number between :120 and :239')
}

function freePort(start) {
	return new Promise((resolve, reject) => {
		const tryPort = (p) => {
			if (p > start + 50) return reject(new Error(`no free port from ${start}`))
			const s = net.createServer()
			s.once('error', () => tryPort(p + 1))
			s.listen(p, '127.0.0.1', () => s.close(() => resolve(p)))
		}
		tryPort(start)
	})
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function spawnDetached(cmd, args, opts, logFile) {
	const log = fs.openSync(logFile, 'a')
	const child = spawn(cmd, args, { ...opts, detached: true, stdio: ['ignore', log, log] })
	child.unref()
	return child.pid
}

function kill(pid, sig = 'SIGTERM') {
	if (!pid) return
	try {
		process.kill(pid, sig)
	} catch {
		/* gone */
	}
}

/**
 * @param {{ mode: 'sandbox'|'live', out: string, server?: string, port?: number }} o
 */
async function start(o) {
	const prev = state.readState()
	if (prev && state.alive(prev.pids?.godot)) {
		throw new Error(`a driver is already running (${prev.mode}, display ${prev.display}) — ui stop first`)
	}
	const godot = findGodot()
	if (!godot) throw new Error('Godot not found — set GODOT=/path/to/godot')
	const out = path.resolve(o.out)
	fs.mkdirSync(path.join(out, 'shots'), { recursive: true })
	const pids = {}
	const st = { mode: o.mode, out, pids, startedAt: new Date().toISOString(), size: SIZE }
	try {
		let server = o.server || 'http://127.0.0.1:4200'
		if (o.mode === 'sandbox') {
			const root = path.join(out, 'sandbox')
			fs.mkdirSync(root, { recursive: true })
			pids.sandbox = spawnDetached(process.execPath, [path.join(__dirname, 'sandbox-daemon.js'), root], { cwd: REPO_ROOT }, path.join(out, 'sandbox.log'))
			const info = path.join(root, 'sandbox.json')
			const until = Date.now() + 90000
			while (!fs.existsSync(info) && Date.now() < until && state.alive(pids.sandbox)) await sleep(400)
			if (!fs.existsSync(info)) throw new Error(`the sandbox server did not come up (see ${path.join(out, 'sandbox.log')})`)
			server = JSON.parse(fs.readFileSync(info, 'utf8')).url
			st.sandboxRoot = root
		}
		st.server = server
		const dnum = freeDisplay()
		st.display = `:${dnum}`
		pids.xvfb = spawnDetached('Xvfb', [st.display, '-screen', '0', `${SIZE}x24`, '-nolisten', 'tcp'], {}, path.join(out, 'xvfb.log'))
		const until = Date.now() + 10000
		while (!fs.existsSync(`/tmp/.X11-unix/X${dnum}`) && Date.now() < until) await sleep(150)
		if (!fs.existsSync(`/tmp/.X11-unix/X${dnum}`)) throw new Error(`Xvfb ${st.display} did not start (see ${path.join(out, 'xvfb.log')})`)
		st.port = o.port || (await freePort(6299))
		const userDir = path.join(out, 'godot-user') // user:// (ui.cfg, profiles) in the run folder, never the operator client's
		fs.mkdirSync(userDir, { recursive: true })
		const args = ['--rendering-driver', 'opengl3', '--path', path.join(REPO_ROOT, 'godot/client'), '--resolution', SIZE, '--position', '0,0', '--',
			`--server=${server}`, '--e2e=99_remote', `--e2e-out=${path.join(out, 'godot-shots')}`, `--e2e-remote-port=${st.port}`, '--windowed',
			'--video=feed'] // pictures over the node's WebSocket feed: this client never maps the box's /dev/shm
		// live: HOME stays real so the client adopts ~/highascg/.private/api-token on its own (core/config.gd adopt_local_password)
		pids.godot = spawnDetached(godot, args, { env: { ...process.env, DISPLAY: st.display, XDG_DATA_HOME: userDir, XDG_CONFIG_HOME: userDir, HIGHASCG_SERVER: server } }, path.join(out, 'godot.log'))
		state.writeState(st)
		await remote.waitUp(st.port, 90000)
		// keyboard focus without a window manager: hand it to Godot's window
		try {
			const { xdo } = require('./xinput')
			const wid = xdo(st.display, ['search', '--pid', String(pids.godot)]).split('\n').filter(Boolean).pop()
			if (wid) xdo(st.display, ['windowfocus', wid])
		} catch {
			/* focus follows the pointer on a bare X server anyway */
		}
		return st
	} catch (e) {
		stopPids(pids)
		state.clearState()
		throw e
	}
}

function stopPids(pids) {
	for (const k of ['godot', 'xvfb', 'sandbox']) kill(pids[k])
	setTimeout(() => {
		for (const k of ['godot', 'xvfb', 'sandbox']) if (state.alive(pids[k])) kill(pids[k], 'SIGKILL')
	}, 4000).unref()
}

async function stop() {
	const st = state.readState()
	if (!st) return { stopped: false, note: 'no driver was running' }
	try {
		await remote.send(st.port, { cmd: 'quit' }, 4000)
	} catch {
		/* already gone */
	}
	await sleep(500)
	for (const k of ['godot', 'xvfb', 'sandbox']) kill(st.pids?.[k])
	const until = Date.now() + 5000
	while (Date.now() < until && ['godot', 'xvfb', 'sandbox'].some((k) => state.alive(st.pids?.[k]))) await sleep(200)
	for (const k of ['godot', 'xvfb', 'sandbox']) if (state.alive(st.pids?.[k])) kill(st.pids[k], 'SIGKILL')
	state.clearState()
	return { stopped: true, out: st.out }
}

module.exports = { start, stop, findGodot }
