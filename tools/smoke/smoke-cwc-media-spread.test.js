'use strict'

/**
 * WO-1029 plan 07 C10 — the media Spread: plan (default + explicit any-file), order, skip rules, the run (409, cancel,
 * free space, rate limit only on air, one failure does not stop the rest, progress inside one huge file), the third-server
 * source (remote push + follow), push jobs one at a time, the rsync argv contract, and the resumable loopback copy.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { computeNeeds, libraryIndex } = require('../../src/cluster/cluster-media-needs')
const { planSpread, createSpreader, ON_AIR_KBPS } = require('../../src/cluster/cluster-media-spread')
const { createPushJobs, remoteCopy } = require('../../src/cluster/cluster-media-link')
const tr = require('../../src/cluster/cluster-media-transport')

const F = (p, s = 100, m = 1000) => ({ p, id: p.replace(/\.[a-z0-9]+$/i, '').toUpperCase(), s, m })
const SERVERS = [
	{ id: 'A', name: 'boxA', self: true, online: true },
	{ id: 'B', name: 'boxB', online: true },
	{ id: 'C', name: 'boxC', online: true },
]
const DESTS = [{ id: 'd2', label: 'Stream PGM', main: 1, owners: ['B'] }, { id: 'd3', label: 'Third', main: 2, owners: ['C'] }]
const look = (id, scope, clips) => ({ id, name: id, mainScope: String(scope), layers: clips.map((c) => ({ source: { type: 'file', value: c } })) })

function setup(invs, scenes = [], servers = SERVERS) {
	const inventory = (id) => invs[id] || { known: false, reason: 'old build' }
	const needs = computeNeeds({ project: { scenes }, destinations: DESTS, servers, inventory })
	return { needs, index: libraryIndex(servers, inventory) }
}
const plan = (s, o = {}) => planSpread(s.needs, { index: s.index, selfId: 'A', ...o })
const flush = () => new Promise((r) => setImmediate(r))
const until = async (pred) => {
	for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 5))
	assert.ok(pred(), 'condition not reached')
}

describe('WO-1029 C10 spread plan', () => {
	it('default: every missing pair, own pushes first, then per target, small first; nowhere / unknown skipped', () => {
		const s = setup({
			A: { known: true, files: [F('big.mp4', 900), F('small.mp4', 10)] },
			B: { known: true, files: [] },
			C: { known: true, files: [F('from_c.mp4', 5)] },
		}, [look('l1', 1, ['big', 'small', 'from_c', 'nowhere']), look('l2', 2, ['small'])])
		const p = plan(s)
		assert.deepEqual(p.transfers.map((t) => `${t.id}:${t.from}>${t.to}`), ['SMALL:A>B', 'BIG:A>B', 'SMALL:A>C', 'FROM_C:C>B'])
		assert.deepEqual(p.skipped, [{ id: 'NOWHERE', path: '', to: 'B', error: 'on no linked server' }])
		const only = plan(s, { to: ['C'] })
		assert.deepEqual(only.transfers.map((t) => t.id), ['SMALL'])
	})

	it('explicit: a file nobody needs, OUTSIDE the project folder, by its media id; lands at the same relative path', () => {
		const s = setup({
			A: { known: true, files: [F('TESTOWE/BIG_BUCK_BUNNY_1080P24.y4m', 40e9, 500)] },
			B: { known: true, files: [] },
			C: { known: true, files: [] },
		})
		assert.deepEqual(s.needs.files, [], 'not needed by any destination')
		const p = plan(s, { files: ['TESTOWE/BIG_BUCK_BUNNY_1080P24'], to: ['B'] })
		assert.deepEqual(p.transfers, [{ id: 'TESTOWE/BIG_BUCK_BUNNY_1080P24', path: 'TESTOWE/BIG_BUCK_BUNNY_1080P24.y4m', from: 'A', to: 'B', bytes: 40e9, mtime: 500, reason: 'missing' }])
		const all = plan(s, { files: ['testowe/big_buck_bunny_1080p24'] }) // case-insensitive; no `to` = every server lacking it
		assert.deepEqual(all.transfers.map((t) => t.to), ['B', 'C'])
	})

	it('explicit: already there (size + mtime), offline, unknown, not linked, on nobody', () => {
		const servers = [...SERVERS, { id: 'D', name: 'boxD', online: false }]
		const s = setup({
			A: { known: true, files: [F('x.mp4', 100, 1000)] },
			B: { known: true, files: [F('x.mp4', 100, 1001)] },
		}, [], servers)
		const p = plan(s, { files: ['X', 'GHOST'], to: ['B', 'C', 'D', 'Z'] })
		assert.deepEqual(p.transfers, [])
		const why = Object.fromEntries(p.skipped.filter((x) => x.id === 'X').map((x) => [x.to, x.error]))
		assert.deepEqual(why, { B: 'already there', C: "boxC's inventory is unknown", D: 'boxD is offline', Z: 'not a linked server' })
		assert.ok(p.skipped.some((x) => x.id === 'GHOST' && x.error === "boxC's inventory is unknown" ? false : x.id === 'GHOST' && x.to === 'B' && x.error === 'on no linked server'))
	})

	it('a newer copy on the target is not overwritten without overwrite (differs), and is with it', () => {
		const s = setup({ A: { known: true, files: [F('x.mp4', 100, 1000)] }, B: { known: true, files: [F('x.mp4', 90, 9000)] }, C: { known: true, files: [F('x.mp4', 100, 1000)] } }, [look('l1', 1, ['x'])])
		assert.deepEqual(plan(s).transfers, [])
		assert.deepEqual(plan(s).skipped, [{ id: 'X', path: 'x.mp4', to: 'B', error: 'newer on boxB (overwrite to replace)' }])
		const o = plan(s, { overwrite: true })
		assert.deepEqual(o.transfers.map((t) => [t.from, t.to, t.reason]), [['A', 'B', 'differs']])
	})
})

/** A spreader over a fake transport; `servers` = per id { free_bytes, on_air, can_throttle }. */
function spreader(servers, copy, extra = {}) {
	const events = []
	let t = 0
	const sp = createSpreader({ server: (id) => ({ name: `box${id}`, ...servers[id] }), copy, broadcast: (e) => events.push(e), now: () => (t += 100), ...extra })
	return { sp, events }
}
const T = (id, to, bytes = 10, from = 'A') => ({ id, path: `${id}.mp4`, from, to, bytes, reason: 'missing' })

