'use strict'

/**
 * WO-830a items 4–5 — stream errors must reject a promise, never surface as an uncaught 'error' event
 * (process-guards turns that into process.exit(1)).
 *   4. a corrupt zip entry in an upload (safe-unzip.js: `.pipe()` forwarded no errors)
 *   5. the ingest HTTP download onto a full disk (routes-ingest.js: listener attached after the loop)
 * The checks run in a CHILD node process with an 'uncaughtException' recorder so that the pre-fix code shows up as a
 * crash instead of killing the test runner. HIGHASCG_WO830A_ROOT points at another checkout.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')
const { spawnSync } = require('child_process')

const ROOT = process.env.HIGHASCG_WO830A_ROOT || path.join(__dirname, '..', '..')

/** A one-entry zip whose deflate payload is garbage (central directory is valid, so Open.file lists the entry). */
function corruptZip() {
	const name = Buffer.from('a.txt')
	const data = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
	const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
	const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
	const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(data.length), u32(100), u16(name.length), u16(0), name, data])
	const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(0), u32(data.length), u32(100),
		u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name])
	const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length), u16(0)])
	return Buffer.concat([local, central, end])
}

const CHILD = `
const fs = require('fs')
const path = require('path')
const http = require('http')
const root = process.env.ROOT
const crashes = []
process.on('uncaughtException', (e) => crashes.push(String(e && e.code || e && e.message)))
const { extractZipSafely } = require(path.join(root, 'src/utils/safe-unzip'))
const ingest = require(path.join(root, 'src/api/routes-ingest'))
const out = { crashes }
// pre-fix, the pipe swallowed the error and the promise never settled: the loop drains and the child exits early
process.on('beforeExit', () => { out.hung = true; out.zip = out.zip || 'hung'; out.disk = out.disk || 'hung'; console.log('RESULT ' + JSON.stringify(out)) })
async function main() {
	try { await extractZipSafely(process.env.ZIP, process.env.OUTDIR); out.zip = 'resolved' } catch (e) { out.zip = 'rejected' }
	await new Promise((r) => setTimeout(r, 300))
	out.crashesAfterZip = crashes.length
	// full disk: /dev/full accepts open() and fails every write with ENOSPC
	const srv = http.createServer((q, s) => { s.writeHead(200, { 'content-length': String(8 * 1024 * 1024) }); s.write(Buffer.alloc(4 * 1024 * 1024)); setTimeout(() => s.end(Buffer.alloc(4 * 1024 * 1024)), 100) })
	await new Promise((r) => srv.listen(0, '127.0.0.1', r))
	const res = await fetch('http://127.0.0.1:' + srv.address().port + '/x')
	const fn = ingest.writeBodyToFile
	if (typeof fn !== 'function') { out.disk = 'no-helper' }
	else {
		try { await fn(res.body, '/dev/full', () => {}); out.disk = 'resolved' } catch (e) { out.disk = 'rejected:' + e.code }
	}
	await new Promise((r) => setTimeout(r, 300))
	out.crashesAfterDisk = crashes.length
	console.log('RESULT ' + JSON.stringify(out))
	process.exit(0)
}
main()
`

describe('WO-830a stream errors reject instead of crashing node', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo830a-streams-'))
	const zipPath = path.join(tmp, 'bad.zip')
	fs.writeFileSync(zipPath, corruptZip())
	const r = spawnSync(process.execPath, ['-e', CHILD], {
		env: { ...process.env, ROOT, ZIP: zipPath, OUTDIR: path.join(tmp, 'out') },
		encoding: 'utf8',
		timeout: 30000,
	})
	const line = String(r.stdout).split('\n').find((l) => l.startsWith('RESULT '))
	const res = line ? JSON.parse(line.slice(7)) : null
	fs.rmSync(tmp, { recursive: true, force: true })

	it('the child ran to completion', () => {
		assert.ok(res, `no RESULT; status=${r.status} stderr=${String(r.stderr).slice(0, 400)}`)
	})
	it('safe-unzip: a corrupt entry rejects extractZipSafely with no uncaught exception', () => {
		assert.equal(res.zip, 'rejected')
		assert.equal(res.crashesAfterZip, 0)
	})
	it('ingest download: ENOSPC on the write stream rejects with no uncaught exception', () => {
		assert.match(res.disk, /^rejected:ENOSPC$/)
		assert.equal(res.crashesAfterDisk, 0)
	})
	it('handleDownload streams through writeBodyToFile (no hand-rolled write loop)', () => {
		const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src/api/routes-ingest.js'), 'utf8')
		assert.match(src, /await writeBodyToFile\(response\.body, savePath,/)
		assert.doesNotMatch(src, /fileStream\.write\(buf\)/)
	})
})

describe('WO-830a safe-unzip still extracts a valid archive', () => {
	it('round-trips one file', async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wo830a-zip-ok-'))
		try {
			const content = Buffer.from('hello wo830a')
			const name = Buffer.from('dir/ok.txt')
			const comp = zlib.deflateRawSync(content)
			if (!zlib.crc32) return // node < 22.2 has no zlib.crc32: skip (the corrupt-entry test above is the guard)
			const crc = zlib.crc32(content)
			const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
			const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }
			const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(comp.length), u32(content.length), u16(name.length), u16(0), name, comp])
			const central = Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(0), u32(crc), u32(comp.length), u32(content.length),
				u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(0), name])
			const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(1), u16(1), u32(central.length), u32(local.length), u16(0)])
			const zp = path.join(tmp, 'ok.zip')
			fs.writeFileSync(zp, Buffer.concat([local, central, end]))
			const { extractZipSafely } = require(path.join(ROOT, 'src/utils/safe-unzip'))
			const n = await extractZipSafely(zp, path.join(tmp, 'out'))
			assert.equal(n, 1)
			assert.equal(fs.readFileSync(path.join(tmp, 'out/dir/ok.txt'), 'utf8'), 'hello wo830a')
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true })
		}
	})
})
