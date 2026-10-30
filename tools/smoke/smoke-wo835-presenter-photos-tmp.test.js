'use strict'

/**
 * WO-835 — presenter photos (and everything derived from them) live in /tmp only. The intake consent text promises
 * "deleted when the server restarts or the box reboots", so: files are written under the tmp root; a fresh process
 * does not resurrect photos or roster from disk (it wipes leftovers); a dir outside a tmp root is refused; the served
 * photo comes from the tmp dir; shutdown deletes; the page text says what the code does.
 */

const { describe, it, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createPresenters, underTmp, DEFAULT_DIR } = require('../../src/tracking/presenters')
const { handlePresenters } = require('../../src/tracking/presenter-routes')

const ROOT = path.join(__dirname, '..', '..')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])
const dirs = []
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))
const embed = async () => ({ ok: true, feature: new Array(128).fill(0).map((_, i) => (i ? 0 : 1)), body: { ok: true, feature: new Array(768).fill(0).map((_, i) => (i ? 0 : 1)) } })
const tmpDir = () => {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wo835-'))
	dirs.push(d)
	return d
}
const settle = () => new Promise((r) => setImmediate(r))
const inTmp = (p) => path.resolve(p).startsWith(path.resolve(os.tmpdir()) + path.sep)

describe('WO-835 presenter photos: /tmp only', () => {
	it('the default dir and every file written are under the tmp root', async () => {
		assert.ok(inTmp(DEFAULT_DIR), 'default dir is os.tmpdir()-based: ' + DEFAULT_DIR)
		const dir = tmpDir()
		const p = createPresenters(null, { dir, embed })
		await p.create({ consent: true, name: 'Anna', mic: '4', photo: JPEG.toString('base64') })
		await settle()
		const files = fs.readdirSync(dir)
		assert.deepEqual(files.sort(), ['p1.jpg', 'roster.json'])
		for (const f of files) assert.ok(inTmp(path.join(dir, f)), f + ' is under tmp')
		assert.equal(p.dir, dir)
		assert.ok(inTmp(p.dir))
	})

	it('a fresh process does not resurrect photos, roster or features from a previous run', async () => {
		const dir = tmpDir()
		const a = createPresenters(null, { dir, embed })
		await a.create({ consent: true, name: 'Anna', photo: JPEG.toString('base64') })
		await settle()
		assert.equal(a.wantsFaces(), true)
		fs.writeFileSync(path.join(dir, 'roster.json.tmp'), '{}')
		fs.writeFileSync(path.join(dir, 'keep-me.txt'), 'not ours')
		const b = createPresenters(null, { dir, embed }) // "boot"
		assert.deepEqual(b.list(), [])
		assert.equal(b.wantsFaces(), false)
		assert.equal(b.wantsBodies(), false)
		assert.equal(b.photo('p1'), null, 'no photo is served for the old id')
		assert.deepEqual(fs.readdirSync(dir), ['keep-me.txt'], 'only presenter files were wiped')
	})

	it('a persistent dir (repo, home, config) is refused: files go to the default tmp dir instead', async () => {
		// the home dir, not the repo: a checkout can itself sit under /tmp (clean-tree CI copies), where the repo IS tmp
		const persistent = path.join(os.homedir(), '.highascg', '_wo835-should-never-exist')
		assert.equal(underTmp(persistent), false)
		assert.equal(underTmp(path.join(os.homedir(), '.highascg', 'presenters')), false)
		assert.equal(underTmp(os.tmpdir()), false, 'the tmp root itself is not a presenter dir')
		assert.equal(underTmp(path.join(os.tmpdir(), '..', 'etc')), false, '.. escapes are resolved')
		const logs = []
		const p = createPresenters({ log: (l, m) => logs.push(m) }, { dir: persistent, embed })
		assert.equal(p.dir, DEFAULT_DIR)
		assert.ok(logs.some((m) => /not under a tmp dir/.test(m)))
		assert.equal(fs.existsSync(persistent), false, 'nothing was created in the persistent location')
		p.dispose()
	})

	it('the photo route serves from the tmp dir; shutdown deletes everything', async () => {
		const dir = tmpDir()
		const p = createPresenters(null, { dir, embed })
		await p.create({ consent: true, name: 'Anna', photo: JPEG.toString('base64') })
		await settle()
		const r = await handlePresenters(p, { method: 'GET', path: '/api/tracking/presenters/p1/photo' })
		assert.equal(r.status, 200)
		assert.deepEqual(r.body, fs.readFileSync(path.join(p.dir, 'p1.jpg')))
		assert.ok(inTmp(p.dir), 'the served bytes come from under tmp')
		p.dispose()
		assert.deepEqual(fs.readdirSync(dir), [], 'dispose left no presenter file')
		assert.deepEqual(p.list(), [])
	})

	it('wiring and wording: boot does not load, shutdown disposes, the consent text matches', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src/tracking/presenters.js'), 'utf8')
		assert.doesNotMatch(src, /function load\(/, 'no roster loader any more')
		assert.doesNotMatch(src, /readFileSync\(path\.join\(dir, 'roster\.json'\)/)
		assert.match(fs.readFileSync(path.join(ROOT, 'src/tracking/register.js'), 'utf8'), /_presenters\.dispose\(\)/)
		const page = fs.readFileSync(path.join(ROOT, 'src/tracking/presenter-intake.html'), 'utf8')
		assert.match(page, /deleted when the server restarts or the box reboots/)
		const gd = fs.readFileSync(path.join(ROOT, 'godot/client/features/previs/tracking/presenters_section.gd'), 'utf8')
		assert.doesNotMatch(gd, /user:\/\/[a-z]/, 'the Godot photo cache is memory only (no user:// file)')
	})
})
