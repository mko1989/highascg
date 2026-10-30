'use strict'

/**
 * WO-825 — the box-local GDTF Share library against a fake GDTF Share (no network): newest-revision selection, the
 * build (description XML + thumbnail kept, the rest dropped; resumable, cancellable, gives up on a failure streak,
 * replaces a superseded revision), using a library fixture (description-only stub → full file under the SAME type id,
 * offline → queued and retried), the follow-patch adoption hook, and the /api/fixtures/library/* routes.
 */

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { PNG } = require('pngjs')
const { zipStored } = require('./lib/zip-stored')

process.env.HIGHASCG_GDTF_SHARE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-test-gdtf-lib-'))
const share = require('../../src/fixtures/gdtf-share')
const store = require('../../src/fixtures/gdtf-store')
const lib = require('../../src/fixtures/gdtf-library')
const build = require('../../src/fixtures/gdtf-library-build')
const full = require('../../src/fixtures/gdtf-share-full')
const { Job } = require('../../src/fixtures/gdtf-share-job')
const { RouteRegistry } = require('../../src/api/route-registry')

const REAL = fs.readFileSync(path.join(__dirname, '../fixtures/gdtf/test-spot.xml'), 'utf8')
const png = (w, h) => {
	const p = new PNG({ width: w, height: h })
	p.data.fill(200)
	return PNG.sync.write(p)
}
const row = (rid, manufacturer, fixture, lastModified, extra = {}) => ({ rid, manufacturer, fixture, revision: `rev${rid}`, uploader: 'User',
	uuid: `U-${rid}`, lastModified, filesize: 5000, modes: [{ name: 'Standard', dmxfootprint: 7 }], ...extra })
const LIST = [row(1, 'Acme', 'Spot', 100), row(2, 'ACME', 'spot', 200) /* newer rev, same fixture */, row(3, 'Acme', 'Wash', 50),
	row(4, 'Beta', 'Bar', 10), row(5, 'Beta', 'NoThumb', 10)]
const FULL_MARK = Buffer.from('gobo-bytes')
/** fake GDTF Share; `down` = rids that fail; `calls` records the paths asked. */
function fake(state = {}) {
	state.calls = []
	const res = (status, body, headers = {}) => new Response(body, { status, headers })
	const f = async (url, opt = {}) => {
		const u = String(url)
		state.calls.push(u.split('/').pop())
		if (state.offline) throw new Error('offline')
		if (u.endsWith('/login.php')) return res(200, '{"result":true}', { 'set-cookie': 'PHPSESSID=abc; path=/' })
		if (u.endsWith('/getList.php')) return res(200, JSON.stringify({ result: true, list: LIST }))
		const rid = Number(/rid=(\d+)/.exec(u)?.[1])
		if (state.down?.includes(rid)) return res(500, '')
		const files = { 'description.xml': REAL.replace('Name="Test Spot"', `Name="Test Spot r${rid}"`), 'wheels/gobo1.png': FULL_MARK }
		if (rid !== 5) files['thumbnail.png'] = png(300, 200)
		return res(200, zipStored(files))
	}
	return f
}
const opts = (f, extra = {}) => ({ fetch: f, delayMs: 0, retryUnit: 1, ...extra })

test('newestPerFixture: one per maker+name (case-insensitive), the newest revision, stable order', () => {
	const t = build.newestPerFixture(LIST)
	assert.deepStrictEqual(t.map((e) => e.rid).sort(), [2, 3, 4, 5])
	assert.deepStrictEqual(build.newestPerFixture(LIST).map((e) => e.rid), t.map((e) => e.rid))
	assert.strictEqual(build.newestPerFixture([{ rid: 'x' }, null, { rid: 9 }]).length, 0)
})

