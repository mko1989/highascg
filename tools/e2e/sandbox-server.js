'use strict'

/**
 * WO-719 — a throwaway HighAsCG server for end-to-end tests. Everything it writes lives under one scratch root:
 * one config file of overrides (factory defaults for the rest), projects, persistence state, media (generated test
 * clips), caches (cwd = root), a scratch HOME. It runs `--no-caspar` (the WO-453 simulated Caspar answers INFO/CLS/PLAY from its own playback state) with
 * HIGHASCG_SANDBOX=1, which turns off every machine-wide side effect (src/bootstrap/sandbox.js lists them).
 *
 * NEVER point any of this at the live server: scenarios create, wipe and re-cable shows.
 *
 *   const sb = await startSandbox({ root, port })   // → { url, port, root, stop() }
 */

const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const http = require('http')
const net = require('net')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer()
		s.once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address()
			s.close(() => resolve(port))
		})
	})
}

function getJson(url) {
	return new Promise((resolve, reject) => {
		http
			.get(url, (res) => {
				const c = []
				res.on('data', (d) => c.push(d))
				res.on('end', () => {
					try {
						resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(c).toString('utf8') || 'null') })
					} catch (e) {
						reject(e)
					}
				})
			})
			.on('error', reject)
	})
}

/** Small real media files the simulated Caspar's CLS scan finds (cached per root). */
function writeFixtureMedia(mediaDir) {
	fs.mkdirSync(mediaDir, { recursive: true })
	const ff = (args, out) => {
		if (fs.existsSync(out)) return
		execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args, out], { stdio: 'inherit' })
	}
	ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25', '-t', '4', '-pix_fmt', 'yuv420p'], path.join(mediaDir, 'e2e_bars.mp4'))
	ff(['-f', 'lavfi', '-i', 'smptebars=size=1920x1080', '-frames:v', '1'], path.join(mediaDir, 'e2e_still.png'))
	ff(['-f', 'lavfi', '-i', 'sine=frequency=1000:duration=4'], path.join(mediaDir, 'e2e_tone.wav'))
}

/**
 * @param {{ root: string, port?: number, log?: (s: string) => void, media?: boolean, config?: object, caspar?: { host: string, port: number } }} opts
 *   media: false skips the ffmpeg fixture clips (WO-725 cluster runs, CI has no ffmpeg); config: extra top-level
 *   overrides for a fresh root (e.g. `replication.selfId`, the server's id once linked); caspar: a THROWAWAY Caspar
 *   instance to drive instead of the simulated one (WO-744 tools/e2e/shm-source-take.js) — never the box's own.
 */
