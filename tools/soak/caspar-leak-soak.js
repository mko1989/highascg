#!/usr/bin/env node
'use strict'
/**
 * WO-1133 — 48 h look-cycling soak against the Caspar memory leak (WO-1132 history: 50 GB OOM after two days,
 * bursts of 15–30 GB in 2–4 h, quiet runs flat at 2–6 GB).
 *
 * Drives the CURRENT project's looks through the normal take path (POST /api/scene/take-look, exactly what the
 * Godot client sends: stage on PRV, then take to PGM) in repeating cycles of three phase kinds, so the report can
 * tell a per-frame leak (grows while nothing happens) from a per-take leak (grows with takes) from a per-look leak
 * (grows only while one look plays):
 *
 *   hold      — the look that was live at start, untouched for --hold-min           (baseline growth per hour)
 *   rapid     — every look in shuffled order, PRV stage + PGM take every --dwell-s  (cost per take)
 *   per-look  — each look staged + taken, then held for --look-min                  (growth per look while playing)
 *
 * Samples Caspar RSS/anon/shmem/threads/fds/maps, CEF children, GPU memory (per process) every --sample-s into
 * samples.csv; takes and phase boundaries into events.jsonl; /proc/<caspar>/smaps per-mapping Rss every
 * --smaps-min into smaps.jsonl. Analyse with tools/soak/soak-report.js <dir>. On exit (deadline, SIGTERM, SIGINT)
 * it takes back the look that was live when it started.
 *
 *   node tools/soak/caspar-leak-soak.js [--hours 48] [--out DIR] [--hold-min 20] [--rapid-min 20] [--dwell-s 20]
 *        [--look-min 5] [--sample-s 15] [--smaps-min 10] [--main 0] [--port 4200] [--looks 'Name,Name'] [--dry-run]
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const { sample, SAMPLE_COLUMNS, smapsByMapping, findCaspar } = require('./soak-sample')

function parseArgs(argv) {
	const o = {
		hours: 48,
		out: null,
		holdMin: 20,
		rapidMin: 20,
		dwellS: 20,
		lookMin: 5,
		sampleS: 15,
		smapsMin: 10,
		main: 0,
		port: 4200,
		dryRun: false,
		looks: null,
	}
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i]
		const v = () => argv[++i]
		if (a === '--hours') o.hours = Number(v())
		else if (a === '--out') o.out = v()
		else if (a === '--hold-min') o.holdMin = Number(v())
		else if (a === '--rapid-min') o.rapidMin = Number(v())
		else if (a === '--dwell-s') o.dwellS = Number(v())
		else if (a === '--look-min') o.lookMin = Number(v())
		else if (a === '--sample-s') o.sampleS = Number(v())
		else if (a === '--smaps-min') o.smapsMin = Number(v())
		else if (a === '--main') o.main = Number(v())
		else if (a === '--port') o.port = Number(v())
		else if (a === '--looks') o.looks = v().split(',').map((x) => x.trim()).filter(Boolean)
		else if (a === '--dry-run') o.dryRun = true
		else throw new Error(`unknown arg ${a}`)
	}
	if (!o.out) {
		const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
		o.out = path.join(os.homedir(), '.highascg', 'soak', stamp)
	}
	return o
}

const opt = parseArgs(process.argv)
fs.mkdirSync(opt.out, { recursive: true })
const csvPath = path.join(opt.out, 'samples.csv')
const evPath = path.join(opt.out, 'events.jsonl')
const smapsPath = path.join(opt.out, 'smaps.jsonl')
const statusPath = path.join(opt.out, 'status.json')
if (!fs.existsSync(csvPath)) fs.writeFileSync(csvPath, ['t', 'phase', 'look', ...SAMPLE_COLUMNS].join(',') + '\n')

const state = { phase: 'init', lookId: null, lookName: null, cycle: 0, takes: 0, takeFails: 0, stopping: false }
const t0 = Date.now()
const deadline = t0 + opt.hours * 3600_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function event(type, data = {}) {
	const line = JSON.stringify({ t: new Date().toISOString(), type, cycle: state.cycle, phase: state.phase, ...data })
	fs.appendFileSync(evPath, line + '\n')
	if (type !== 'take') console.log(line)
}

function api(method, p, body) {
	return new Promise((resolve) => {
		const started = Date.now()
		const r = http.request(
			{ host: '127.0.0.1', port: opt.port, path: p, method, timeout: 130_000, headers: { 'Content-Type': 'application/json' } },
			(res) => {
				let d = ''
				res.on('data', (c) => (d += c))
				res.on('end', () => {
					let json = null
					try {
						json = JSON.parse(d)
					} catch {
						/* non-JSON */
					}
					resolve({ status: res.statusCode, json, ms: Date.now() - started, raw: json ? null : d.slice(0, 200) })
				})
			}
		)
		r.on('error', (e) => resolve({ status: 0, json: null, ms: Date.now() - started, raw: String(e.message) }))
		r.on('timeout', () => r.destroy(new Error('timeout')))
		if (body != null) r.write(JSON.stringify(body))
		r.end()
	})
}