test('build: XML + 128 px thumbnail kept, resumable, a newer revision replaces the old', async () => {
	share.setAccount('u', 'pw')
	const st = {}
	const seen = []
	const encode = async (p) => (seen.push(p.length), Buffer.from('RIFFwebp'))
	let j = await build.build(new Job('library'), opts(fake(st), { encode }))
	assert.deepStrictEqual([j.state, j.done, j.skipped, j.failed, j.total], ['done', 4, 0, 0, 4])
	const idx = lib.index()
	assert.deepStrictEqual(idx.entries.map((e) => e.rid).sort(), [2, 3, 4, 5])
	assert.ok(idx.builtAt)
	assert.ok(lib.xml(2).toString().includes('Test Spot r2'), 'the description is stored, brotli-compressed')
	assert.strictEqual(lib.thumb(2).toString(), 'RIFFwebp')
	assert.strictEqual(lib.thumb(5), null, 'no PNG in the archive → no thumbnail')
	assert.strictEqual(lib.byRid(5).thumb, 0)
	assert.deepStrictEqual(lib.byRid(2).modes, [{ name: 'Standard', footprint: 7 }])
	assert.strictEqual(fs.existsSync(lib.fullFile(2)), false, 'models / wheels are not kept')
	// a second run skips everything: nothing downloaded
	st.calls.length = 0
	j = await build.build(new Job('library'), opts(fake(st), { encode }))
	assert.deepStrictEqual([j.done, j.skipped], [0, 4])
	assert.ok(!st.calls.some((c) => c.startsWith('downloadFile')))
	// a newer revision of Acme Spot appears → rebuilt, the old files go
	LIST.push(row(6, 'Acme', 'Spot', 300))
	j = await build.build(new Job('library'), opts(fake({}), { encode, now: Date.now() + 3 * 24 * 3600 * 1000 })) // list cache expired
	assert.deepStrictEqual([j.done, j.skipped], [1, 3])
	assert.strictEqual(lib.byRid(2), null)
	assert.ok(lib.byRid(6))
	assert.strictEqual(fs.existsSync(lib.xmlFile(2)), false)
	LIST.pop()
	fs.rmSync(path.join(process.env.HIGHASCG_GDTF_SHARE_DIR, 'cache', 'gdtf-share-list.json'), { force: true }) // it cached the 6-row list
	fs.rmSync(lib.dir(), { recursive: true, force: true })
	lib.writeIndex([]) // reset
})

test('build: --limit, cancel keeps what is done, a failure streak ends the run in "error"', async () => {
	const encode = async () => Buffer.from('w')
	let j = await build.build(new Job('library'), opts(fake(), { encode, limit: 2 }))
	assert.deepStrictEqual([j.total, j.done], [2, 2])
	const job = new Job('library')
	const f = fake()
	let n = 0
	const cancelling = async (...a) => (String(a[0]).includes('downloadFile') && ++n === 1 ? (job.cancel(), f(...a)) : f(...a))
	j = await build.build(job, opts(cancelling, { encode }))
	assert.strictEqual(j.state, 'cancelled')
	assert.ok(lib.index().entries.length >= 2 && lib.index().entries.length < 4 + 1)
	// everything fails: stop after the streak
	fs.rmSync(lib.dir(), { recursive: true, force: true })
	j = await build.build(new Job('library'), opts(fake({ down: [2, 3, 4, 5] }), { encode, retryUnit: 0 }))
	assert.strictEqual(j.state, 'done', 'only 4 targets: below the streak limit, each counted failed')
	assert.strictEqual(j.failed, 4)
	assert.match(j.error, /HTTP 500/)
	fs.rmSync(lib.dir(), { recursive: true, force: true })
})

test('thumbnail re-encode: 128 px WebP through ffmpeg (skipped without ffmpeg)', async (t) => {
	let out
	try {
		out = await build.encodeThumb(png(400, 300))
	} catch (e) {
		if (/ENOENT/.test(e.message)) return t.skip('no ffmpeg')
		throw e
	}
	assert.strictEqual(out.subarray(0, 4).toString(), 'RIFF')
	assert.strictEqual(out.subarray(8, 12).toString(), 'WEBP')
	assert.ok(out.length < 4000)
	const tiny = await build.encodeThumb(png(40, 30))
	assert.ok(tiny.length > 0, 'a small image is not enlarged but still encoded')
})

