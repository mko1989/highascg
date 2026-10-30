'use strict'

/**
 * WO-825 — the full .gdtf files (3D models, gobo / colour wheel images) of GDTF Share fixtures:
 *   - useFixture(): a library fixture is used in a project → its description-only stub type is stored at once (patching
 *     and DMX work offline) and the full file is fetched in the background and swapped in under the SAME type id.
 *     Offline / refused → the stub stays, the id goes on pending.json and is retried (retryPending, every RETRY_MS).
 *   - runFull(): Settings → "Download full model library" — every newest-revision .gdtf into <library>/full/<rid>.gdtf
 *     (~12 GB, WO-825): cancellable, resumable (a file already there with the list's size is skipped), refuses when the
 *     disk cannot hold the rest. ensureFull() reads that cache before going to the network.
 */

const fs = require('fs')
const path = require('path')
const share = require('./gdtf-share')
const store = require('./gdtf-store')
const lib = require('./gdtf-library')
const { newestPerFixture } = require('./gdtf-library-build')
const { run } = require('./gdtf-share-job')

const RETRY_MS = 10 * 60 * 1000
const pendingFile = () => path.join(lib.dir(), 'pending.json')
const inflight = new Map() // typeId → Promise

function readPending() {
	try {
		const a = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'))
		return Array.isArray(a) ? a.map(String) : []
	} catch {
		return []
	}
}
function writePending(ids) {
	fs.mkdirSync(lib.dir(), { recursive: true })
	if (!ids.length) return fs.rmSync(pendingFile(), { force: true })
	fs.writeFileSync(pendingFile(), JSON.stringify([...new Set(ids)]))
}

/** The full .gdtf of a library entry: the downloaded cache, else GDTF Share. */
async function fullBytes(f, entry, deps = {}) {
	try {
		return fs.readFileSync(lib.fullFile(entry.rid))
	} catch {}
	return (deps.download || share.download)(f, entry.rid)
}

/**
 * Swap the stub of a library type for the full file (same id). → 'full' (done / already) | 'offline' (kept the stub,
 * queued for retry) | 'missing' (not a library type). deps: { fetch, download, onUpgraded(typeId) }.
 */
async function ensureFull(typeId, deps = {}) {
	if (inflight.has(typeId)) return inflight.get(typeId)
	const p = (async () => {
		const entry = lib.byTypeId(typeId)
		if (!entry) return 'missing'
		if (store.record(typeId)?.share?.full) return 'full'
		try {
			const buf = await fullBytes(deps.fetch || fetch, entry, deps)
			await store.importGdtf(buf, `${entry.manufacturer}@${entry.fixture}@rid${entry.rid}.gdtf`, { id: typeId, share: { rid: entry.rid, full: true } })
			writePending(readPending().filter((x) => x !== typeId))
			deps.onUpgraded?.(typeId)
			return 'full'
		} catch (e) {
			writePending([...readPending(), typeId])
			deps.log?.('warn', `[gdtf-library] ${entry.manufacturer} ${entry.fixture}: full file not fetched (${e.message}) — built-in description kept, retrying later`)
			return 'offline'
		}
	})().finally(() => inflight.delete(typeId))
	inflight.set(typeId, p)
	return p
}

/**
 * A library fixture goes into a project: stub type now, full file in the background (`wait` awaits it — tests).
 * @returns {Promise<{ type: object, full: 'full' | 'offline' | 'pending' } | null>} null when the entry has no XML
 */
async function useFixture(entry, deps = {}) {
	const type = await lib.useType(entry)
	if (!type) return null
	const id = lib.typeIdFor(entry)
	if (type.share?.full) return { type, full: 'full' }
	if (deps.wait) {
		const full = await ensureFull(id, deps)
		return { type: store.info(id), full }
	}
	ensureFull(id, deps).catch(() => {})
	return { type, full: 'pending' }
}

const lastTry = new Map() // typeId → ms of the last adoptPatch-started fetch (a project save must not re-hit the network)

