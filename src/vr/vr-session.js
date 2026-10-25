'use strict'

/**
 * WO-770 — an explicit "start VR session" from the operator GUI.
 *
 * Owner rule: WiVRn is never enabled at login; it runs only while a VR session is needed. So the operator GUI
 * starts it (`systemctl --user start wivrn`, never `enable`), shows the pairing PIN, launches the XR Godot client
 * (godot/client/run-xr.sh) and a watcher stops WiVRn again once that client has gone.
 *
 * The node server is a system service (User=casparcg) with NO user-session env, so every `systemctl --user` /
 * `busctl --user` call gets XDG_RUNTIME_DIR + DBUS_SESSION_BUS_ADDRESS pointing at /run/user/<uid>. WiVRn's state
 * is read over its D-Bus interface (io.github.wivrn.Server); the paired headsets' public keys (KnownKeys) are
 * never returned — names only.
 *
 * `createVrSession(deps)` takes injectable exec / spawn / procScan / kill / timers so the smoke test runs without
 * systemd or D-Bus. The default export is the instance wired to the real box.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

const WIVRN_BIN = '/usr/bin/wivrn-server'
const BUS_NAME = 'io.github.wivrn.Server'
const BUS_PATH = '/io/github/wivrn/Server'
const PROPS = ['HeadsetConnected', 'SessionRunning', 'PairingEnabled', 'Pin', 'SystemName', 'KnownKeys']
const EXEC_TIMEOUT_MS = 3000
const READY_TIMEOUT_MS = 10000
const READY_POLL_MS = 250
const WATCH_POLL_MS = 5000
const WATCH_MAX_MS = 15 * 60 * 1000
const DEFAULT_PAIR_MIN = 5
const RUN_XR = path.join(__dirname, '../..', 'godot/client/run-xr.sh')

/**
 * @param {string[]} argv an XR client is the godot binary started with `--xr-mode` (run-xr.sh execs it), or run-xr.sh
 * itself while it still waits for the headset (bash, before the exec) — else Start would launch a second one
 */
function isXrClientArgv(argv) {
	if (argv.length === 0) return false
	if (/^godot/i.test(path.basename(argv[0]))) return argv.includes('--xr-mode')
	const script = /^(ba|da)?sh$/.test(path.basename(argv[0])) ? argv[1] : argv[0]
	return path.basename(String(script || '')) === 'run-xr.sh'
}

/** Real /proc scan → [{ pid }] of XR Godot clients. */
function scanProc() {
	const out = []
	let names
	try {
		names = fs.readdirSync('/proc')
	} catch {
		return out
	}
	for (const n of names) {
		if (!/^\d+$/.test(n)) continue
		try {
			const argv = fs.readFileSync(`/proc/${n}/cmdline`, 'utf8').split('\0').filter(Boolean)
			if (isXrClientArgv(argv)) out.push({ pid: Number(n) })
		} catch {
			/* process gone */
		}
	}
	return out
}

/** @returns {Promise<{ stdout: string, stderr: string }>} */
function realExec(file, args, opts) {
	return new Promise((resolve, reject) => {
		execFile(file, args, { timeout: EXEC_TIMEOUT_MS, ...opts }, (err, stdout, stderr) => {
			if (err) {
				err.stdout = stdout
				err.stderr = stderr
				reject(err)
			} else resolve({ stdout: String(stdout), stderr: String(stderr) })
		})
	})
}

function realSpawnXr(file, opts) {
	const { spawn } = require('child_process')
	const logDir = path.join(os.homedir(), '.highascg', 'log')
	fs.mkdirSync(logDir, { recursive: true })
	const fd = fs.openSync(path.join(logDir, 'godot-xr.log'), 'a')
	const child = spawn(file, [], { ...opts, stdio: ['ignore', fd, fd], detached: true })
	child.on('error', () => {})
	child.unref()
	try {
		fs.closeSync(fd)
	} catch {
		/* ignore */
	}
	return child
}

