'use strict'

/**
 * WO-1094 — the person-detection runtime (src/tracking/runtime-*.js; the work is tools/tracking-detect/install.sh):
 *   GET  /api/tracking/runtime[?net=1]          → { verdict, reason, apt?, core, features[], paths, free_mb, internet?, job, summary }
 *        ?only=job → { job } (cheap: the client's poll while a job runs)
 *   POST /api/tracking/runtime/install {features?: ['person','pose','seg','face'], repair?}   (202 / 409 while a job runs)
 *   POST /api/tracking/runtime/repair           → recreate the venv (--clear) for this Python; models stay
 *   POST /api/tracking/runtime/remove {keep_models?}
 *   POST /api/tracking/runtime/export {dest}    → <dest>/highascg-detection-runtime/ (wheels + models + manifest)
 *   POST /api/tracking/runtime/import {from, features?}   → install from such a folder, offline
 *   POST /api/tracking/runtime/resume           → the interrupted / cancelled / failed job's command again
 *   POST /api/tracking/runtime/cancel
 *   GET  /api/tracking/runtime/folders          → { folders: [{ path, label, free_mb }], bundles: [{ path, python, features,
 *        created, matches }] } — mounted sticks / disks to export to or install from
 * Every route takes `prefix` (query or body): a scratch prefix for tests (runtime-paths.checkPrefix); only with one may a
 * body carry `test: { free_mb, proxy }` (fake free space / a dead proxy for the job). Core routes: they answer with the
 * tracking module off too (About reads the same status).
 * WO-1106 B1: install and import put code on the box (pip wheels, a bundle from a folder) — they answer only with the
 * password (auth enforced) or from the box itself (module-host/code-change-gate.js), 403 otherwise. WO-1106 B1
 * follow-up: repair (re-downloads and installs the wheels) and resume (re-runs the last job — an install or an import
 * too) take the same gate.
 */

const fs = require('fs')
const path = require('path')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')
const { runtimePaths, checkPrefix, loadFeatures, inside, REPO, BUNDLE_NAME } = require('../tracking/runtime-paths')
const { createProbe, freeMb } = require('../tracking/runtime-probe')
const { createJobs } = require('../tracking/runtime-job')
const { summaryLine } = require('../tracking/runtime-status')
const { mayChangeInstalledCode } = require('../module-host/code-change-gate')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })
const probe = createProbe()
let last = null // the default prefix's last status (About's line)
const jobs = createJobs({ onEnd: () => probe.forget() })

function prefixOf(v) {
	if (v === undefined || v === null || v === '') return { prefix: runtimePaths().prefix, scratch: false }
	const err = checkPrefix(String(v))
	return err ? { error: err } : { prefix: path.resolve(String(v)), scratch: true }
}

async function status(prefix, withNet) {
	const st = await probe.status(prefix.scratch ? prefix.prefix : undefined, { withNet })
	const job = jobs.current(prefix.prefix)
	const out = { ...st, job: job ? job.snapshot() : null, summary: summaryLine(st), at: Date.now() }
	if (!prefix.scratch) last = out
	return out
}

/** About's line: the last status, refreshed in the background (never blocks GET /api/about). */
function aboutLine() {
	if (!last || Date.now() - (last.at || 0) > 30000) {
		status(prefixOf(), false).catch(() => {})
	}
	return last ? last.summary : summaryLine(null)
}

const FEATURES = () => Object.keys(loadFeatures().features)
function featureArg(list) {
	const all = FEATURES()
	const want = Array.isArray(list) && list.length ? list.map(String) : Object.entries(loadFeatures().features).filter(([, f]) => f.default).map(([k]) => k)
	const bad = want.filter((f) => !all.includes(f))
	return bad.length ? { error: `unknown feature(s): ${bad.join(', ')}` } : { value: want.join(',') }
}

/** Folders a bundle must never be written into: the repo (Syncthing) and every exFAT / bridge sync pair, both sides. */
function syncedRoots() {
	const roots = [REPO]
	try {
		const { loadExfatSyncMapFromDisk, resolvePairExfatRoot } = require('../system/exfat-sync-map')
		const { map } = loadExfatSyncMapFromDisk()
		for (const p of map.pairs || []) {
			roots.push(path.resolve(p.project))
			roots.push(path.join(resolvePairExfatRoot(map, p), p.exfat))
		}
		for (const v of Object.values(map.volumes || {})) {
			roots.push(path.join(v.mount, 'drop-update'), path.join(v.mount, 'sim')) // the stick's seeding trees
		}
	} catch {
		/* no map: the repo alone */
	}
	return roots
}

function checkDest(dest) {
	if (typeof dest !== 'string' || !path.isAbsolute(dest) || dest.split('/').includes('..')) return 'pick a folder (absolute path)'
	const d = path.resolve(dest)
	const hit = syncedRoots().find((r) => inside(d, r))
	if (hit) return `not inside ${hit}: that folder is synced to other machines — pick a stick or another folder`
	return ''
}

function testEnv(body, prefix) {
	const t = body?.test
	if (!t || typeof t !== 'object') return {}
	if (!prefix.scratch) return { error: 'test hooks need a scratch prefix' }
	const env = {}
	if (Number.isFinite(Number(t.free_mb)) && t.free_mb !== null) env.HIGHASCG_TRACKING_FREE_MB = String(Math.max(0, Math.round(Number(t.free_mb))))
	if (typeof t.proxy === 'string' && t.proxy) env.https_proxy = env.http_proxy = env.HTTPS_PROXY = env.HTTP_PROXY = t.proxy
	return env
}