async function loadLooks() {
	const r = await api('GET', '/api/project')
	const sc = r.json?.scenes
	if (!sc || !Array.isArray(sc.scenes)) return null
	const looks = sc.scenes
		.filter((s) => s && s.id && (s.mainScope == null || String(s.mainScope) === String(opt.main)))
		.map((s) => ({ id: String(s.id), name: String(s.name || s.id) }))
	const live = sc.liveSceneIdByMain?.[opt.main] ?? sc.liveSceneId ?? null
	const picked = looks.filter((l) => !opt.looks || opt.looks.includes(l.name) || opt.looks.includes(l.id))
	return { looks: picked, allLooks: looks, liveId: live, project: r.json?.name }
}

/** One take, the way the Godot client does it. target: 'preview' | 'program'. */
async function take(look, target) {
	if (opt.dryRun) return true
	const before = lastSample?.rssKB ?? null
	const r = await api('POST', '/api/scene/take-look', { sceneId: look.id, mainIdx: opt.main, target })
	const ok = r.status === 200 && r.json?.ok !== false
	state.takes++
	if (!ok) state.takeFails++
	if (target === 'program') {
		state.lookId = look.id
		state.lookName = look.name
	}
	event('take', {
		look: look.name,
		lookId: look.id,
		target,
		ok,
		status: r.status,
		ms: r.ms,
		rssKBBefore: before,
		error: ok ? undefined : r.json?.error || r.raw,
	})
	if (!ok) console.log(`take ${target} "${look.name}" failed: ${r.status} ${r.json?.error || r.raw || ''}`)
	if (ok && target === 'program' && r.json?.overlay) overlayOnAir = look
	return ok
}

/**
 * Overlay looks (template CG on the 700+ hosts, e.g. a browser-URL look) are held on PGM "until stop", ON TOP of
 * whatever look is taken next — a regular take never removes them. The deck's Stop is POST /api/scene/overlay/stop;
 * without it an opaque overlay blacks out PGM for the rest of the run (23.11, Look 10).
 */
let overlayOnAir = null
async function stopOverlay() {
	if (!overlayOnAir || opt.dryRun) return
	const look = overlayOnAir
	overlayOnAir = null
	const r = await api('POST', '/api/scene/overlay/stop', { mainIdx: opt.main, sceneId: look.id })
	event('overlay-stop', { look: look.name, ok: r.status === 200, status: r.status, ms: r.ms })
}

async function stageAndTake(look) {
	await stopOverlay()
	await take(look, 'preview')
	await waitUntil(Date.now() + 3000)
	await take(look, 'program')
}

