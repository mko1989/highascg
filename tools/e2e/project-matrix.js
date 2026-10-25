#!/usr/bin/env node
'use strict'

/**
 * WO-753 — every screen-destination setup a project carries, end to end, without touching a live box:
 *   1. a throwaway sandbox server (WO-719) loads the project WITH its hardware (what "use the project's hardware"
 *      does: POST /api/project/load { applyHardware: true });
 *   2. the server's channel map must match the destinations (one PGM per pgm_prv / pgm_only, one PRV per pgm_prv,
 *      one channel per multiview; no channel index twice or past the end), and the generated casparcg.config must
 *      give every PGM its destination's size and define every custom video mode it uses;
 *   3. with --caspar=<binary>, that real Caspar loads the generated config headless (screen / DeckLink / NDI / stream
 *      consumers removed, shm renamed, OSC clients dropped, its own ports) and must report the same channels.
 *
 *   node tools/e2e/project-matrix.js                              # this box's projects/, one per distinct setup
 *   node tools/e2e/project-matrix.js --all --projects=/path/to/projects --caspar=bin/casparcg --json
 *
 * Output: a line per project and, with --out=<dir>, results.json. Exit code = failing projects.
 */

const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const xml2js = require('xml2js')
const { startSandbox } = require('./sandbox-server')
const { STANDARD_VIDEO_MODES } = require('../../src/config/config-modes')

const REPO = path.resolve(__dirname, '../..')
const PGM_MODES = new Set(['pgm_prv', 'pgm_only'])

const destinationsOf = (project) => project?.hardwareConfig?.screenDestinations?.destinations || []

/** Same setup = same destination modes and sizes (what decides Caspar's channels). */
function setupKey(project) {
	return destinationsOf(project)
		.map((d) => `${d.mode}:${d.videoMode || ''}:${d.width || ''}x${d.height || ''}`)
		.sort()
		.join(' + ') || '(none)'
}

function projectFiles(dir) {
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.json') && !f.includes('.sync-conflict-') && !f.startsWith('_'))
		.sort()
}

/** One project per distinct setup (the first by name), or all of them. */
function pickProjects(dir, all) {
	const picked = new Map()
	for (const f of projectFiles(dir)) {
		let project
		try {
			project = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
		} catch {
			project = null
		}
		const key = project ? setupKey(project) : `unreadable:${f}`
		if (all || !picked.has(key)) picked.set(all ? f : key, { slug: f.slice(0, -5), key, project })
	}
	return [...picked.values()]
}

async function parseConfig(xml) {
	const doc = await xml2js.parseStringPromise(xml, { explicitArray: true })
	const cfg = doc.configuration || {}
	const modes = {}
	for (const m of cfg['video-modes']?.[0]?.['video-mode'] || [])
		modes[m.id[0]] = { width: +m.width[0], height: +m.height[0] }
	const channels = (cfg.channels?.[0]?.channel || []).map((c, i) => ({
		index: i + 1,
		mode: String(c['video-mode']?.[0] || ''),
		consumers: Object.keys(c.consumers?.[0] || {}).filter((k) => k !== '$'),
	}))
	return { channels, modes }
}

function modeSize(mode, modes) {
	if (modes[mode]) return modes[mode]
	const std = STANDARD_VIDEO_MODES[mode]
	return std ? { width: std.width, height: std.height } : null
}

/** The checks on what the server says (channel map) and writes (casparcg.config) for these destinations. */
function checkSetup(dests, map, cfg) {
	const errors = []
	const pgm = dests.filter((d) => PGM_MODES.has(d.mode))
	const prvCount = dests.filter((d) => d.mode === 'pgm_prv').length
	const mvCount = dests.filter((d) => d.mode === 'multiview').length
	const programs = map.programChannels || []
	const previews = (map.previewChannels || []).filter((c) => c != null)
	const multiviews = map.multiviewChannels || []
	if (programs.length !== pgm.length) errors.push(`${programs.length} PGM channels for ${pgm.length} PGM destinations`)
	if (previews.length !== prvCount) errors.push(`${previews.length} PRV channels for ${prvCount} pgm_prv destinations`)
	if (multiviews.length !== mvCount) errors.push(`${multiviews.length} multiview channels for ${mvCount} multiview destinations`)
	// the stream is left out: it attaches to an existing channel (a PGM, the channel_<N> picked) or has its own (WO-378)
	const used = [...programs, ...previews, ...multiviews, map.inputsCh, map.audioPreviewCh].filter((c) => c != null)
	const dup = used.filter((c, i) => used.indexOf(c) !== i)
	if (dup.length) errors.push(`channel ${dup.join(', ')} used twice`)
	const past = [...used, map.streamingCh].filter((c) => c != null && (c < 1 || c > cfg.channels.length))
	if (past.length) errors.push(`channel ${past.join(', ')} is not in casparcg.config (${cfg.channels.length} channels)`)
	for (const ch of cfg.channels)
		if (!modeSize(ch.mode, cfg.modes)) errors.push(`channel ${ch.index}: video mode ${ch.mode} is neither standard nor defined`)
	const sizeOf = (c) => {
		const s = modeSize(cfg.channels[c - 1]?.mode, cfg.modes)
		return s ? `${s.width}x${s.height}` : '?'
	}
	const want = pgm.filter((d) => d.width && d.height).map((d) => `${d.width}x${d.height}`).sort()
	const got = programs.map(sizeOf).sort()
	if (want.length === pgm.length && want.join() !== got.join()) errors.push(`PGM sizes ${got.join(', ')} ≠ destinations ${want.join(', ')}`)
	return errors
}