/** @param {object} [deps] */
function createVrSession(deps = {}) {
	const uid = typeof deps.uid === 'number' ? deps.uid : process.getuid ? process.getuid() : 0
	const exec = deps.exec || realExec
	const spawnXr = deps.spawn || realSpawnXr
	const procScan = deps.procScan || scanProc
	const kill = deps.kill || ((pid, sig) => process.kill(pid, sig))
	const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)))
	const now = deps.now || (() => Date.now())
	const setIv = deps.setInterval || setInterval
	const clearIv = deps.clearInterval || clearInterval
	const installedFn = deps.installed || (() => fs.existsSync(WIVRN_BIN))
	const runXr = deps.runXr || RUN_XR
	const baseEnv = deps.env || process.env
	const getXAuth = deps.getXAuthority || (() => require('../utils/hardware-info').getXAuthority())
	const godotBin = deps.godotBin === undefined ? path.join(os.homedir(), '.local/opt/godot/godot') : deps.godotBin
	const godotExists = deps.godotExists || ((p) => fs.existsSync(p))

	const busEnv = () => ({
		...baseEnv,
		XDG_RUNTIME_DIR: `/run/user/${uid}`,
		DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${uid}/bus`,
	})
	const sctl = (...a) => exec('systemctl', ['--user', ...a], { env: busEnv() })
	const busctl = (...a) => exec('busctl', ['--user', ...a], { env: busEnv() })

	let starting = false
	let lastError = ''
	let watcher = null
	let watchStarted = 0
	let clientSeen = false

	async function isServerRunning() {
		try {
			const { stdout } = await sctl('is-active', 'wivrn')
			return stdout.trim() === 'active'
		} catch {
			return false
		}
	}

	/** One get-property call, several props → one JSON object per line, in the order asked. Throws if unreadable. */
	async function readProps() {
		const { stdout } = await busctl('--json=short', 'get-property', BUS_NAME, BUS_PATH, BUS_NAME, ...PROPS)
		const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
		if (lines.length !== PROPS.length) throw new Error('unexpected D-Bus reply')
		const v = {}
		PROPS.forEach((p, i) => {
			v[p] = JSON.parse(lines[i]).data
		})
		const names = Array.isArray(v.KnownKeys) ? v.KnownKeys.map((k) => String(k[0])) : []
		return {
			headsetConnected: !!v.HeadsetConnected,
			sessionRunning: !!v.SessionRunning,
			pairingEnabled: !!v.PairingEnabled,
			pin: String(v.Pin || ''),
			systemName: String(v.SystemName || ''),
			paired: names,
		}
	}

	async function status() {
		const clients = procScan()
		const serverRunning = await isServerRunning()
		let dbus = { headsetConnected: false, sessionRunning: false, pairingEnabled: false, pin: '', systemName: '', paired: [] }
		if (serverRunning) {
			try {
				dbus = await readProps()
			} catch {
				/* just started / shutting down: leave defaults */
			}
		}
		const st = {
			installed: !!installedFn(),
			serverRunning,
			...dbus,
			clientRunning: clients.length > 0,
			starting,
			error: lastError,
		}
		if (clients.length) st.clientPid = clients[0].pid
		return st
	}

	async function enablePairing(minutes) {
		const { stdout } = await busctl('--json=short', 'call', BUS_NAME, BUS_PATH, BUS_NAME, 'EnablePairing', 'i', String(minutes))
		try {
			return String(JSON.parse(stdout.trim()).data[0] || '')
		} catch {
			return ''
		}
	}

	function stopWatcher() {
		if (watcher) clearIv(watcher)
		watcher = null
	}

	/** One watcher tick (exported for the smoke test): stop WiVRn once the client has come and gone, or never came. */
	async function watchTick() {
		if (!watcher) return
		const running = procScan().length > 0
		if (running) clientSeen = true
		if (running || !(clientSeen || now() - watchStarted >= WATCH_MAX_MS)) return
		stopWatcher()
		try {
			await sctl('stop', 'wivrn')
		} catch (e) {
			lastError = `wivrn stop failed: ${e.message}`
		}
	}

	function startWatcher() {
		stopWatcher()
		clientSeen = false
		watchStarted = now()
		watcher = setIv(() => {
			watchTick().catch(() => {})
		}, WATCH_POLL_MS)
		if (watcher && typeof watcher.unref === 'function') watcher.unref()
	}

	function launchClient() {
		const env = { ...baseEnv, DISPLAY: ':0', XAUTHORITY: getXAuth(), XR_WAIT_S: '600' }
		if (godotBin && godotExists(godotBin)) env.GODOT = godotBin
		spawnXr(runXr, { env, cwd: path.dirname(runXr) })
	}

	async function start() {
		if (starting) return { ok: true, ...(await status()) }
		starting = true
		lastError = ''
		try {
			await sctl('start', 'wivrn')
			let props = null
			const t0 = now()
			for (;;) {
				try {
					props = await readProps()
					break
				} catch (e) {
					if (now() - t0 >= READY_TIMEOUT_MS) throw new Error(`WiVRn D-Bus not ready: ${e.message}`, { cause: e })
					await sleep(READY_POLL_MS)
				}
			}
			if (props.paired.length === 0) await enablePairing(DEFAULT_PAIR_MIN)
			if (procScan().length === 0) launchClient()
			startWatcher()
			starting = false
			return { ok: true, ...(await status()) }
		} catch (e) {
			lastError = e.message || String(e)
			starting = false
			return { ok: false, error: lastError }
		}
	}

	async function pair(minutes) {
		if (!(await isServerRunning())) return { ok: false, notRunning: true, error: 'WiVRn is not running' }
		const m = Math.min(30, Math.max(1, Math.round(Number(minutes) || DEFAULT_PAIR_MIN)))
		try {
			return { ok: true, pin: await enablePairing(m) }
		} catch (e) {
			return { ok: false, error: e.message || String(e) }
		}
	}

	async function stop() {
		stopWatcher()
		for (const c of procScan()) {
			try {
				kill(c.pid, 'SIGTERM')
			} catch {
				/* already gone */
			}
		}
		try {
			await sctl('stop', 'wivrn')
		} catch (e) {
			lastError = `wivrn stop failed: ${e.message}`
		}
		return { ok: true, ...(await status()) }
	}

	return { status, start, pair, stop, watchTick, _watching: () => !!watcher }
}

module.exports = { createVrSession, isXrClientArgv, instance: createVrSession() }
