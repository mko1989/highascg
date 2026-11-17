'use strict'

/**
 * WO-1098 — a venue import (OBJ + MTL + pictures → venue .glb in the project folder) as one background job:
 *   stage   — uploads land in a staging folder per session (os tmp, not the media root: Caspar never sees them);
 *             folder paths are kept (a texture folder next to the .obj, "Hilton/…"), sanitised; .obj .mtl .zip .skp
 *             .jpg .jpeg .png only
 *   start   — one job at a time; the conversion runs in a worker thread (src/stage/venue-import-worker.js) so the
 *             server keeps answering; progress → WS change { path: 'venueImport' }
 *   cancel  — terminates the worker; nothing is written
 *   done    — the .glb goes into the project folder as "<obj stem>.glb" (project-files.js place: never overwrites)
 *             and the report stays on the job. The staging folder is removed when the job ends.
 * WO-1106 B4: staging lives in /tmp (a RAM tmpfs on the box), so it is capped — LIMITS: 2000 files and 4 GB per
 * session, 3 sessions (a 4th evicts the least recently used idle one, so a lost session id never locks the operator
 * out), 8 GB staged in total — and the stage root is wiped on the first session after a start (leftovers of a crash). Under
 * `node --test` it is a private temp dir and never wiped at load.
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const pf = require('./project-files')
const { underTestRunner } = require('../engine/projects-root')

const STAGE_ROOT = underTestRunner()
	? path.join(os.tmpdir(), `highascg-test-venue-import-${process.pid}-${crypto.randomBytes(4).toString('hex')}`)
	: path.join(os.tmpdir(), 'highascg-venue-import')
const GB = 1024 * 1024 * 1024
/** WO-1106 B4 caps (mutable for the smokes only). */
const LIMITS = { files: 2000, sessionBytes: 4 * GB, sessions: 3, totalBytes: 8 * GB }
let wiped = underTestRunner()
/**
 * WO-1106 B4: nothing staged survives a restart. Done on the first session of this process, not at load — a tool or
 * a one-off `node -e` that merely requires this file must not empty the running server's staging folder.
 */
function wipeOnce() {
	if (wiped) return
	wiped = true
	try {
		fs.rmSync(STAGE_ROOT, { recursive: true, force: true })
	} catch {
		/* not ours / busy: the sweep still bounds it */
	}
}
const ACCEPT = new Set(['.obj', '.mtl', '.zip', '.skp', '.jpg', '.jpeg', '.png'])
const SESSION_TTL = 3 * 3600 * 1000
const WORKER = path.join(__dirname, '..', 'stage', 'venue-import-worker.js')

let job = null // { id, state: running|done|error|cancelled, phase, text, done, total, startedAt, endedAt, name?, report?, error? }
let worker = null
const sessions = new Map() // id → { dir, files: Set(rel), at, seq, bytes, sizes: Map(rel → bytes), pending: Set(rel) }
let touchSeq = 0 // LRU order (several touches can share one Date.now())

const snapshot = () => (job ? { ...job } : { state: 'idle' })

/** A safe relative path ("Hilton/tex/a b.jpg") or '' — no "..", no absolute, no dot-files, ≤ 12 levels. */
function cleanRel(rel) {
	const parts = String(rel || '').replace(/\\/g, '/').split('/').map((p) => pf.cleanName(p)).filter(Boolean)
	if (!parts.length || parts.length > 12 || parts.some((p) => p === '..' || p === '.')) return ''
	return parts.join('/')
}

const accepts = (name) => ACCEPT.has(path.extname(String(name || '')).toLowerCase())

function sweep(now = Date.now()) {
	for (const [id, s] of sessions) if (now - s.at > SESSION_TTL && job?.session !== id) dropSession(id)
}

function dropSession(id) {
	const s = sessions.get(id)
	sessions.delete(id)
	if (s) fs.rmSync(s.dir, { recursive: true, force: true })
}