describe('WO-1029 C10 spread run', () => {
	it('one transfer at a time; 409 while running; a failure does not stop the rest; never a delete op', async () => {
		const ops = []
		let active = 0
		let maxActive = 0
		let release
		const gate = new Promise((r) => (release = r))
		const { sp, events } = spreader({ B: { free_bytes: 1e12 } }, async (f) => {
			ops.push(`copy ${f.id}`)
			active++
			maxActive = Math.max(maxActive, active)
			await gate
			active--
			return f.id === 'BAD' ? { ok: false, error: 'rsync: broken pipe' } : { ok: true }
		})
		const r = sp.start({ transfers: [T('ONE', 'B'), T('BAD', 'B'), T('THREE', 'B')], skipped: [{ id: 'S', to: 'B', error: 'already there' }] })
		assert.equal(r.status, 202)
		assert.ok(r.body.run_id)
		const again = sp.start({ transfers: [T('X', 'B')], skipped: [] })
		assert.equal(again.status, 409)
		assert.equal(again.body.run.id, r.body.run_id)
		release()
		await until(() => !sp.running())
		const run = sp.status().run
		assert.deepEqual(run.files.map((f) => [f.id, f.state]), [['ONE', 'done'], ['BAD', 'failed'], ['THREE', 'done'], ['S', 'skipped']])
		assert.equal(run.files[1].error, 'rsync: broken pipe')
		assert.equal(run.state, 'done')
		assert.equal(maxActive, 1)
		assert.ok(ops.every((o) => o.startsWith('copy ')))
		assert.deepEqual([events[0].event, events.at(-1).event], ['start', 'done'])
		assert.equal(sp.start({ transfers: [], skipped: [] }).status, 400)
	})

	it('free space: refused for the whole target with needed and available named; other targets go on', async () => {
		const done = []
		const { sp } = spreader({ B: { free_bytes: 8e9 }, C: { free_bytes: 1e12 } }, async (f) => (done.push(f.id), { ok: true }))
		sp.start({ transfers: [T('HUGE', 'B', 40e9), T('ALSO', 'B', 1), T('FINE', 'C', 40e9)], skipped: [] })
		await until(() => !sp.running())
		const files = sp.status().run.files
		assert.equal(files[0].state, 'failed')
		assert.equal(files[0].error, 'not enough space on boxB (needs 42.00 GB, 8.00 GB free)')
		assert.equal(files[1].state, 'failed')
		assert.deepEqual(done, ['FINE'])
	})

	it('rate limit only while on air (10 MB/s); idle = no limit; on air + a receiver that cannot throttle = not sent', async () => {
		const seen = []
		const copy = async (f, o) => (seen.push([f.id, o.throttleKbps]), { ok: true })
		const { sp } = spreader({ A: { on_air: true }, B: { can_throttle: true }, C: { can_throttle: false }, D: { on_air: false, can_throttle: false } }, copy)
		sp.start({ transfers: [T('AIR', 'B'), T('NOTHROTTLE', 'C'), T('IDLE', 'D', 10, 'E')], skipped: [] })
		await until(() => !sp.running())
		assert.deepEqual(seen, [['AIR', ON_AIR_KBPS], ['IDLE', null]])
		assert.equal(ON_AIR_KBPS, Math.round(10e6 / 1024))
		assert.match(sp.status().run.files[1].error, /^on air: boxC cannot take a rate-limited copy/)
	})

	it('progress inside ONE huge file: bytes reported as they go, not only per file', async () => {
		let clock = 0
		const { sp, events } = spreader({ B: { free_bytes: 1e12 } }, async (f, o) => {
			for (let b = 1; b <= 4; b++) {
				o.onProgress(b * 10e9)
				await flush()
			}
			return { ok: true }
		}, { now: () => (clock += 1000) })
		sp.start({ transfers: [T('BIG_BUCK', 'B', 40e9)], skipped: [] })
		await until(() => !sp.running())
		const prog = events.filter((e) => e.event === 'file' && e.file.state === 'copying').map((e) => e.file.done_bytes)
		assert.ok(prog.length >= 3, `progress events: ${prog}`)
		assert.ok(prog.some((b) => b > 0 && b < 40e9))
		assert.equal(sp.status().run.done_bytes, 40e9)
	})

	it('cancel: the running copy is aborted, queued ones skipped "cancelled"; 409 when nothing runs', async () => {
		const { sp } = spreader({ B: {} }, (f, o) => new Promise((resolve) => o.signal.addEventListener('abort', () => resolve({ ok: false, error: 'killed' }))))
		sp.start({ transfers: [T('ONE', 'B'), T('TWO', 'B')], skipped: [] })
		await flush()
		assert.equal(sp.cancel().status, 200)
		await until(() => !sp.running())
		const run = sp.status().run
		assert.equal(run.state, 'cancelled')
		assert.deepEqual(run.files.map((f) => [f.state, f.error]), [['failed', 'cancelled'], ['skipped', 'cancelled']])
		assert.equal(sp.cancel().status, 409)
	})
})

