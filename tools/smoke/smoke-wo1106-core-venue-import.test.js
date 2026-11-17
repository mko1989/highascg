'use strict'

/**
 * WO-1106 B2 / B4 — venue-import uploads (src/api/routes-venue-import.js, src/media/venue-import-job.js), offline:
 *   B2  "x.obj" then "x.obj/y.png" in one upload is a rejected file, not an uncaughtException (= node exit)
 *   B4  caps: files per session, bytes per session, bytes staged in total, live sessions (LRU eviction); staging under
 *       the test runner is a private temp dir; the stage root is wiped on the first session outside the test runner
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')

const routes = require('../../src/api/routes-venue-import')
const job = require('../../src/media/venue-import-job')

const ROOT = path.join(__dirname, '..', '..')
const SAVED = { ...job.LIMITS }

function multipart(files, b = '----wo1106') {
	const parts = []
	for (const [name, data] of files) {
		parts.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), Buffer.from(data), Buffer.from('\r\n'))
	}
	parts.push(Buffer.from(`--${b}--\r\n`))
	const req = Readable.from([Buffer.concat(parts)])
	req.headers = { 'content-type': `multipart/form-data; boundary=${b}` }
	return req
}
const got = []
routes.register({ get: (p, f) => got.push(['GET', p, f]), post: (p, f) => got.push(['POST', p, f]) })
const upload = async (files, session) => {
	const f = got.find((g) => g[0] === 'POST' && g[1] === '/api/venue-import/files')[2]
	const r = await f({ req: multipart(files), ctx: { log() {} }, query: session ? { session } : {} })
	return { status: r.status, ...JSON.parse(r.body) }
}

test.afterEach(() => {
	Object.assign(job.LIMITS, SAVED)
	job._reset()
})

test('B4: staging under the test runner is a private temp dir, never the box one', () => {
	assert.notEqual(job.STAGE_ROOT, path.join(os.tmpdir(), 'highascg-venue-import'))
	assert.match(path.basename(job.STAGE_ROOT), /^highascg-test-venue-import-\d+-/)
	const src = fs.readFileSync(path.join(ROOT, 'src/media/venue-import-job.js'), 'utf8')
	assert.match(src, /let wiped = underTestRunner\(\)/, 'never wiped under the test runner')
	assert.match(src, /function session\(id\) \{\n\twipeOnce\(\)/, 'wiped on the first session of a process, not at load (a bare require must not empty the live folder)')
})

test('B2: a file then a folder of the same name is a rejected file, not a crash', async () => {
	let crashed = null
	const onCrash = (e) => (crashed = e)
	process.on('uncaughtException', onCrash)
	try {
		const r = await upload([['x.obj', 'o 1\n'], ['x.obj/y.png', 'png']])
		await new Promise((res) => setImmediate(res))
		assert.equal(crashed, null, String(crashed))
		assert.equal(r.status, 200)
		assert.deepEqual(r.saved, ['x.obj'])
		assert.equal(r.rejected.length, 1)
		assert.match(r.rejected[0].error, /already in the upload/)
		// the other way round, and across two uploads of one session (the earlier file is on disk by then)
		const r2 = await upload([['d/a.png', 'png'], ['d', 'x'], ['d.obj', 'o']], r.session)
		assert.deepEqual(r2.saved, ['d/a.png', 'd.obj'])
		const r3 = await upload([['x.obj/z.png', 'png'], ['d/a.png/q.png', 'png']], r.session)
		await new Promise((res) => setImmediate(res))
		assert.equal(crashed, null, String(crashed))
		assert.equal(r3.status, 415)
		assert.equal(r3.rejected.length, 2)
		assert.deepEqual(r3.files, ['d.obj', 'd/a.png', 'x.obj'])
	} finally {
		process.off('uncaughtException', onCrash)
	}
	// target() itself never throws
	const s = job.session()
	assert.equal(job.target(s, 'a.obj').rel, 'a.obj')
	fs.writeFileSync(path.join(s.dir, 'a.obj'), 'x')
	job.settle(s, 'a.obj', 1, true)
	assert.match(job.target(s, 'a.obj/b.png').error, /already in the upload/)
})

test('B4: file count and bytes per session are capped; over-cap files are removed and do not count', async () => {
	job.LIMITS.files = 2
	const r = await upload([['a.obj', '1'], ['b.png', '2'], ['c.png', '3']])
	assert.deepEqual(r.saved, ['a.obj', 'b.png'])
	assert.match(r.rejected[0].error, /too many files in one venue upload \(2 at most\)/)
	job.LIMITS.files = 100
	job.LIMITS.sessionBytes = 1000
	const big = await upload([['big.png', Buffer.alloc(1500)], ['small.png', Buffer.alloc(100)]], r.session)
	assert.deepEqual(big.saved, ['small.png'])
	assert.match(big.rejected[0].error, /the upload is over/)
	const dir = path.join(job.STAGE_ROOT, r.session)
	assert.equal(fs.existsSync(path.join(dir, 'big.png')), false, 'the cut-off file is removed')
	const again = await upload([['more.png', Buffer.alloc(700)]], r.session)
	assert.deepEqual(again.saved, ['more.png'], 'the refused bytes were given back')
})

test('B4: bytes staged in total are capped across sessions', async () => {
	job.LIMITS.totalBytes = 1000
	const a = await upload([['a.obj', Buffer.alloc(800)]])
	assert.deepEqual(a.saved, ['a.obj'])
	const b = await upload([['b.obj', Buffer.alloc(400)]])
	assert.equal(b.status, 415)
	assert.match(b.rejected[0].error, /not enough room for more venue uploads/)
})

test('B4: at most LIMITS.sessions live; a new one evicts the least recently used idle session', async () => {
	const ids = []
	for (let i = 0; i < 3; i++) ids.push((await upload([[`v${i}.obj`, 'o']])).session)
	job.session(ids[0]) // touched: now the most recent
	const fourth = (await upload([['v3.obj', 'o']])).session
	assert.equal(fs.existsSync(path.join(job.STAGE_ROOT, ids[1])), false, 'the oldest idle session is gone')
	for (const id of [ids[0], ids[2], fourth]) assert.ok(fs.existsSync(path.join(job.STAGE_ROOT, id)), id)
	assert.equal(fs.readdirSync(job.STAGE_ROOT).length, 3)
})
