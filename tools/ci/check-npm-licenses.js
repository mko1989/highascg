#!/usr/bin/env node
'use strict'

/**
 * WO-1096 — npm licence gate for the PRODUCTION dependency tree (what ships in the ISO's node_modules and in the
 * server release tarball).
 *
 * WO-1095 found `wetransfert` ("license": "none", no LICENSE file upstream) shipped in every ISO: nothing looked at
 * dependency licences. This gate reads package-lock.json (every `packages` entry that is not `dev`, so optional and
 * devOptional ones count: `npm ci` installs them and the tarball ships them) and FAILS on a package whose licence is
 *   - missing, "none", "UNLICENSED" or "SEE LICENSE IN <file>" (unless a reviewed override below names the file), or
 *   - an SPDX expression that cannot be satisfied from the allowlist (OR: one side allowed; AND: every side allowed).
 * Copyleft licences that are compatible with shipping under AGPL-3.0-or-later are allowed but reported as
 * "notice required": each one must be named in THIRD_PARTY_NOTICES.
 *
 * The lockfile's `license` field is used first. When it is absent, the installed package.json (`license`, or the
 * legacy `licenses` array, read as OR) is the fallback; then the reviewed OVERRIDES table (pinned to name@version so
 * an upgrade forces a fresh review).
 *
 * Usage: node tools/ci/check-npm-licenses.js [--lock <package-lock.json>] [--modules <node_modules dir>] [--list]
 * Exit 0 = every production package is allowed; 1 = at least one is not; 2 = the lockfile could not be read.
 */

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '../..')

/** Permissive SPDX ids: attribution travels with the package's own LICENSE file in node_modules. */
const PERMISSIVE = new Set([
	'MIT',
	'ISC',
	'BSD-2-Clause',
	'BSD-3-Clause',
	'Apache-2.0',
	'0BSD',
	'CC0-1.0',
	'BlueOak-1.0.0',
	'Unlicense',
	'Zlib',
	'Python-2.0',
])

/**
 * Copyleft ids that may ship with an AGPL-3.0-or-later program, but must be named in THIRD_PARTY_NOTICES.
 * GPL-2.0-only (and the deprecated bare "GPL-2.0") is deliberately absent: it is not compatible with AGPLv3.
 */
const NOTICE_REQUIRED = new Set([
	'LGPL-2.1-only',
	'LGPL-2.1-or-later',
	'LGPL-3.0-only',
	'LGPL-3.0-or-later',
	'MPL-2.0',
	'GPL-2.0-or-later',
	'GPL-3.0-only',
	'GPL-3.0-or-later',
	'AGPL-3.0-only',
	'AGPL-3.0-or-later',
])

/**
 * Reviewed packages whose metadata carries no usable licence. Key = name@version; `file` is the licence file that was
 * read (it must exist when node_modules is available).
 */
const OVERRIDES = {
	'jspack@0.0.4': {
		license: 'BSD-3-Clause',
		file: 'LICENSE',
		note: 'package.json has no licence field; LICENSE is the 3-clause BSD text (c) 2008 Fair Oaks Labs, Inc.',
	},
}

/**
 * Tokenise and evaluate an SPDX expression. Returns the licence ids one would elect to satisfy it (preferring
 * permissive ones), or null when nothing in the allowlist satisfies it.
 * @param {string} expr
 * @returns {{ ok: boolean, elected: string[], notice: string[], reason: string }}
 */
function evaluateSpdx(expr) {
	const tokens = String(expr).replace(/\(/g, ' ( ').replace(/\)/g, ' ) ').trim().split(/\s+/).filter(Boolean)
	let pos = 0
	/** @returns {string[][]|null} alternatives, each a list of ids that must all hold */
	const parseOr = () => {
		let alts = parseAnd()
		while (tokens[pos] && tokens[pos].toUpperCase() === 'OR') {
			pos++
			const right = parseAnd()
			alts = alts && right ? alts.concat(right) : alts || right
		}
		return alts
	}
	const parseAnd = () => {
		let alts = parseAtom()
		while (tokens[pos] && tokens[pos].toUpperCase() === 'AND') {
			pos++
			const right = parseAtom()
			if (!alts || !right) alts = null
			else alts = alts.flatMap((a) => right.map((b) => a.concat(b)))
		}
		return alts
	}
	const parseAtom = () => {
		const t = tokens[pos++]
		if (t === undefined) throw new Error('unexpected end')
		if (t === '(') {
			const inner = parseOr()
			if (tokens[pos++] !== ')') throw new Error('missing )')
			return inner
		}
		if (t === ')' || /^(AND|OR|WITH)$/i.test(t)) throw new Error(`unexpected "${t}"`)
		// `X WITH exception`: an exception only ever adds permissions, so the base licence decides
		if (tokens[pos] && tokens[pos].toUpperCase() === 'WITH') pos += 2
		const id = t.replace(/\+$/, '-or-later')
		return PERMISSIVE.has(id) || NOTICE_REQUIRED.has(id) ? [[id]] : null
	}
	let alts
	try {
		alts = parseOr()
		if (pos !== tokens.length) throw new Error(`trailing "${tokens[pos]}"`)
	} catch (e) {
		return { ok: false, elected: [], notice: [], reason: `unparseable SPDX expression "${expr}" (${e.message})` }
	}
	if (!alts || alts.length === 0)
		return { ok: false, elected: [], notice: [], reason: `"${expr}" is not on the allowlist` }
	const score = (ids) => ids.filter((id) => NOTICE_REQUIRED.has(id)).length
	const best = alts.slice().sort((a, b) => score(a) - score(b))[0]
	return { ok: true, elected: best, notice: best.filter((id) => NOTICE_REQUIRED.has(id)), reason: '' }
}