describe('WO-1029 C10 third-server source and push jobs', () => {
	it('the asker has the source push, waits out busy, follows progress to done', async () => {
		const calls = []
		let polls = 0
		const call = async (id, action, args) => {
			calls.push([id, action, args])
			if (action === 'media.push') return calls.filter((c) => c[1] === 'media.push').length === 1 ? { ok: false, status: 409, json: { busy: true } } : { ok: true, status: 202, json: { job: 'pj1' } }
			polls++
			return { ok: true, status: 200, json: polls < 3 ? { state: 'copying', done_bytes: polls * 5 } : { state: 'done', done_bytes: 20 } }
		}
		const progress = []
		const r = await remoteCopy({ from: 'C', to: 'B', path: 'x.mp4', bytes: 20 }, { signal: new AbortController().signal, throttleKbps: null, onProgress: (b) => progress.push(b) },
			{ call, fingerprintOf: (id) => `fp_${id}`, nameOf: (id) => `box${id}`, sleepFn: () => Promise.resolve() })
		assert.deepEqual(r, { ok: true })
		assert.deepEqual(calls[1], ['C', 'media.push', { to: 'fp_B', path: 'x.mp4', bytes: 20, throttle_kbps: null, mtime: null }])
		assert.deepEqual(progress, [5, 10, 20])
	})

	it('an older-build source: a clear error; cancel tells the source', async () => {
		const old = await remoteCopy({ from: 'C', to: 'B', path: 'x', bytes: 1 }, { signal: new AbortController().signal }, { call: async () => ({ ok: false, status: 404, json: { error: 'Not found' } }), fingerprintOf: () => 'f', nameOf: (id) => `box${id}`, sleepFn: async () => {} })
		assert.deepEqual(old, { ok: false, error: 'boxC is an older build (cannot push media for this server)' })
		const ctl = new AbortController()
		const seen = []
		const r = await remoteCopy({ from: 'C', to: 'B', path: 'x', bytes: 1 }, { signal: ctl.signal }, {
			call: async (id, a) => (seen.push(a), a === 'media.push' ? { ok: true, json: { job: 'j' } } : (ctl.abort(), { ok: true, json: { state: 'copying' } })),
			fingerprintOf: () => 'f', nameOf: (id) => id, sleepFn: async () => {},
		})
		assert.equal(r.error, 'cancelled')
		assert.equal(seen.at(-1), 'media.push_cancel')
	})

	it('push jobs: one transfer at a time on a server; a remote request while busy is 409 busy', async () => {
		let release
		const jobs = createPushJobs({ push: () => new Promise((r) => (release = () => r({ ok: true }))) })
		const own = jobs.run({ path: 'a', to: 'f', bytes: 5 })
		await flush()
		assert.equal(jobs.busy(), true)
		const r = jobs.start({ path: 'b', to: 'f', bytes: 5 })
		assert.equal(r.status, 409)
		assert.equal(r.body.busy, true)
		release()
		assert.equal((await own).state, 'done')
		const s = jobs.start({ path: 'b', to: 'f', bytes: 5 })
		assert.equal(s.status, 202)
		release()
		await until(() => jobs.status(s.body.job).body.state === 'done')
	})
})