test('use: stub type at once under a stable id, full file swapped in under the same id; offline → queued, retried', async () => {
	for (const t of store.list()) store.remove(t.id)
	await build.build(new Job('library'), opts(fake(), { encode: async () => Buffer.from('w') }))
	const e = lib.byRid(2)
	const id = lib.typeIdFor(e)
	assert.strictEqual(id, lib.typeIdFor({ key: lib.keyOf('ACME', 'SPOT') }), 'the id follows maker + name, not the revision')
	assert.strictEqual(lib.installed(e), 'none')
	// offline: the stub is there, the full file is not; queued
	const st = { offline: true }
	const reloads = []
	let r = await full.useFixture(e, { fetch: fake(st), wait: true, onUpgraded: () => reloads.push(1) })
	assert.deepStrictEqual([r.full, r.type.id, r.type.share], ['offline', id, { rid: 2, full: false }])
	assert.deepStrictEqual(full.readPending(), [id])
	assert.strictEqual(await store.member(id, 'wheels/gobo1.png'), null, 'stub has no wheel images')
	assert.strictEqual(store.mode(id, 'Standard') !== null || store.info(id).modes.length > 0, true, 'patchable from the description')
	assert.strictEqual(lib.installed(e), 'stub')
	// back online → the queue retries and upgrades IN PLACE
	st.offline = false
	assert.strictEqual(await full.retryPending({ fetch: fake(st), onUpgraded: () => reloads.push(1) }), 1)
	assert.deepStrictEqual(full.readPending(), [])
	assert.strictEqual(store.info(id).share.full, true)
	assert.strictEqual((await store.member(id, 'wheels/gobo1.png')).toString(), 'gobo-bytes')
	assert.strictEqual(reloads.length, 1)
	assert.strictEqual(lib.installed(e), 'full')
	// already full → nothing fetched
	st.calls.length = 0
	r = await full.useFixture(e, { fetch: fake(st), wait: true })
	assert.deepStrictEqual([r.full, st.calls.length], ['full', 0])
})

test('adoptPatch: a library type missing from the store is imported; a stub is upgraded at most once per retry window', async () => {
	for (const t of store.list()) store.remove(t.id)
	const e = lib.byRid(3)
	const id = lib.typeIdFor(e)
	const changes = []
	const st = { offline: true }
	const f = fake(st)
	const deps = (now) => ({ fetch: f, now, onChange: () => changes.push(1) })
	await full.adoptPatch([id, id, 'ffffffffffff'], deps(1e12))
	assert.strictEqual(store.info(id).share.full, false, 'imported from the built-in XML')
	assert.strictEqual(changes.length, 1)
	await new Promise((r) => setTimeout(r, 20)) // the background full fetch fails (offline) and queues
	const asked = st.calls.length
	await full.adoptPatch([id], deps(1e12 + 1000)) // inside the retry window: no new network try
	await new Promise((r) => setTimeout(r, 20))
	assert.strictEqual(st.calls.length, asked)
	st.offline = false
	await full.adoptPatch([id], deps(1e12 + full.RETRY_MS + 5))
	await new Promise((r) => setTimeout(r, 100))
	assert.strictEqual(store.info(id).share.full, true)
	assert.ok(changes.length >= 2, 'the patch is re-resolved after the upgrade')
})

test('full download: estimate, resumable files, disk guard, cancel, delete', async () => {
	fs.rmSync(path.dirname(lib.fullFile(0)), { recursive: true, force: true })
	const f = fake()
	const est = await full.estimate(f)
	assert.deepStrictEqual([est.files, est.bytes, est.doneFiles], [4, 20000, 0])
	let j = await full.runFull(new Job('full'), opts(f, { freeBytes: 1000 }))
	assert.strictEqual(j.state, 'error')
	assert.match(j.error, /not enough disk space/)
	j = await full.runFull(new Job('full'), opts(f, { freeBytes: 1e12, limit: 2 }))
	assert.deepStrictEqual([j.state, j.done], ['done', 2])
	assert.strictEqual(fs.readdirSync(path.dirname(lib.fullFile(0))).filter((n) => n.endsWith('.part')).length, 0)
	// the cache files were not the list's size (5000) → they are re-downloaded; make them match, then resume skips
	for (const n of fs.readdirSync(path.dirname(lib.fullFile(0)))) fs.writeFileSync(path.join(path.dirname(lib.fullFile(0)), n), Buffer.alloc(5000))
	j = await full.runFull(new Job('full'), opts(f, { freeBytes: 1e12 }))
	assert.deepStrictEqual([j.done, j.skipped], [2, 2])
	for (const n of fs.readdirSync(path.dirname(lib.fullFile(0)))) fs.writeFileSync(path.join(path.dirname(lib.fullFile(0)), n), Buffer.alloc(5000))
	assert.strictEqual((await full.estimate(f)).doneFiles, 4)
	assert.strictEqual(full.deleteFull(), 20000)
	assert.strictEqual((await full.estimate(f)).doneFiles, 0)
})

