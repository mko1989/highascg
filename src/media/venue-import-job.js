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
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const pf = require('./project-files')

const STAGE_ROOT = path.join(os.tmpdir(), 'highascg-venue-import')
const ACCEPT = new Set(['.obj', '.mtl', '.zip', '.skp', '.jpg', '.jpeg', '.png'])
const SESSION_TTL = 3 * 3600 * 1000
const WORKER = path.join(__dirname, '..', 'stage', 'venue-import-worker.js')

let job = null // { id, state: running|done|error|cancelled, phase, text, done, total, startedAt, endedAt, name?, report?, error? }
let worker = null
const sessions = new Map() // id → { dir, files: Set(rel), at }

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
	sweep()
	const key = /^[a-f0-9]{16}$/.test(String(id || '')) ? String(id) : crypto.randomBytes(8).toString('hex')
	let s = sessions.get(key)
	if (!s) {
		s = { id: key, dir: path.join(STAGE_ROOT, key), files: new Set(), at: Date.now() }
		fs.mkdirSync(s.dir, { recursive: true })
		sessions.set(key, s)
	}
	s.at = Date.now()
	return s
}

/** Where an uploaded file of session `s` goes → { abs, rel } | { error }. */
function target(s, rel) {
	const r = cleanRel(rel)
	if (!r) return { error: `bad file name: ${rel || '(none)'}` }
	if (!accepts(r)) return { error: `not part of a venue import: ${r} (OBJ, MTL, ZIP, SKP, JPG, PNG)` }
	const abs = path.join(s.dir, r)
	fs.mkdirSync(path.dirname(abs), { recursive: true })
	return { abs, rel: r }
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

module.exports = { session, target, start, cancel, snapshot, cleanRel, _reset }