async function startSandbox(opts) {
	const root = path.resolve(opts.root)
	const port = opts.port || (await freePort())
	const log = opts.log || (() => {})
	const oscPort = await freePort()
	const dirs = {
		projects: path.join(root, 'projects'),
		media: path.join(root, 'media'),
		home: path.join(root, 'home'),
		run: path.join(root, 'run'),
	}
	for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true })
	if (opts.media !== false) writeFixtureMedia(dirs.media)
	// Fresh-box config: one file of overrides; ConfigManager fills everything else from the factory defaults.
	// Every path / port that defaults to the live box is pointed into the root (see the WO-719 isolation table).
	const configFile = path.join(root, 'highascg.config.json')
	if (!fs.existsSync(configFile)) {
		fs.writeFileSync(configFile, JSON.stringify({
			offline_mode: true,
			local_media_path: dirs.media,
			local_template_path: '',
			startup: { mode: 'headless' },
			usbIngest: { autoMount: false },
			dmx: { artnetInputEnabled: false },
			osc: { enabled: true, listenPort: oscPort, listenAddress: '127.0.0.1' },
			casparServer: { configPath: path.join(root, 'casparcg.config') },
			replication: { enabled: false },
			security: { enforceAuth: false, exposeToNetwork: false },
			server: { httpPort: port, bindAddress: '127.0.0.1' },
			...(opts.caspar ? { offline_mode: false, caspar: { host: opts.caspar.host, port: opts.caspar.port } } : {}),
			...opts.config,
		}, null, 2))
	}
	const exfatMap = path.join(root, 'exfat-sync.json')
	fs.writeFileSync(exfatMap, JSON.stringify({ version: 2, volumes: { bridge: { mount: path.join(root, 'nobridge') }, usb: { mount: path.join(root, 'nousb') } }, pairs: [] }))

	const env = {
		...process.env,
		HIGHASCG_SANDBOX: '1', // src/bootstrap/sandbox.js — the guards without an env of their own
		HIGHASCG_CONFIG_PATH: configFile,
		HIGHASCG_PROJECTS_DIR: dirs.projects,
		HIGHASCG_STATE_FILE: path.join(root, 'state.json'),
		HIGHASCG_DEVICE_IDENTITY_PATH: path.join(root, 'device-identity.json'), // WO-723: its own cluster key
		HIGHASCG_EXFAT_SYNC_ON_SAVE: '0',
		HIGHASCG_EXFAT_SYNC_MAP: exfatMap,
		HIGHASCG_SYSTEM_INVENTORY_PATH: path.join(root, 'inventory.json'),
		HIGHASCG_OS_LAYOUT_WATCHDOG: '0',
		HIGHASCG_HEADLESS: 'true',
		HIGHASCG_NO_STARTUP_LED_TEST: '1',
		HIGHASCG_TRACKING: '0',
		HIGHASCG_PREVIS: '0',
		HIGHASCG_AUTOFOLLOW: '0',
		HIGHASCG_PRESENTERS_DIR: path.join(root, 'presenters'),
		HIGHASCG_GDTF_SHARE_DIR: path.join(root, 'gdtf'),
		HIGHASCG_CASPAR_LOG_DIR: path.join(root, 'caspar-logs'),
		HIGHASCG_PGM_RECORD_DIR: path.join(root, 'recordings'),
		CASPAR_SCREEN_GATE_FILE: path.join(dirs.run, 'gate'),
		CASPAR_SCREEN_HOLD_FILE: path.join(dirs.run, 'hold'),
		CASPAR_CONFIG_PATH: path.join(root, 'casparcg.config'),
		HOME: dirs.home, // anything still reaching for ~ (bridge, exfat, .highascg, openbox) finds an empty scratch home
		XAUTHORITY: '/nonexistent', // no X access to the live :0 even if a path slips through
		DISPLAY: '',
	}
	const out = fs.openSync(path.join(root, 'server.log'), 'a')
	const child = spawn(process.execPath, [path.join(REPO_ROOT, 'index.js'), ...(opts.caspar ? [] : ['--no-caspar']), '--port', String(port), '--bind', '127.0.0.1'], {
		cwd: root,
		env,
		stdio: ['ignore', out, out],
	})
	const url = `http://127.0.0.1:${port}`
	const until = Date.now() + 45000
	let up = false
	while (Date.now() < until && child.exitCode === null) {
		try {
			const r = await getJson(`${url}/api/settings`)
			if (r.status === 200) {
				up = true
				break
			}
		} catch {
			/* not listening yet */
		}
		await new Promise((r) => setTimeout(r, 300))
	}
	const stop = () =>
		new Promise((resolve) => {
			if (child.exitCode !== null) return resolve()
			child.once('exit', () => resolve())
			child.kill('SIGTERM')
			setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 5000)
		})
	if (!up) {
		await stop()
		throw new Error(`sandbox server did not come up on ${url} — see ${path.join(root, 'server.log')}`)
	}
	log(`sandbox server ${url} (pid ${child.pid}, root ${root})`)
	return { url, port, root, dirs, pid: child.pid, stop }
}

module.exports = { startSandbox, freePort, getJson, writeFixtureMedia }
