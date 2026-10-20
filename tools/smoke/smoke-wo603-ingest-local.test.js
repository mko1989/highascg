'use strict'

/**
 * WO-603 slice 1 — files dropped on the on-box Godot client are copied by the server from their local paths
 * (POST /api/media/ingest-local), folders walked server side with the web WO-591 placement, loopback only.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { planLocalIngest, resolveTarget, copyPlanned } = require('../../src/media/local-ingest')
const routes = require('../../src/api/routes-media-ingest-local')

function sandbox() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wo603-'))
	const media = path.join(root, 'media')
	const desk = path.join(root, 'desk')
	fs.mkdirSync(path.join(media, 'SHOW'), { recursive: true })
	fs.mkdirSync(path.join(desk, 'Akt 1', 'sub'), { recursive: true })
	fs.writeFileSync(path.join(desk, 'loose.mp4'), 'L')
	fs.writeFileSync(path.join(desk, 'Akt 1', 'a.mov'), 'AA')
	fs.writeFileSync(path.join(desk, 'Akt 1', 'sub', 'b.png'), 'BBB')
	fs.symlinkSync('/etc/hostname', path.join(desk, 'Akt 1', 'link.txt'))
	return { root, media, desk }
}

const loopback = { socket: { remoteAddress: '::ffff:127.0.0.1' } }

describe('WO-603 planLocalIngest — the web drop placement, walked on the server', () => {
	it('a file lands by name, a folder as <folder>/… with its subfolders; links are skipped', () => {
		const s = sandbox()
		const plan = planLocalIngest([path.join(s.desk, 'loose.mp4'), path.join(s.desk, 'Akt 1')], s.media)
		assert.deepEqual(plan.files.map((f) => f.rel), ['loose.mp4', 'Akt 1/a.mov', 'Akt 1/sub/b.png'])
		assert.equal(plan.skipped, 1, 'the symlink is not followed out of the dropped tree')
		assert.deepEqual(plan.files.map((f) => f.bytes), [1, 2, 3])
	})

	it('refuses relative paths, missing paths, the media folder itself and empty drops', () => {
		const s = sandbox()
		assert.equal(planLocalIngest([], s.media).status, 400)
		assert.match(planLocalIngest(['desk/loose.mp4'], s.media).error, /not an absolute path/)
		assert.match(planLocalIngest([path.join(s.desk, 'nope')], s.media).error, /ENOENT/)
		assert.match(planLocalIngest([path.join(s.media, 'SHOW')], s.media).error, /inside the media folder/)
		assert.match(planLocalIngest([s.root], s.media).error, /contains it/)
		fs.mkdirSync(path.join(s.desk, 'empty'))
		assert.match(planLocalIngest([path.join(s.desk, 'empty')], s.media).error, /no regular files/)
	})

	it('target = the dropped-on folder (media-tree id), never outside the media root', () => {
		const s = sandbox()
		const cfg = { local_media_path: s.media }
		assert.equal(resolveTarget(cfg, 'SHOW', null).dir, path.join(s.media, 'SHOW'))
		assert.equal(resolveTarget(cfg, '', null).dir, path.resolve(s.media))
		assert.equal(resolveTarget(cfg, '../../etc', null).dir, path.join(s.media, 'etc'), 'resolveSafe strips ..')
		fs.mkdirSync(path.join(s.media, 'projects', 'Główne'), { recursive: true })
		const cls = resolveTarget(cfg, 'PROJECTS/GŁÓWNE/new', null)
		assert.equal(cls.folder, 'projects/Główne/new', 'a Caspar CLS (upper-case) folder id maps onto the folder on disk')
	})

	it('copies, replaces a same-name file (web upload parity), unpacks a .zip and leaves no .partial', async () => {
		const s = sandbox()
		fs.writeFileSync(path.join(s.media, 'SHOW', 'loose.mp4'), 'OLD')
		execFileSync('python3', ['-c', `import zipfile; z=zipfile.ZipFile(${JSON.stringify(path.join(s.desk, 'pack.zip'))},'w'); z.writestr('in/zip.mp4','Z'); z.close()`])
		const plan = planLocalIngest([path.join(s.desk, 'loose.mp4'), path.join(s.desk, 'Akt 1'), path.join(s.desk, 'pack.zip')], s.media)
		const seen = []
		const r = await copyPlanned(plan, path.join(s.media, 'SHOW'), { report: (p) => seen.push(p.bytesDone) })
		assert.deepEqual([r.imported, r.unzipped], [4, 1])
		const at = (...p) => fs.readFileSync(path.join(s.media, 'SHOW', ...p), 'utf8')
		assert.equal(at('loose.mp4'), 'L')
		assert.equal(at('Akt 1', 'a.mov'), 'AA')
		assert.equal(at('Akt 1', 'sub', 'b.png'), 'BBB')
		assert.equal(at('in', 'zip.mp4'), 'Z')
		assert.ok(!fs.existsSync(path.join(s.media, 'SHOW', 'pack.zip')), 'the archive is removed after unpacking')
		const all = fs.readdirSync(s.media, { recursive: true })
		assert.ok(!all.some((f) => String(f).endsWith('.partial')))
		assert.ok(!fs.existsSync(path.join(s.media, 'SHOW', 'Akt 1', 'link.txt')))
		assert.ok(seen.length >= 3 && seen.at(-1) > 0)
	})

	it('a cancel stops before the next file', async () => {
		const s = sandbox()
		const plan = planLocalIngest([path.join(s.desk, 'Akt 1')], s.media)
		let n = 0
		await assert.rejects(copyPlanned(plan, s.media, { isCancelled: () => n++ > 0 }), /Cancelled/)
		assert.ok(!fs.existsSync(path.join(s.media, 'Akt 1', 'sub', 'b.png')))
	})
})

describe('WO-603 POST /api/media/ingest-local', () => {
	it('loopback only; 202 + background copy + progress broadcast + rescan; 409 while running', async () => {
		const s = sandbox()
		const casts = []
		let rescans = 0
		const ctx = { config: { local_media_path: s.media }, log: () => {}, _wsBroadcast: (t, d) => casts.push([t, d]), runMediaLibraryQueryCycle: () => rescans++ }
		const body = JSON.stringify({ paths: [path.join(s.desk, 'Akt 1')], folder: 'SHOW' })
		const remote = await routes.handleStart({ socket: { remoteAddress: '192.168.1.20' } }, body, ctx)
		assert.equal(remote.status, 403)
		const res = await routes.handleStart(loopback, body, ctx)
		assert.equal(res.status, 202, res.body)
		assert.deepEqual(JSON.parse(res.body).files, 2)
		const busy = await routes.handleStart(loopback, body, ctx)
		assert.equal(busy.status, 409)
		for (let i = 0; i < 100 && ctx._localIngest.active; i++) await new Promise((r) => setTimeout(r, 10))
		const st = JSON.parse(routes.handleState(ctx).body)
		assert.equal(st.phase, 'complete', st.error)
		assert.equal(st.imported, 2)
		assert.equal(fs.readFileSync(path.join(s.media, 'SHOW', 'Akt 1', 'sub', 'b.png'), 'utf8'), 'BBB')
		assert.equal(rescans, 1)
		assert.ok(casts.every(([t]) => t === 'media:ingest-progress'))
		assert.equal(casts.at(-1)[1].phase, 'complete')
		assert.equal(routes.handleCancel(ctx).status, 409, 'nothing to cancel any more')
		const bad = await routes.handleStart(loopback, JSON.stringify({ paths: ['rel/x'] }), ctx)
		assert.equal(bad.status, 400)
	})

	it('is registered before the /api/media/* catch-all', () => {
		const src = fs.readFileSync(path.join(__dirname, '../../src/api/router.js'), 'utf8')
		const at = src.indexOf("routes.post('/api/media/ingest-local'")
		assert.ok(at > 0 && at < src.indexOf("routes.post('/api/media/*'"))
	})
})