let lastSample = null
let lastSmapsAt = 0
let lastPid = null
function doSample() {
	const s = sample()
	lastSample = s
	if (s.casparPid !== lastPid) {
		if (lastPid != null) event('caspar-pid-change', { from: lastPid, to: s.casparPid })
		lastPid = s.casparPid
		lastSmapsAt = 0
	}
	const row = [new Date().toISOString(), state.phase, JSON.stringify(state.lookName || ''), ...SAMPLE_COLUMNS.map((c) => s[c] ?? '')]
	fs.appendFileSync(csvPath, row.join(',') + '\n')
	if (s.casparPid && Date.now() - lastSmapsAt >= opt.smapsMin * 60_000) {
		lastSmapsAt = Date.now()
		const agg = smapsByMapping(s.casparPid)
		if (agg) fs.appendFileSync(smapsPath, JSON.stringify({ t: new Date().toISOString(), pid: s.casparPid, phase: state.phase, look: state.lookName, agg }) + '\n')
	}
	fs.writeFileSync(
		statusPath,
		JSON.stringify(
			{
				...state,
				startedAt: new Date(t0).toISOString(),
				deadline: new Date(deadline).toISOString(),
				elapsedH: +((Date.now() - t0) / 3600_000).toFixed(2),
				last: s,
			},
			null,
			1
		)
	)
}

const sampler = setInterval(() => {
	try {
		doSample()
	} catch (e) {
		console.log('sample error', e.message)
	}
}, opt.sampleS * 1000)

/** Sleep until `until`, but wake early when stopping or the overall deadline passes. */
async function waitUntil(until) {
	while (!state.stopping && Date.now() < Math.min(until, deadline)) await sleep(Math.min(1000, until - Date.now()))
}
const done = () => state.stopping || Date.now() >= deadline

function shuffle(a) {
	const b = a.slice()
	for (let i = b.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[b[i], b[j]] = [b[j], b[i]]
	}
	return b
}

async function waitForServer() {
	for (;;) {
		const info = await loadLooks()
		if (info && info.looks.length) return info
		if (done()) return null
		event('server-unavailable', {})
		await waitUntil(Date.now() + 30_000)
	}
}

let original = null
async function main() {
	const info = await waitForServer()
	if (!info) return
	original = info.allLooks.find((l) => l.id === info.liveId) || null
	event('start', { opt, project: info.project, looks: info.looks, originalLive: original, caspar: findCaspar().main })
	doSample()
	while (!done()) {
		state.cycle++
		const cur = await waitForServer()
		if (!cur) break
		const looks = cur.looks
		const anchor = looks.find((l) => l.id === original?.id) || looks[0]

		state.phase = 'hold'
		event('phase', { look: anchor.name })
		await stageAndTake(anchor)
		await waitUntil(Date.now() + opt.holdMin * 60_000)
		if (done()) break

		state.phase = 'rapid'
		event('phase', {})
		const rapidEnd = Date.now() + opt.rapidMin * 60_000
		while (!done() && Date.now() < rapidEnd) {
			for (const l of shuffle(looks)) {
				if (done() || Date.now() >= rapidEnd) break
				await stageAndTake(l)
				await waitUntil(Date.now() + opt.dwellS * 1000)
			}
		}
		if (done()) break

		state.phase = 'per-look'
		for (const l of looks) {
			if (done()) break
			event('phase', { look: l.name })
			await stageAndTake(l)
			await waitUntil(Date.now() + opt.lookMin * 60_000)
		}
	}
}

async function finish(reason) {
	if (finish.ran) return
	finish.ran = true
	state.stopping = true
	state.phase = 'restore'
	await stopOverlay().catch(() => {})
	if (original) await take(original, 'program').catch(() => {})
	doSample()
	clearInterval(sampler)
	event('end', { reason, takes: state.takes, takeFails: state.takeFails, hours: +((Date.now() - t0) / 3600_000).toFixed(2) })
	process.exit(0)
}

process.on('SIGTERM', () => finish('SIGTERM'))
process.on('SIGINT', () => finish('SIGINT'))
console.log(`soak → ${opt.out} (until ${new Date(deadline).toISOString()})`)
main()
	.then(() => finish('deadline'))
	.catch((e) => {
		event('crash', { error: String(e?.stack || e) })
		return finish('crash')
	})