/** The staging session `id` (made when missing / unknown). */
function session(id) {
	wipeOnce()
	sweep()
	const key = /^[a-f0-9]{16}$/.test(String(id || '')) ? String(id) : crypto.randomBytes(8).toString('hex')
	let s = sessions.get(key)
	if (!s) {
		evictFor(LIMITS.sessions - 1)
		s = { id: key, dir: path.join(STAGE_ROOT, key), files: new Set(), at: Date.now(), bytes: 0, sizes: new Map(), pending: new Set() }
		fs.mkdirSync(s.dir, { recursive: true })
		sessions.set(key, s)
	}
	s.at = Date.now()
	s.seq = ++touchSeq
	return s
}

/** WO-1106 B4: drop least recently used idle sessions until at most `keep` remain (the running job's never). */
function evictFor(keep) {
	const idle = [...sessions.values()].filter((x) => x.id !== job?.session && !x.pending?.size).sort((a, b) => (a.seq || 0) - (b.seq || 0))
	while (sessions.size > keep && idle.length) dropSession(idle.shift().id)
}

const stagedBytes = () => [...sessions.values()].reduce((n, x) => n + (x.bytes || 0), 0)

/**
 * Where an uploaded file of session `s` goes → { abs, rel } | { error }. A granted target holds a slot until settle().
 * WO-1106 B2: a name that collides with a folder / file already staged ("x.obj" then "x.obj/y.png") is an error
 * reply, never a throw (it ran inside the busboy listener → uncaught → node exit).
 */
function target(s, rel) {
	const r = cleanRel(rel)
	if (!r) return { error: `bad file name: ${rel || '(none)'}` }
	if (!accepts(r)) return { error: `not part of a venue import: ${r} (OBJ, MTL, ZIP, SKP, JPG, PNG)` }
	s.pending = s.pending || new Set()
	if (!s.files.has(r) && s.files.size + s.pending.size >= LIMITS.files) return { error: `too many files in one venue upload (${LIMITS.files} at most)` }
	// a file and a folder of one name: the earlier file may still be opening, so the disk alone cannot tell (B2)
	if (s.pending.has(r) || [...s.files, ...s.pending].some((f) => r.startsWith(`${f}/`) || f.startsWith(`${r}/`))) {
		return { error: `${r}: a file or folder of that name is already in the upload` }
	}
	const abs = path.join(s.dir, r)
	try {
		fs.mkdirSync(path.dirname(abs), { recursive: true })
		if (fs.existsSync(abs) && !fs.statSync(abs).isFile()) return { error: `${r}: a folder of that name is already in the upload` }
	} catch (e) {
		return { error: `${r}: ${e.code === 'EEXIST' || e.code === 'ENOTDIR' ? 'a file of that name is already in the upload' : e.message}` }
	}
	if (s.sizes?.has(r)) {
		s.bytes -= s.sizes.get(r) // re-uploaded: the old copy is overwritten
		s.sizes.delete(r)
		s.files.delete(r)
	}
	s.pending.add(r)
	return { abs, rel: r }
}

/** WO-1106 B4: count `n` more bytes for session `s` → '' or why the file is refused. */
function charge(s, n) {
	if (s.bytes + n > LIMITS.sessionBytes) return `the upload is over ${Math.round(LIMITS.sessionBytes / GB)} GB`
	if (stagedBytes() + n > LIMITS.totalBytes) return 'not enough room for more venue uploads right now — try again later'
	s.bytes += n
	return ''
}

/** A granted target finished: kept (`bytes` written) or dropped (its bytes no longer count). */
function settle(s, rel, bytes, kept) {
	s.pending?.delete(rel)
	if (kept) {
		s.files.add(rel)
		s.sizes.set(rel, bytes)
	} else s.bytes = Math.max(0, s.bytes - bytes)
}

function update(ctx, patch) {
	job = { ...job, ...patch }
	if (typeof ctx?._wsBroadcast === 'function') ctx._wsBroadcast('change', { path: 'venueImport', value: snapshot() })
}

