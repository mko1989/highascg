'use strict'

/**
 * WO-730 — the running app, read only: the live server's GETs, Caspar, the logs since each process started, the kiosk,
 * a headless compile of the client (isolated: its own user-data folder, a dead server address), config + project files.
 * Nothing here sends a command to Caspar or loads a project on the live server (projects load in the sandbox phase).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { REPO, sh, unit, processStartMs, fmtTime } = require('./sweep-util')

/** GETs any server answers quickly and that change nothing (the full route list runs in the sandbox). */
const LIVE_ROUTES = [
	'/api/state',
	'/api/cluster',
	'/api/cluster/identity',
	'/api/system/version',
	'/api/system/time',
	'/api/device-view',
	'/api/video-surfaces',
	'/api/project',
	'/api/project/list',
	'/api/replication/ping',
	'/api/contract/constants',
	'/api/server/senders',
	'/api/media',
	'/api/templates',
	'/api/channels',
	'/api/settings',
]

// Caspar logs a client that hung up as an exception with a stack; frames and that one cause are not errors of ours.
const CASPAR_NOISE = [
	/^\s*\[error\]\s+\d+# /,
	/Dynamic exception type/,
	/std::exception::what: (remote_endpoint: Transport endpoint is not connected|local_endpoint: Bad file descriptor)/,
	/Exception: .*basic_socket(_acceptor)?\.hpp/,
	/^\s*\[error\]\s*$/,
]

/** Journal lines of one unit since it started → { errors: [distinct text], count }. */
function unitErrors(name, re, noise = []) {
	const u = unit(name)
	if (!u || !u.startedMs) return null
	const r = sh('journalctl', ['-u', name, '--since', `@${Math.floor(u.startedMs / 1000)}`, '-o', 'cat', '--no-pager'], {
		timeoutMs: 60000,
	})
	const stamp = /^\[\d{4}-\d\d-\d\d [\d:.]+\]\s*/ // Caspar prefixes its own time
	const lines = r.out.split('\n').filter((l) => re.test(l) && !noise.some((n) => n.test(l.replace(stamp, ''))))
	const distinct = [...new Set(lines.map((l) => l.replace(/^\[[^\]]*\]\s*(\(HACG\)\s*)?/, '').slice(0, 200)))]
	return { count: lines.length, errors: distinct, since: u.startedMs }
}

/** Godot finds its binary the way run-client.sh does. */
function godotBin() {
	for (const c of [
		process.env.GODOT,
		path.join(os.homedir(), '.local/opt/godot/godot'),
		'/opt/godot/godot',
		'/usr/local/bin/godot',
		'/usr/bin/godot',
	])
		if (c && fs.existsSync(c)) return c
	return ''
}

function parseAll(dir, filter) {
	const bad = []
	let n = 0
	let names
	try {
		names = fs.readdirSync(dir).filter(filter)
	} catch {
		return null
	}
	for (const f of names) {
		n++
		try {
			JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
		} catch (e) {
			bad.push(`${f}: ${e.message.slice(0, 120)}`)
		}
	}
	return { n, bad }
}