const freePort = () =>
	new Promise((resolve, reject) => {
		const s = net.createServer().once('error', reject)
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address()
			s.close(() => resolve(port))
		})
	})

/** The generated config made safe to run beside a live Caspar: no outputs, own ports, own shm names, own paths. */
function headless(xml, { dir, amcp, osc, debug, tag }) {
	return xml
		.replace(/<consumers>[\s\S]*?<\/consumers>/g, (block) => {
			const shm = [...block.matchAll(/<shm>[\s\S]*?<\/shm>/g)].map((m, i) => m[0].replace(/<name>[^<]*<\/name>/, `<name>${tag}-${i}</name>`))
			return `<consumers>${shm.join('')}</consumers>`
		})
		.replace(/<paths>[\s\S]*?<\/paths>/, `<paths><media-path>${dir}/media/</media-path><log-path disable="false">${dir}/log/</log-path><data-path>${dir}/data/</data-path><template-path>${dir}/template/</template-path></paths>`)
		.replace(/<controllers>[\s\S]*?<\/controllers>/, `<controllers><tcp><port>${amcp}</port><protocol>AMCP</protocol></tcp></controllers>`)
		.replace(/<osc>[\s\S]*?<\/osc>/, `<osc><default-port>${osc}</default-port><disable-send-to-amcp-clients>true</disable-send-to-amcp-clients></osc>`)
		.replace(/<remote-debugging-port>\d+<\/remote-debugging-port>/, `<remote-debugging-port>${debug}</remote-debugging-port>`)
		.replace(/<ndi>[\s\S]*?<\/ndi>/, '<ndi><auto-load>false</auto-load></ndi>')
		.replace(/<system-audio>[\s\S]*?<\/system-audio>/, '')
}

function amcpInfo(port, timeoutMs) {
	return new Promise((resolve) => {
		const until = Date.now() + timeoutMs
		const attempt = () => {
			const s = net.connect(port, '127.0.0.1')
			let buf = ''
			s.on('connect', () => s.write('INFO\r\n'))
			s.on('data', (d) => {
				buf += d
				if (/^200 [^\r\n]*\r\n[\s\S]*\r\n\r\n/.test(buf) || /^[45]\d\d /.test(buf)) {
					s.destroy()
					resolve(buf)
				}
			})
			s.on('error', () => (Date.now() < until ? setTimeout(attempt, 300) : resolve('')))
		}
		attempt()
	})
}