/**
 * The patch's hook (follow-service.js, on every project change): for each typeId in use — a library type missing from
 * the store (project from another box / a cleared type store) is imported from the library XML; a description-only
 * stub gets its full file fetched (at most one try per RETRY_MS per type). deps.onChange() re-resolves the patch.
 */
async function adoptPatch(typeIds, deps = {}) {
	const now = deps.now ?? Date.now()
	for (const id of new Set(typeIds || [])) {
		let rec = store.record(id)
		if (!rec) {
			const entry = lib.byTypeId(id)
			if (!entry || !(await lib.useType(entry))) continue
			deps.onChange?.()
			rec = store.record(id)
		}
		if (!rec?.share || rec.share.full || now - (lastTry.get(id) || 0) < RETRY_MS) continue
		lastTry.set(id, now)
		ensureFull(id, { ...deps, onUpgraded: () => deps.onChange?.() }).catch(() => {})
	}
}

/** Retry the queued upgrades (a timer in routes-gdtf-library.js calls this). @returns {Promise<number>} upgraded */
async function retryPending(deps = {}) {
	let n = 0
	for (const id of readPending()) if ((await ensureFull(id, deps)) === 'full') n++
	return n
}

/** What the full download is: files / bytes of the newest revisions, and how much is already cached. */
async function estimate(f, deps = {}) {
	const { list: all } = await share.list(f, deps.now)
	let files = 0, bytes = 0, doneFiles = 0, doneBytes = 0
	for (const e of newestPerFixture(all)) {
		files++
		bytes += Number(e.filesize) || 0
		if (cached(e)) {
			doneFiles++
			doneBytes += Number(e.filesize) || 0
		}
	}
	return { files, bytes, doneFiles, doneBytes }
}

function cached(e) {
	try {
		const st = fs.statSync(lib.fullFile(e.rid))
		return !e.filesize || st.size === Number(e.filesize)
	} catch {
		return false
	}
}

/** Download every newest-revision .gdtf into the cache. `job` is cancellable; returns it. deps: { fetch, download, limit, delayMs, retryUnit, freeBytes } */
async function runFull(job, deps = {}) {
	const f = deps.fetch || fetch
	const { list: all } = await share.list(f, deps.now)
	let targets = newestPerFixture(all)
	if (deps.limit > 0) targets = targets.slice(0, deps.limit)
	job.total = targets.length
	const todo = targets.filter((e) => !cached(e))
	const need = todo.reduce((n, e) => n + (Number(e.filesize) || 0), 0)
	fs.mkdirSync(path.dirname(lib.fullFile(0)), { recursive: true })
	const free = deps.freeBytes ?? (() => {
		const s = fs.statfsSync(path.dirname(lib.fullFile(0)))
		return Number(s.bavail) * Number(s.bsize)
	})()
	if (free < need * 1.05) {
		job.state = 'error'
		job.error = `not enough disk space: ${Math.ceil(need / 2 ** 20)} MB to download, ${Math.floor(free / 2 ** 20)} MB free`
		return job
	}
	const step = async (e) => {
		if (cached(e)) return 'skip'
		const buf = await (deps.download || share.download)(f, e.rid)
		const file = lib.fullFile(e.rid)
		fs.writeFileSync(`${file}.part`, buf)
		fs.renameSync(`${file}.part`, file)
		return buf.length
	}
	await run(job, targets, step, { delayMs: deps.delayMs ?? 300, retryUnit: deps.retryUnit, label: (e) => `${e.manufacturer} ${e.fixture}` })
	return job
}

/** Remove the downloaded full files (the library XML and the stored project types stay). @returns {number} bytes freed */
function deleteFull() {
	const d = path.dirname(lib.fullFile(0))
	let bytes = 0
	for (const n of fs.existsSync(d) ? fs.readdirSync(d) : []) {
		bytes += fs.statSync(path.join(d, n)).size
		fs.rmSync(path.join(d, n), { force: true })
	}
	return bytes
}

module.exports = { adoptPatch, ensureFull, useFixture, retryPending, readPending, estimate, runFull, deleteFull, RETRY_MS }
