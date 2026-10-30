'use strict'

/**
 * WO-825 — the GDTF Share library (src/fixtures/gdtf-library.js), registered by routes-gdtf-share.js:
 *   GET    /api/fixtures/library/status       → { library: { ready, count, builtAt, bytes, files }, full: { files, bytes,
 *          doneFiles, doneBytes, cachedBytes }, job: {...} | null, pending, account } — `full` needs the Share list
 *          (cached 24 h); `full.error` when there is none yet.
 *   GET    /api/fixtures/library/search?q=&limit=   → { total, results: [{ rid, typeId, manufacturer, fixture, revision,
 *          modes[{name, footprint}], thumb, installed: 'none'|'stub'|'full' }] }
 *   GET    /api/fixtures/library/thumb/<rid>  → the 128 px WebP
 *   POST   /api/fixtures/library/use {rid}    → { type, full: 'full'|'pending' } — the fixture goes into the type store
 *          (description only, usable at once) and its full .gdtf (models, gobos) is fetched in the background
 *   POST   /api/fixtures/library/build {limit?}   → starts the XML + thumbnail build (resumable; 409 while a job runs)
 *   POST   /api/fixtures/library/full         → starts the full model download (~12 GB; resumable; 409 while a job runs)
 *   POST   /api/fixtures/library/cancel       → stops the running job (nothing done is lost)
 *   DELETE /api/fixtures/library/full         → deletes the downloaded full files → { freed }
 */

const lib = require('../fixtures/gdtf-library')
const build = require('../fixtures/gdtf-library-build')
const full = require('../fixtures/gdtf-share-full')
const share = require('../fixtures/gdtf-share')
const { Job } = require('../fixtures/gdtf-share-job')
const { JSON_HEADERS, jsonBody, parseBody } = require('./response')

const reply = (status, o) => ({ status, headers: JSON_HEADERS, body: jsonBody(o) })
let job = null // the one running or last finished job
let timer = null
let est = { at: 0, v: null } // the full-download estimate parses the 7 MB Share list: not on every 1 s poll

const running = () => job && job.state === 'running'

function startJob(kind, deps = {}) {
	if (running()) return reply(409, { error: `a ${job.kind} job is already running`, job: job.snapshot() })
	if (!(deps.fetch || share.account())) return reply(400, { error: 'no GDTF Share account set' })
	job = new Job(kind)
	const j = job
	const go = kind === 'full' ? full.runFull : build.build
	go(j, deps).catch((e) => {
		j.state = 'error'
		j.error = e.message
	})
	return reply(202, { job: j.snapshot() })
}

async function status(deps = {}) {
	const idx = lib.index()
	const u = lib.usage()
	const out = { library: { ready: idx.entries.length > 0, count: idx.entries.length, builtAt: idx.builtAt, bytes: u.bytes, files: u.files },
		job: job ? job.snapshot() : null, pending: full.readPending().length, account: !!(deps.fetch || share.account()) }
	try {
		if (!est.v || Date.now() - est.at > 5000) est = { at: Date.now(), v: await full.estimate(deps.fetch || fetch, deps) }
		out.full = est.v
	} catch (e) {
		out.full = { files: 0, bytes: 0, doneFiles: 0, doneBytes: 0, error: e.message }
	}
	return reply(200, out)
}

function search(query) {
	const rows = lib.search(query?.q, query?.limit)
	return reply(200, { total: lib.index().entries.length, results: rows.map((e) => ({ rid: e.rid, typeId: lib.typeIdFor(e),
		manufacturer: e.manufacturer, fixture: e.fixture, revision: e.revision, modes: e.modes, thumb: e.thumb > 0, installed: lib.installed(e) })) })
}

async function use(body, ctx, deps = {}) {
	const b = parseBody(body) || {}
	const entry = lib.byRid(b.rid)
	if (!entry) return reply(404, { error: 'not in the library (build it in Settings → GDTF library)' })
	const r = await full.useFixture(entry, { ...deps, onUpgraded: () => ctx?.fixtureService?.reload?.() })
	if (!r) return reply(404, { error: 'the library has no description for this fixture' })
	ctx?.fixtureService?.reload?.()
	return reply(200, r)
}

function register(routes) {
	const opt = { requireCaspar: false }
	routes.get('/api/fixtures/library/status', () => status(), opt)
	routes.get('/api/fixtures/library/search', ({ query }) => search(query), opt)
	routes.get('/api/fixtures/library/thumb/:rid', ({ params }) => {
		const t = lib.thumb(params.rid)
		return t ? { status: 200, headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'max-age=86400' }, body: t } : reply(404, { error: 'no thumbnail' })
	}, opt)
	routes.post('/api/fixtures/library/use', ({ body, ctx }) => use(body, ctx), opt)
	routes.post('/api/fixtures/library/build', ({ body }) => {
		const limit = Number((parseBody(body) || {}).limit)
		return startJob('library', limit > 0 ? { limit } : {})
	}, opt)
	routes.post('/api/fixtures/library/full', () => startJob('full'), opt)
	routes.post('/api/fixtures/library/cancel', () => {
		if (!running()) return reply(409, { error: 'nothing is running' })
		job.cancel()
		return reply(200, { job: job.snapshot() })
	}, opt)
	routes.delete('/api/fixtures/library/full', () => (running() && job.kind === 'full' ? reply(409, { error: 'cancel the download first' })
		: reply(200, { freed: full.deleteFull() })), opt)
	// offline use of a library fixture is retried (WO-825): the queue is persisted, the timer only exists while it is non-empty
	if (!timer) {
		timer = setInterval(() => {
			if (full.readPending().length) full.retryPending({}).catch(() => {})
		}, full.RETRY_MS)
		timer.unref?.()
	}
}

module.exports = { register, startJob, status, search, use, _job: () => job, _reset: () => ((job = null), (est = { at: 0, v: null })) }
