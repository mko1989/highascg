'use strict'

/**
 * WO-616 attribution / AGPL §5(d) — GET /api/about (src/api/routes-about.js): the Legal Notices payload (name, version
 * from package.json, the COPYRIGHT line, licence, warranty, source), the credits list (OpenFollow's copyright matches
 * THIRD_PARTY_NOTICES), the fixture-root variant, the HTTP handler, and the router wiring (no Caspar needed).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const { aboutInfo, handleGet } = require(path.join(ROOT, 'src', 'api', 'routes-about'))
const pkg = require(path.join(ROOT, 'package.json'))

/** First line of a file (trimmed) that starts with "Copyright". */
function firstCopyrightLine(file) {
	const line = fs
		.readFileSync(path.join(ROOT, file), 'utf8')
		.split('\n')
		.find((l) => /^Copyright/.test(l.trim()))
	return (line || '').trim()
}

/** The line right after the "OpenFollow — <url>" header in THIRD_PARTY_NOTICES, trimmed. */
function openFollowNoticeCopyright() {
	const lines = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES'), 'utf8').split('\n')
	const i = lines.findIndex((l) => /^OpenFollow — https:\/\/github\.com\/openfollowapp\/openfollow/.test(l.trim()))
	assert.ok(i >= 0, 'THIRD_PARTY_NOTICES has the OpenFollow header line')
	return lines[i + 1].trim()
}

function fixtureRoot(files) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo616-about-'))
	for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content)
	return dir
}

describe('WO-616 about payload', () => {
	it('aboutInfo(): the Legal Notices fields come from the repo', () => {
		const a = aboutInfo()
		assert.equal(a.name, 'HighAsCG')
		assert.equal(a.version, pkg.version)
		assert.equal(a.license, 'AGPL-3.0-or-later')
		assert.ok(a.copyright.startsWith('Copyright'))
		assert.equal(a.copyright, firstCopyrightLine('COPYRIGHT'))
		assert.equal(a.source, 'https://github.com/mko1989/highascg')
		assert.ok(a.warranty.includes('ABSOLUTELY NO WARRANTY'))
	})

	it('credits: every entry is complete with an https url, and the expected projects are named', () => {
		const { credits } = aboutInfo()
		assert.ok(Array.isArray(credits))
		for (const c of credits) {
			for (const k of ['name', 'what', 'license', 'copyright', 'url']) {
				assert.equal(typeof c[k], 'string', `${c.name} ${k} is a string`)
				assert.ok(c[k].length > 0, `${c.name} ${k} is non-empty`)
			}
			assert.ok(c.url.startsWith('https://'), `${c.name} url is https`)
		}
		const names = credits.map((c) => c.name)
		for (const n of ['OpenFollow', 'CasparCG Server', 'Godot Engine', 'Rewir']) {
			assert.ok(names.includes(n), `credits name ${n}`)
		}
	})

	it('credits: OpenFollow licence and copyright match THIRD_PARTY_NOTICES', () => {
		const of = aboutInfo().credits.find((c) => c.name === 'OpenFollow')
		assert.ok(of, 'OpenFollow credit present')
		assert.equal(of.license, 'AGPL-3.0-or-later')
		assert.equal(of.copyright, openFollowNoticeCopyright())
	})

	it('aboutInfo(fixtureRoot): version and copyright are read from the given root', () => {
		const dir = fixtureRoot({
			'package.json': JSON.stringify({ version: '9.9.9' }),
			COPYRIGHT: 'Foo\nCopyright (C) 2030 Someone\n',
		})
		try {
			const a = aboutInfo(dir)
			assert.equal(a.version, '9.9.9')
			assert.equal(a.copyright, 'Copyright (C) 2030 Someone')
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('aboutInfo(emptyRoot): missing files give empty version and copyright', () => {
		const dir = fixtureRoot({})
		try {
			const a = aboutInfo(dir)
			assert.equal(a.version, '')
			assert.equal(a.copyright, '')
		} finally {
			fs.rmSync(dir, { recursive: true, force: true })
		}
	})

	it('handleGet(): 200 JSON with the same payload as aboutInfo()', () => {
		const res = handleGet()
		assert.equal(res.status, 200)
		assert.equal(res.headers['Content-Type'], 'application/json')
		assert.deepEqual(JSON.parse(res.body), JSON.parse(JSON.stringify(aboutInfo())))
	})
})

describe('WO-616 about route wiring', () => {
	it('router.js registers GET /api/about without requiring Caspar', () => {
		const src = fs.readFileSync(path.join(ROOT, 'src', 'api', 'router.js'), 'utf8')
		assert.match(
			src,
			/routes\.get\('\/api\/about',\s*\(\)\s*=>\s*routesAbout\.handleGet\(\),\s*\{\s*requireCaspar:\s*false\s*\}\)/
		)
	})
})