function begin(kind, args, prefix, body) {
	const env = testEnv(body, prefix)
	if (env.error) return reply(400, { error: env.error })
	if (prefix.scratch) Object.assign(env, { HIGHASCG_TRACKING_VENV: runtimePaths(prefix.prefix).venv, HIGHASCG_TRACKING_MODELS: runtimePaths(prefix.prefix).models })
	const r = jobs.start(kind, args, prefix.prefix, env)
	return reply(r.status, r.body)
}

function mounts() {
	const out = []
	let text = ''
	try {
		text = fs.readFileSync('/proc/mounts', 'utf8')
	} catch {
		/* no /proc */
	}
	const home = process.env.HOME || require('os').homedir()
	for (const line of text.split('\n')) {
		const [dev, dir, type] = line.split(' ')
		const p = String(dir || '').replace(/\\040/g, ' ')
		if (!/^\/dev\//.test(dev || '')) continue
		if (/^\/(media|run\/media|mnt)\//.test(p) || p === path.join(home, 'exfat') || p === path.join(home, 'bridge')) out.push({ path: p, label: `${path.basename(p)} (${type})` })
	}
	return out
}

async function folders(prefix) {
	const list = [...mounts(), { path: path.join(prefix.prefix, 'bundles'), label: 'this machine (to copy later)' }]
	const outFolders = []
	const bundles = []
	let sysPy = ''
	try {
		sysPy = (await probe.status(prefix.scratch ? prefix.prefix : undefined)).core.system_python || ''
	} catch {
		/* unknown */
	}
	for (const f of list) {
		outFolders.push({ ...f, free_mb: await freeMb(f.path), blocked: checkDest(f.path) || '' })
		for (const cand of [path.join(f.path, BUNDLE_NAME), f.path]) {
			try {
				const m = JSON.parse(fs.readFileSync(path.join(cand, 'manifest.json'), 'utf8'))
				if (m.kind !== BUNDLE_NAME) continue
				bundles.push({ path: cand, python: m.python, features: m.features || [], created: m.created, matches: !!sysPy && sysPy.startsWith(m.python + '.') })
				break
			} catch {
				/* no bundle here */
			}
		}
	}
	return { folders: outFolders, bundles, system_python: sysPy }
}

function register(routes) {
	const opt = { requireCaspar: false }
	const pre = (query, body) => prefixOf(body?.prefix ?? query?.prefix)
	const guard = (fn, changesCode = false) => async ({ query, body, req, ctx }) => {
		if (changesCode) {
			const gate = mayChangeInstalledCode(req, ctx)
			if (!gate.ok) return reply(gate.status, { error: gate.error, code: gate.code })
		}
		const b = parseBody(body) || {}
		const p = pre(query, b)
		if (p.error) return reply(400, { error: p.error })
		return fn(p, b, query || {})
	}
	routes.get('/api/tracking/runtime', guard(async (p, b, q) => {
		if (q.only === 'job') return reply(200, { job: jobs.current(p.prefix)?.snapshot() ?? null }) // the 1 s poll while a job runs
		return reply(200, await status(p, q.net === '1' || q.net === 'true'))
	}), opt)
	routes.get('/api/tracking/runtime/folders', guard(async (p) => reply(200, await folders(p))), opt)
	routes.post('/api/tracking/runtime/install', guard((p, b) => {
		const f = featureArg(b.features)
		if (f.error) return reply(400, { error: f.error })
		return begin(b.repair ? 'repair' : 'install', ['--features', f.value, ...(b.repair ? ['--repair'] : [])], p, b)
	}, true), opt)
	routes.post('/api/tracking/runtime/repair', guard((p, b) => begin('repair', ['--features', '', '--repair'], p, b), true), opt)
	routes.post('/api/tracking/runtime/remove', guard((p, b) => begin('remove', ['--remove', ...(b.keep_models ? ['--keep-models'] : [])], p, b)), opt)
	routes.post('/api/tracking/runtime/export', guard((p, b) => {
		const why = checkDest(b.dest)
		if (why) return reply(400, { error: why })
		return begin('export', ['--export-to', path.resolve(b.dest)], p, b)
	}), opt)
	routes.post('/api/tracking/runtime/import', guard((p, b) => {
		if (typeof b.from !== 'string' || !path.isAbsolute(b.from)) return reply(400, { error: 'from: the bundle folder (absolute path)' })
		const f = featureArg(b.features)
		if (f.error) return reply(400, { error: f.error })
		return begin('import', ['--from', path.resolve(b.from), '--features', f.value], p, b)
	}, true), opt)
	routes.post('/api/tracking/runtime/resume', guard((p, b) => {
		const j = jobs.current(p.prefix)
		if (!j || !j.snapshot().resumable) return reply(409, { error: 'nothing to resume' })
		return begin(j.kind, j.args, p, b)
	}, true), opt)
	routes.post('/api/tracking/runtime/cancel', guard(() => {
		const r = jobs.cancel()
		return reply(r.status, r.body)
	}), opt)
}

module.exports = { register, aboutLine, checkDest }
