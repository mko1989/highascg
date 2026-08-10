'use strict'

/* WO-471 — every produce must stamp the build, not just the flash wrapper.
 *
 * WO-432 wrote BUILD_STAMP in build-produce-flash-stick.sh. But `npm run eggs:build`
 * (build-highascg-egg.sh) is the main workflow and bypasses that wrapper, so ISOs built that way
 * shipped no BUILD_STAMP. src/system/build-stamp.js then fell through its precedence
 * (BUILD_STAMP -> .highascg-build-stamp -> package.json.version) to a legacy file frozen at
 * 2026.05.20, and a same-day ISO reported that in Settings -> Updates. compareBuildStamps() then
 * weighed the bogus value against real release stamps — the WO-424 failure mode again.
 *
 * The write now lives in the produce script (single writer); the wrapper only exports the stamp so
 * both phases print the same one. */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const EGG = 'tools/eggs/live-usb/build-highascg-egg.sh'
const WRAPPER = 'tools/eggs/live-usb/build-produce-flash-stick.sh'

test('WO-471: the produce script itself writes BUILD_STAMP, before eggs produce', () => {
	const src = read(EGG)
	const lines = src.split('\n')
	const stampAt = lines.findIndex((l) => l.includes('>"${REPO_ROOT}/BUILD_STAMP"'))
	const produceAt = lines.findIndex((l) => l.trimStart().startsWith('eggs produce '))
	assert.ok(stampAt >= 0, `${EGG} must write BUILD_STAMP itself`)
	assert.ok(produceAt >= 0, `${EGG} must invoke eggs produce`)
	assert.ok(
		stampAt < produceAt,
		'BUILD_STAMP must be written BEFORE eggs produce clones the filesystem, or it misses the squashfs',
	)
	/* A caller-supplied stamp wins so wrapper and produce report one identical value. */
	assert.match(src, /HIGHASCG_BUILD_STAMP:-\$\(date -u \+%Y-%m-%d_%H%M%S\)/, 'honours HIGHASCG_BUILD_STAMP')
})

test('WO-471: the flash wrapper defers to the produce script (single writer)', () => {
	const src = read(WRAPPER)
	assert.match(src, /export HIGHASCG_BUILD_STAMP=/, 'wrapper exports the stamp for the produce script')
	assert.ok(
		!src.includes('>"${REPO_ROOT}/BUILD_STAMP"'),
		'wrapper must NOT write BUILD_STAMP itself — two writers can disagree on the timestamp',
	)
})

test('WO-471: BUILD_STAMP is not excluded from the squashfs', () => {
	for (const rel of [
		'tools/eggs/live-usb/penguins-eggs-exclude-highascg-embed-server.list',
		'tools/eggs/live-usb/penguins-eggs-exclude-highascg-fragment.list',
	]) {
		for (const line of read(rel).split('\n')) {
			const t = line.trim()
			if (!t || t.startsWith('#')) continue
			assert.ok(
				!/BUILD_STAMP\s*$/.test(t),
				`${rel} excludes BUILD_STAMP — the ISO would ship unstamped again`,
			)
		}
	}
})

test('WO-471: a produce stamp outranks the frozen legacy value at runtime', () => {
	const { readBuildStampFromDir, compareBuildStamps } = require('../../src/system/build-stamp')
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hacg-stamp-'))
	try {
		fs.writeFileSync(path.join(dir, '.highascg-build-stamp'), '2026.05.20\n')
		fs.writeFileSync(path.join(dir, 'package.json'), '{"version":"2026.05.20"}')
		assert.equal(readBuildStampFromDir(dir), '2026.05.20', 'unstamped clone reports the legacy value')

		fs.writeFileSync(path.join(dir, 'BUILD_STAMP'), '2026-08-10_154500\n')
		assert.equal(readBuildStampFromDir(dir), '2026-08-10_154500', 'BUILD_STAMP outranks the legacy file')
		/* WO-424: `-` < `.` in raw ASCII, so this ordering only holds because compareBuildStamps
		 * normalises separators. Without it the update check calls a newer ISO "up to date". */
		assert.ok(compareBuildStamps('2026-08-10_154500', '2026.05.20') > 0, 'produce stamp sorts newer')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})