/** Runs the real Caspar on the generated config; resolves its INFO channel list and any error lines it logged. */
async function runCaspar(bin, xml, slug) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo753-caspar-'))
	for (const d of ['media', 'log', 'data', 'template']) fs.mkdirSync(path.join(dir, d))
	const amcp = await freePort()
	const cfgPath = path.join(dir, 'casparcg.config')
	fs.writeFileSync(cfgPath, headless(xml, { dir, amcp, osc: await freePort(), debug: await freePort(), tag: `wo753m-${process.pid}` }))
	const lib = path.join(path.dirname(path.dirname(path.resolve(bin))), 'lib')
	const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':0', XAUTHORITY: process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority'), LD_LIBRARY_PATH: lib }
	const child = spawn(path.resolve(bin), [cfgPath], { cwd: dir, env, stdio: 'ignore' })
	let exited = null
	child.on('exit', (code, sig) => (exited = sig || code))
	try {
		const info = await amcpInfo(amcp, 30000)
		const channels = [...info.replace(/^.*\r?\n/, '').matchAll(/^(\d+) (\S+) \S+\r?$/gm)].map((m) => ({ index: +m[1], mode: m[2] }))
		const log = fs.readdirSync(path.join(dir, 'log')).map((f) => fs.readFileSync(path.join(dir, 'log', f), 'utf8')).join('\n')
		const errors = log.split('\n').filter((l) => /\[(error|fatal)\]/.test(l)).map((l) => l.replace(/^\[[^\]]*\]\s*/, '').slice(0, 160))
		return { answered: Boolean(info), channels, errors, exited, slug }
	} finally {
		if (exited === null) {
			child.kill('SIGTERM')
			await new Promise((r) => {
				const t = setTimeout(() => (child.kill('SIGKILL'), r()), 10000)
				child.once('exit', () => (clearTimeout(t), r()))
			})
		}
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

async function runMatrix({ projectsDir = path.join(REPO, 'projects'), all = false, caspar = '', log = () => {} } = {}) {
	const picks = pickProjects(projectsDir, all)
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo753-matrix-'))
	fs.mkdirSync(path.join(root, 'projects'))
	for (const p of picks) fs.copyFileSync(path.join(projectsDir, `${p.slug}.json`), path.join(root, 'projects', `${p.slug}.json`))
	const sb = await startSandbox({ root })
	const call = async (method, p, body) => {
		const r = await fetch(sb.url + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
		const text = await r.text()
		let data = null
		try {
			data = JSON.parse(text)
		} catch {
			/* XML or plain text */
		}
		return { status: r.status, data, text }
	}
	const logFile = path.join(root, 'server.log')
	const results = []
	try {
		for (const p of picks) {
			const r = { slug: p.slug, setup: p.key, errors: [] }
			const before = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0
			const load = await call('POST', '/api/project/load', { slug: p.slug, applyHardware: true })
			if (load.status !== 200) r.errors.push(`load → ${load.status} ${String(load.data?.error || '').slice(0, 100)}`)
			const gen = await call('GET', '/api/caspar-config/generate')
			const map = (await call('GET', '/api/state')).data?.channelMap || {}
			const serverErrors = (fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(before) : '')
				.split('\n')
				.filter((l) => /\[error\]|TypeError|ReferenceError|Unhandled/.test(l))
			if (serverErrors.length) r.errors.push(`server: ${serverErrors[0].replace(/^\[[^\]]*\]\s*/, '').slice(0, 150)}`)
			if (gen.status !== 200) r.errors.push(`generate → ${gen.status}`)
			else {
				const cfg = await parseConfig(gen.text)
				r.channels = cfg.channels.map((c) => `${c.index}:${c.mode}`)
				r.errors.push(...checkSetup(destinationsOf(p.project), map, cfg))
				if (caspar) {
					const run = await runCaspar(caspar, gen.text, p.slug)
					r.caspar = { channels: run.channels.map((c) => `${c.index}:${c.mode}`), errors: run.errors.slice(0, 3) }
					if (!run.answered) r.errors.push(`Caspar did not answer AMCP (exit ${run.exited})`)
					else if (r.caspar.channels.join() !== r.channels.join()) r.errors.push(`Caspar runs ${r.caspar.channels.join(' ')} ≠ config ${r.channels.join(' ')}`)
					if (run.errors.length) r.errors.push(`Caspar logged: ${run.errors[0]}`)
				}
			}
			r.status = r.errors.length ? 'fail' : 'pass'
			log(r)
			results.push(r)
		}
	} finally {
		await sb.stop()
		fs.rmSync(root, { recursive: true, force: true })
	}
	return results
}

module.exports = { runMatrix, checkSetup, parseConfig, headless, setupKey, pickProjects }

if (require.main === module) {
	const arg = (k) => {
		const hit = process.argv.find((a) => a === `--${k}` || a.startsWith(`--${k}=`))
		return hit ? (hit.includes('=') ? hit.split('=').slice(1).join('=') : '1') : ''
	}
	const json = Boolean(arg('json'))
	runMatrix({
		projectsDir: arg('projects') || undefined,
		all: Boolean(arg('all')),
		caspar: arg('caspar'),
		log: (r) => json || console.log(`${r.status === 'pass' ? 'PASS' : 'FAIL'}  ${r.slug.padEnd(16)} ${r.setup.slice(0, 90)}  [${(r.caspar?.channels || r.channels || []).length} ch]${r.errors.length ? '\n        ' + r.errors.join('\n        ') : ''}`),
	}).then((results) => {
		if (arg('out')) {
			fs.mkdirSync(arg('out'), { recursive: true })
			fs.writeFileSync(path.join(arg('out'), 'results.json'), JSON.stringify(results, null, 1))
		}
		if (json) console.log(JSON.stringify(results, null, 1))
		const failed = results.filter((r) => r.status !== 'pass').length
		if (!json) console.log(`\n${results.length - failed} pass, ${failed} fail`)
		process.exit(failed)
	}, (e) => {
		console.error(e)
		process.exit(99)
	})
}
