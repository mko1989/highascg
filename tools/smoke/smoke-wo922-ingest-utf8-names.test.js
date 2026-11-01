'use strict'

/**
 * WO-922 — Polish file names survive every media import path. URL downloads saved the percent-encoded path segment
 * ("Url%20Micha%C5%82.png"); uploads and zips (with or without the UTF-8 flag) are pinned as already correct.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const { urlFileName } = require('../../src/api/routes-ingest')
const { extractZipSafely } = require('../../src/utils/safe-unzip')

test('a URL download is saved under the decoded, NFC name', () => {
	assert.equal(urlFileName('http://h/media/Url%20Micha%C5%82.png'), 'Url Michał.png')
	assert.equal(urlFileName('http://h/a/Z%CC%87o%CC%81%C5%82w.mp4'), 'Żółw.mp4', 'macOS NFD folds to NFC')
	assert.equal(urlFileName('http://h/x/..%2F..%2Fetc%2Fpasswd'), 'passwd', 'an encoded slash cannot climb out')
	assert.equal(urlFileName('http://h/x/bad%E0%A4%A.png'), 'bad%E0%A4%A.png', 'a broken escape keeps the raw segment')
	assert.equal(urlFileName('http://h/'), 'downloaded_asset')
})

test('multipart uploads decode the file name as UTF-8 (busboy defParamCharset)', () => {
	const src = (f) => fs.readFileSync(path.join(__dirname, '../../src', f), 'utf8')
	for (const f of ['api/routes-ingest.js', 'api/routes-media-versions.js']) assert.match(src(f), /busboy\(\{[^}]*defParamCharset: 'utf8'/s, f)
})

/** A one-entry stored zip; `utf8Flag` false is how macOS Archive Utility writes UTF-8 names. */
function zipOf(name, data, utf8Flag) {
	const n = Buffer.from(name, 'utf8')
	const flags = utf8Flag ? 0x800 : 0
	const crc = zlib.crc32(data)
	const local = Buffer.alloc(30)
	local.writeUInt32LE(0x04034b50, 0)
	local.writeUInt16LE(20, 4)
	local.writeUInt16LE(flags, 6)
	local.writeUInt32LE(crc, 14)
	local.writeUInt32LE(data.length, 18)
	local.writeUInt32LE(data.length, 22)
	local.writeUInt16LE(n.length, 26)
	const central = Buffer.alloc(46)
	central.writeUInt32LE(0x02014b50, 0)
	central.writeUInt16LE(20, 4)
	central.writeUInt16LE(20, 6)
	central.writeUInt16LE(flags, 8)
	central.writeUInt32LE(crc, 16)
	central.writeUInt32LE(data.length, 20)
	central.writeUInt32LE(data.length, 24)
	central.writeUInt16LE(n.length, 28)
	const cdOffset = local.length + n.length + data.length
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(1, 8)
	end.writeUInt16LE(1, 10)
	end.writeUInt32LE(central.length + n.length, 12)
	end.writeUInt32LE(cdOffset, 16)
	return Buffer.concat([local, n, data, central, n, end])
}

test('zip entries keep their Polish names, with and without the UTF-8 flag', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo922-'))
	try {
		for (const [flag, name] of [
			[true, 'Zip Flag Michał.png'],
			[false, 'Zip Mac Michał Żółć.png'],
		]) {
			const zip = path.join(dir, `${flag}.zip`)
			fs.writeFileSync(zip, zipOf(name, Buffer.from('x'), flag))
			await extractZipSafely(zip, dir)
			assert.ok(fs.existsSync(path.join(dir, name)), `${name} (flag ${flag}): got ${fs.readdirSync(dir).join(', ')}`)
		}
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})