/**
 * Normalise a package.json licence field (string, `{ type }`, or legacy `licenses: [{ type }]`) to one SPDX string.
 * @param {any} pkg
 * @returns {string|undefined}
 */
function licenseFromPackageJson(pkg) {
	if (!pkg) return undefined
	const one = (l) => (typeof l === 'string' ? l : l && typeof l.type === 'string' ? l.type : undefined)
	const direct = one(pkg.license)
	if (direct) return direct
	if (Array.isArray(pkg.licenses)) {
		const ids = pkg.licenses.map(one).filter(Boolean)
		if (ids.length) return ids.length === 1 ? ids[0] : `(${ids.join(' OR ')})`
	}
	return undefined
}

/**
 * Pure core: classify every production package of a lockfile (v2/v3 `packages` map).
 * @param {object} lock parsed package-lock.json
 * @param {{ readPackageJson?: (lockPath: string) => any, fileExists?: (lockPath: string, file: string) => boolean,
 *   overrides?: object }} [io] injected node_modules readers (omit them to judge the lockfile alone)
 * @returns {{ rows: Array<{ path: string, name: string, version: string, license: string, source: string,
 *   ok: boolean, notice: string[], optional: boolean, reason: string }>, failures: number }}
 */
function checkLockLicenses(lock, io = {}) {
	const overrides = io.overrides || OVERRIDES
	const packages = (lock && lock.packages) || {}
	const rows = []
	for (const [lockPath, entry] of Object.entries(packages)) {
		if (!lockPath || !entry || entry.dev || entry.link) continue
		const name = entry.name || lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length)
		const version = String(entry.version || '')
		const key = `${name}@${version}`
		let license = typeof entry.license === 'string' ? entry.license.trim() : undefined
		let source = 'lockfile'
		if (!license && io.readPackageJson) {
			license = licenseFromPackageJson(io.readPackageJson(lockPath))
			source = 'package.json'
		}
		const row = { path: lockPath, name, version, license: license || '', source, ok: false, notice: [], reason: '' }
		row.optional = !!(entry.optional || entry.devOptional)
		const unusable = !license || /^(none|unlicensed)$/i.test(license) || /^see licen[cs]e in /i.test(license)
		if (unusable && overrides[key]) {
			const o = overrides[key]
			if (io.fileExists && !io.fileExists(lockPath, o.file)) {
				row.reason = `override for ${key} names ${o.file}, which is not in the package`
				rows.push(row)
				continue
			}
			license = o.license
			row.license = license
			row.source = `override (${o.file})`
		} else if (unusable) {
			row.reason = license ? `licence "${license}" is not a redistributable licence` : 'no licence declared'
			rows.push(row)
			continue
		}
		const verdict = evaluateSpdx(license)
		row.ok = verdict.ok
		row.notice = verdict.notice
		row.reason = verdict.reason
		rows.push(row)
	}
	return { rows, failures: rows.filter((r) => !r.ok).length }
}

/**
 * @param {ReturnType<typeof checkLockLicenses>['rows']} rows
 * @returns {Array<[string, number]>} licence string -> count, most common first
 */
function licenseCounts(rows) {
	const counts = new Map()
	for (const r of rows) counts.set(r.license || '(missing)', (counts.get(r.license || '(missing)') || 0) + 1)
	return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

function main(argv) {
	const arg = (flag, dflt) => {
		const i = argv.indexOf(flag)
		return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : dflt
	}
	const lockFile = arg('--lock', path.join(REPO_ROOT, 'package-lock.json'))
	const modulesRoot = arg('--modules', path.dirname(lockFile))
	let lock
	try {
		lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'))
	} catch (e) {
		console.error(`[check-npm-licenses] cannot read ${lockFile}: ${e.message}`)
		return 2
	}
	const io = {
		readPackageJson: (p) => {
			try {
				return JSON.parse(fs.readFileSync(path.join(modulesRoot, p, 'package.json'), 'utf8'))
			} catch {
				return null
			}
		},
		fileExists: (p, file) => fs.existsSync(path.join(modulesRoot, p, file)),
	}
	const { rows, failures } = checkLockLicenses(lock, io)
	if (argv.includes('--list')) {
		for (const [lic, n] of licenseCounts(rows)) console.log(`${String(n).padStart(4)}  ${lic}`)
	}
	for (const r of rows.filter((x) => x.ok && x.notice.length)) {
		console.log(
			`[check-npm-licenses] notice required: ${r.name}@${r.version} (${r.license}) — name it in THIRD_PARTY_NOTICES`
		)
	}
	for (const r of rows.filter((x) => !x.ok)) {
		console.error(`[check-npm-licenses] NOT ALLOWED: ${r.name}@${r.version} (${r.path}): ${r.reason}`)
	}
	if (failures) {
		console.error(`[check-npm-licenses] FAILED: ${failures} of ${rows.length} production packages`)
		return 1
	}
	console.log(`[check-npm-licenses] OK: ${rows.length} production packages, all on the allowlist`)
	return 0
}

if (require.main === module) process.exit(main(process.argv.slice(2)))

module.exports = { checkLockLicenses, evaluateSpdx, licenseFromPackageJson, licenseCounts }