test('routes: status / search / thumb / use / build / full / cancel / 409 / delete', async () => {
	for (const t of store.list()) store.remove(t.id)
	const rl = require('../../src/api/routes-gdtf-library')
	rl._reset()
	const routes = new RouteRegistry()
	rl.register(routes)
	const reloads = []
	const ctx = { fixtureService: { reload: () => reloads.push(1) } }
	const call = async (method, p, body, query = {}) => {
		const r = await routes.dispatch(method, p, body === undefined ? undefined : JSON.stringify(body), ctx, null, query)
		return { status: r.status, body: Buffer.isBuffer(r.body) ? r.body : JSON.parse(r.body), headers: r.headers }
	}
	const idle = async () => {
		for (let i = 0; i < 200 && rl._job()?.state === 'running'; i++) await new Promise((r) => setTimeout(r, 10))
	}
	const s0 = (await call('GET', '/api/fixtures/library/status')).body
	assert.strictEqual(s0.library.ready, true) // built by the previous test
	assert.strictEqual(s0.job, null)
	assert.strictEqual(s0.account, true)
	const hit = (await call('GET', '/api/fixtures/library/search', undefined, { q: 'beta bar' })).body
	assert.deepStrictEqual([hit.results.length, hit.results[0].fixture, hit.results[0].installed, hit.results[0].thumb], [1, 'Bar', 'none', true])
	const th = await call('GET', '/api/fixtures/library/thumb/' + hit.results[0].rid)
	assert.deepStrictEqual([th.status, th.headers['Content-Type']], [200, 'image/webp'])
	assert.strictEqual((await call('GET', '/api/fixtures/library/thumb/999')).status, 404)
	assert.strictEqual((await call('POST', '/api/fixtures/library/use', { rid: 999 })).status, 404)
	const used = await call('POST', '/api/fixtures/library/use', { rid: hit.results[0].rid })
	assert.deepStrictEqual([used.status, used.body.type.share.rid, reloads.length >= 1], [200, 4, true])
	// jobs (the module reads the real fetch + account: swap in the fake through the global)
	const realFetch = global.fetch
	let gate
	const hold = new Promise((r) => (gate = r))
	const inner = fake()
	global.fetch = async (u, o) => (String(u).includes('downloadFile') ? (await hold, inner(u, o)) : inner(u, o))
	try {
		fs.rmSync(path.dirname(lib.fullFile(0)), { recursive: true, force: true })
		assert.strictEqual((await call('POST', '/api/fixtures/library/full')).status, 202)
		assert.strictEqual((await call('POST', '/api/fixtures/library/build', { limit: 1 })).status, 409, 'one job at a time')
		assert.strictEqual((await call('GET', '/api/fixtures/library/status')).body.job.state, 'running')
		assert.strictEqual((await call('DELETE', '/api/fixtures/library/full')).status, 409, 'not while downloading')
		assert.strictEqual((await call('POST', '/api/fixtures/library/cancel')).status, 200)
		gate()
		await idle()
		assert.strictEqual(rl._job().state, 'cancelled')
		const b = await call('POST', '/api/fixtures/library/build', { limit: 1 })
		assert.strictEqual(b.status, 202)
		await idle()
		assert.strictEqual(rl._job().state, 'done')
		assert.strictEqual((await call('POST', '/api/fixtures/library/cancel')).status, 409, 'nothing running')
		assert.strictEqual((await call('POST', '/api/fixtures/library/full')).status, 202)
		await idle()
		const s1 = (await call('GET', '/api/fixtures/library/status')).body
		assert.deepStrictEqual([s1.job.kind, s1.job.state, s1.job.done], ['full', 'done', 4])
	} finally {
		global.fetch = realFetch
	}
	const del = await call('DELETE', '/api/fixtures/library/full')
	assert.strictEqual(del.status, 200)
})