module.exports = [
	{
		id: 'app.api',
		name: 'live server answers its read-only routes',
		async run({ server }) {
			const bad = []
			const slow = []
			let total = 0
			for (const p of LIVE_ROUTES) {
				const r = await server.get(p, 20000)
				total += r.ms
				if (r.status === 0 || r.status >= 500) bad.push(`${p} → ${r.status || r.error}`)
				else if (r.ms > 2000) slow.push(`${p} ${r.ms} ms`)
			}
			if (bad.length) return { status: 'fail', summary: `${bad.length}/${LIVE_ROUTES.length} failed`, details: bad }
			return {
				status: slow.length ? 'warn' : 'pass',
				summary: `${LIVE_ROUTES.length} routes, ${total} ms total${slow.length ? ` · slow: ${slow.join(', ')}` : ''}`,
			}
		},
	},
	{
		id: 'app.caspar',
		name: 'Caspar connected, channels match the generated config',
		async run({ state }) {
			const c = state?.caspar
			if (!c) return { status: 'fail', summary: 'no caspar block in /api/state' }
			if (!c.connected) return { status: 'fail', summary: `not connected to ${c.host}:${c.port}` }
			const cmp = state.configComparison || {}
			if (cmp.aligned === false)
				return {
					status: 'warn',
					summary: `${c.versionLine} · running ${cmp.serverChannelCount} channels, config says ${cmp.moduleChannelCount}: apply the Caspar config`,
				}
			return { status: 'pass', summary: `${c.versionLine} · ${cmp.serverChannelCount ?? '?'} channels aligned` }
		},
	},
	{
		id: 'app.caspar-config-age',
		name: 'Caspar runs the config file on disk (restarted after it changed)',
		async run() {
			const cfg = path.join(REPO, 'config/casparcg.config')
			const pid = sh('pgrep', ['-x', 'casparcg'])
				.out.trim()
				.split('\n')
				.map(Number)
				.find((p) => {
					try {
						return fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').includes('.config')
					} catch {
						return false
					}
				})
			if (!pid || !fs.existsSync(cfg)) return { status: 'skip', summary: 'no Caspar process / config here' }
			const started = processStartMs(pid)
			const changed = fs.statSync(cfg).mtimeMs
			if (changed > started + 5000 && changed <= Date.now() + 60000)
				return {
					status: 'warn',
					summary: `config changed ${fmtTime(changed)}, Caspar started ${fmtTime(started)}: restart Caspar to use it`,
				}
			return { status: 'pass', summary: `Caspar since ${fmtTime(started)}, config ${fmtTime(changed)}` }
		},
	},
	{
		id: 'app.logs',
		name: 'no errors in the server / Caspar / kiosk logs since they started',
		async run({ kioskStartMs }) {
			const srv = unitErrors('highascg', /\[error\]|Unhandled|TypeError|ReferenceError/)
			const cas = unitErrors('casparcg-server', /\[error\]|\[fatal\]/, CASPAR_NOISE)
			const klog = path.join(os.homedir(), '.local/share/godot/app_userdata/HighAsCG Operator/logs/godot.log')
			let kio = null
			if (fs.existsSync(klog) && kioskStartMs)
				kio = [
					...new Set(
						fs
							.readFileSync(klog, 'utf8')
							.split('\n')
							.filter((l) => /SCRIPT ERROR|Parse Error|Compile Error|^ERROR:/.test(l))
							.map((l) => l.slice(0, 200))
					),
				]
			if (!srv && !cas && !kio) return { status: 'skip', summary: 'no journal / kiosk log here' }
			const parts = [
				`server ${srv ? srv.count : '–'}`,
				`Caspar ${cas ? cas.count : '–'}`,
				`kiosk ${kio ? kio.length : '–'}`,
			]
			const details = [
				...(srv?.errors || []).map((e) => `server: ${e}`),
				...(cas?.errors || []).map((e) => `caspar: ${e}`),
				...(kio || []).map((e) => `kiosk: ${e}`),
			].slice(0, 12)
			const status = kio?.length || srv?.count ? 'fail' : cas?.count ? 'warn' : 'pass'
			return { status, summary: `error lines since start — ${parts.join(', ')}`, details }
		},
	},
	{
		id: 'app.kiosk',
		name: 'kiosk running and connected',
		async run({ kioskPid }) {
			if (!unit('nodm')) return { status: 'skip', summary: 'no kiosk on this machine (no nodm)' }
			if (!kioskPid) return { status: 'fail', summary: 'no godot process' }
			const ss = sh('ss', ['-tnpH'])
				.out.split('\n')
				.filter((l) => l.includes(`pid=${kioskPid},`) && /:4200\s/.test(l))
			if (!ss.length) return { status: 'warn', summary: `godot ${kioskPid} runs but has no connection to a :4200 server` }
			const peer = ss[0].split(/\s+/)[4]
			return {
				status: 'pass',
				summary: `godot ${kioskPid} → ${peer}${peer.startsWith('127.0.0.1') ? '' : ' (following another server)'}`,
			}
		},
	},
	{
		id: 'app.client-compile',
		name: 'every client script compiles (headless, isolated)',
		heavy: true,
		async run() {
			const bin = godotBin()
			if (!bin) return { status: 'skip', summary: 'Godot not installed' }
			const data = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-sweep-godot-'))
			try {
				// own XDG_DATA_HOME = own ui.cfg; port 9 = no server: compiles + boots every UI script, talks to nobody
				const env = { ...process.env, XDG_DATA_HOME: data, DISPLAY: '' }
				delete env.HIGHASCG_SERVER
				const r = sh(
					bin,
					[
						'--headless',
						'--path',
						path.join(REPO, 'godot/client'),
						'--',
						'--quit-after=4',
						'--tab=1',
						'--server=http://127.0.0.1:9',
					],
					{ env, timeoutMs: 60000 }
				)
				const errs = `${r.out}\n${r.err}`.split('\n').filter((l) => /SCRIPT ERROR|Parse Error|Compile Error/.test(l))
				if (r.timedOut)
					return { status: 'fail', summary: 'client boot did not quit within 60 s (a parse error in the main script?)' }
				if (errs.length)
					return { status: 'fail', summary: `${errs.length} script error(s)`, details: [...new Set(errs)].slice(0, 8) }
				return { status: 'pass', summary: 'boot OK, no script errors' }
			} finally {
				fs.rmSync(data, { recursive: true, force: true })
			}
		},
	},
	{
		id: 'app.config-files',
		name: 'config files parse',
		async run() {
			const r = parseAll(path.join(REPO, 'config'), (f) => f.endsWith('.json') && !f.includes('.sync-conflict-'))
			if (!r) return { status: 'skip', summary: 'no config/' }
			return r.bad.length
				? { status: 'fail', summary: `${r.bad.length}/${r.n} do not parse`, details: r.bad }
				: { status: 'pass', summary: `${r.n} JSON files` }
		},
	},
	{
		id: 'app.projects-parse',
		name: 'project files parse',
		async run({ projectsDir }) {
			const r = parseAll(projectsDir, (f) => f.endsWith('.json') && !f.includes('.sync-conflict-'))
			if (!r) return { status: 'skip', summary: `no ${projectsDir}` }
			return r.bad.length
				? { status: 'fail', summary: `${r.bad.length}/${r.n} do not parse`, details: r.bad }
				: { status: 'pass', summary: `${r.n} projects` }
		},
	},
]

module.exports.CASPAR_NOISE = CASPAR_NOISE
module.exports.LIVE_ROUTES = LIVE_ROUTES