describe('WO-1029 C10 transports', () => {
	it('rsync argv: -rtL, a files-from list, never --delete / owner / perms; bwlimit and partial-dir only when the receiver takes them', () => {
		const base = { mediaBase: '/m/', listFile: '/tmp/l', remote: 'casparcg@10.0.0.2:', remoteRoot: '/home/casparcg/highascg', sshCommand: 'ssh -o BatchMode=yes' }
		const plain = tr.rsyncPushArgs(base)
		assert.deepEqual(plain, ['-rtL', '--info=progress2', '--files-from=/tmp/l', '-e', 'ssh -o BatchMode=yes', '/m/', 'casparcg@10.0.0.2:/home/casparcg/highascg/media/'])
		const full = tr.rsyncPushArgs({ ...base, bwlimitKbps: ON_AIR_KBPS, resume: true })
		assert.ok(full.includes(`--bwlimit=${ON_AIR_KBPS}`))
		assert.ok(full.includes('--partial-dir=.highascg-partial'))
		for (const a of [...plain, ...full]) assert.ok(!/^--(delete|remove)|^-[a-zA-Z]*[ogpaD]/.test(a), a)
		assert.equal(tr.parseProgress('  1,048,576  12%  10.00MB/s  0:00:10\r  2,097,152  25%  10.00MB/s'), 2097152)
		assert.equal(tr.safeRel('../etc/passwd'), '')
		assert.equal(tr.safeRel('TESTOWE/BIG_BUCK_BUNNY_1080P24.y4m'), 'TESTOWE/BIG_BUCK_BUNNY_1080P24.y4m')
	})

	it('resumable copy: a cancelled huge copy leaves only a hidden partial (never the final name) and resumes from it', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-cwc-spread-'))
		const src = path.join(root, 'a', 'TESTOWE', 'big.y4m')
		fs.mkdirSync(path.dirname(src), { recursive: true })
		const data = Buffer.alloc(8 * 1024 * 1024, 7)
		fs.writeFileSync(src, data)
		fs.utimesSync(src, new Date(1e12), new Date(1e12))
		const dest = path.join(root, 'b', 'TESTOWE', 'big.y4m')
		fs.mkdirSync(path.join(root, 'b'), { recursive: true })
		fs.writeFileSync(path.join(root, 'b', 'keep.mp4'), 'other file')
		const ctl = new AbortController()
		await assert.rejects(tr.resumableCopy(src, dest, { signal: ctl.signal, onProgress: (b) => b > 0 && ctl.abort() }), /cancelled/)
		assert.equal(fs.existsSync(dest), false, 'no truncated file under the final name')
		const part = path.join(root, 'b', 'TESTOWE', '.highascg-partial', 'big.y4m')
		const had = fs.statSync(part).size
		assert.ok(had > 0 && had < data.length, `partial ${had}`)
		const progress = []
		await tr.resumableCopy(src, dest, { onProgress: (b) => progress.push(b) })
		assert.equal(progress[0], had, 'resumed from the partial')
		assert.ok(fs.readFileSync(dest).equals(data))
		assert.equal(Math.floor(fs.statSync(dest).mtimeMs), 1e12)
		assert.equal(fs.existsSync(path.dirname(part)), false, 'partial folder gone')
		assert.equal(fs.readFileSync(path.join(root, 'b', 'keep.mp4'), 'utf8'), 'other file', 'nothing deleted')
		fs.rmSync(root, { recursive: true, force: true })
	})

	it('loopback copy: only in a sandbox bed, only inside the temp directory', async () => {
		const prev = { s: process.env.HIGHASCG_SANDBOX, l: process.env.HIGHASCG_SANDBOX_MEDIA_LOOPBACK }
		try {
			delete process.env.HIGHASCG_SANDBOX
			assert.match((await tr.loopbackCopyFile({ srcBase: os.tmpdir(), rel: 'x', destRoot: os.tmpdir() })).error, /sandbox bed only/)
			process.env.HIGHASCG_SANDBOX = '1'
			process.env.HIGHASCG_SANDBOX_MEDIA_LOOPBACK = '1'
			const root = fs.mkdtempSync(path.join(os.tmpdir(), 'highascg-cwc-loop-'))
			fs.mkdirSync(path.join(root, 'a'))
			fs.writeFileSync(path.join(root, 'a', 'c.mp4'), 'clip')
			const out = await tr.loopbackCopyFile({ srcBase: path.join(root, 'a'), rel: 'deep/../c.mp4', destRoot: path.join(root, 'b') })
			assert.equal(out.error, 'bad media path')
			assert.match((await tr.loopbackCopyFile({ srcBase: path.join(root, 'a'), rel: 'c.mp4', destRoot: '/home/casparcg/highascg/media' })).error, /outside the temp directory/)
			assert.deepEqual(await tr.loopbackCopyFile({ srcBase: path.join(root, 'a'), rel: 'c.mp4', destRoot: path.join(root, 'b') }), { ok: true })
			assert.equal(fs.readFileSync(path.join(root, 'b', 'c.mp4'), 'utf8'), 'clip')
			fs.rmSync(root, { recursive: true, force: true })
		} finally {
			for (const [k, v] of [['HIGHASCG_SANDBOX', prev.s], ['HIGHASCG_SANDBOX_MEDIA_LOOPBACK', prev.l]]) if (v == null) delete process.env[k]; else process.env[k] = v
		}
	})
})