/**
 * Start converting session `sid` with `opts` (convertVenue options + name?). → { status, body }.
 * deps.makeWorker(workerData) (tests) → a Worker-like EventEmitter with terminate().
 */
function start(ctx, sid, opts = {}, deps = {}) {
	if (job?.state === 'running') return { status: 409, body: { error: 'A venue import is already running.', job: snapshot() } }
	const s = sessions.get(String(sid || ''))
	if (!s || !s.files.size) return { status: 400, body: { error: 'Upload the .obj (with its .mtl and pictures) first.' } }
	const { dir } = pf.folder(ctx)
	if (!dir) return { status: 409, body: { error: 'No project is open.' } }
	const objs = [...s.files].filter((f) => /\.obj$/i.test(f))
	const zips = [...s.files].filter((f) => /\.zip$/i.test(f))
	if (!objs.length && !zips.length) {
		const skp = [...s.files].some((f) => /\.skp$/i.test(f))
		return { status: 400, body: { error: skp ? 'SketchUp files are used for their textures only; export OBJ for the geometry.' : 'No .obj file in the upload.' } }
	}
	const stem = path.basename(objs[0] || zips[0]).replace(/\.[^.]+$/, '')
	const name = pf.cleanName(`${String(opts.name || stem).replace(/\.glb$/i, '')}.glb`) || 'venue.glb'
	const { name: _n, ...conv } = opts
	const id = crypto.randomBytes(6).toString('hex')
	job = { id, session: s.id, state: 'running', phase: 'starting', text: 'Starting…', done: 0, total: 0, startedAt: Date.now(), name }
	const make = deps.makeWorker || ((workerData) => new (require('worker_threads').Worker)(WORKER, { workerData }))
	const w = make({ dir: s.dir, opts: conv })
	worker = w
	const finish = (patch) => {
		if (worker !== w) return
		worker = null
		update(ctx, { ...patch, endedAt: Date.now() })
		dropSession(s.id)
	}
	w.on('message', (m) => {
		if (worker !== w || !m) return
		if (m.type === 'progress') update(ctx, { phase: m.phase, text: m.text || '', done: m.done || 0, total: m.total || 0 })
		else if (m.type === 'error') finish({ state: 'error', error: m.error })
		else if (m.type === 'done') {
			try {
				const saved = pf.saveBuffer(ctx, name, Buffer.from(m.glb))
				if (!saved) return finish({ state: 'error', error: 'Could not write the .glb into the project folder.' })
				ctx?.log?.('info', `[venue-import] ${saved.name}: ${m.report?.triangles?.in} → ${m.report?.triangles?.out} triangles`)
				finish({ state: 'done', phase: 'done', text: `Saved ${saved.name}`, name: saved.name, report: m.report })
				if (typeof ctx?._wsBroadcast === 'function') ctx._wsBroadcast('change', { path: 'projectFiles', value: pf.list(ctx) })
			} catch (e) {
				finish({ state: 'error', error: String(e?.message || e) })
			}
		}
	})
	w.on('error', (e) => finish({ state: 'error', error: String(e?.message || e) }))
	w.on('exit', (code) => {
		if (worker === w) finish(job.state === 'running' ? { state: 'error', error: `conversion stopped (exit ${code})` } : {})
	})
	update(ctx, {})
	return { status: 200, body: snapshot() }
}

function cancel(ctx) {
	if (job?.state !== 'running' || !worker) return { status: 409, body: { error: 'No venue import is running.', job: snapshot() } }
	const w = worker
	worker = null
	update(ctx, { state: 'cancelled', text: 'Cancelled', endedAt: Date.now() })
	dropSession(job.session)
	Promise.resolve(w.terminate()).catch(() => {})
	return { status: 200, body: snapshot() }
}

/** Tests: forget everything. */
function _reset() {
	if (worker) Promise.resolve(worker.terminate()).catch(() => {})
	worker = null
	job = null
	for (const id of [...sessions.keys()]) dropSession(id)
}

module.exports = { session, target, charge, settle, start, cancel, snapshot, cleanRel, _reset, LIMITS, STAGE_ROOT }
