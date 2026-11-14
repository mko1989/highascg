'use strict'

/**
 * WO-1076 — `module.json`, the manifest of an external module, and the core-version check.
 *
 *   {
 *     "name": "rc-game",                 required; [a-z0-9][a-z0-9_-]{0,62}[a-z0-9]; equals the directory name
 *     "version": "1.0.0",                required; [0-9A-Za-z.+_-]{1,64}
 *     "title": "RC car game",            optional (default: name), ≤ 80 chars
 *     "description": "…",                optional, ≤ 500 chars
 *     "main": "register.js",             optional; a relative .js path inside the module dir
 *     "requiresCore": ">=2026.11.01",    optional; see satisfiesCore()
 *     "defaultEnabled": false            optional; enabled when modules.json has no entry (default false: opt-in)
 *   }
 *
 * Versions compare as dotted numbers: every digit run is one component, so the core's `2026.05.20` (package.json) and
 * `2026-11-11_114936` (release BUILD_STAMP) compare the same way as `1.2.3`.
 */

const fs = require('fs')
const path = require('path')
const { REPO_ROOT } = require('../repo-paths')
const { readBuildStampFromDir } = require('../system/build-stamp')

const NAME_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/
const VERSION_RE = /^[0-9A-Za-z.+_-]{1,64}$/
const MAX_MANIFEST_BYTES = 64 * 1024

const isValidModuleName = (n) => typeof n === 'string' && NAME_RE.test(n)

/** @param {string} main */
function isSafeMain(main) {
	if (typeof main !== 'string' || !main || main.length > 200 || !main.endsWith('.js')) return false
	if (path.isAbsolute(main) || main.includes('\\') || main.includes('\0')) return false
	return main.split('/').every((s) => s && s !== '.' && s !== '..')
}

/**
 * @param {unknown} raw parsed module.json
 * @returns {{ ok: true, manifest: object } | { ok: false, error: string }}
 */
function validateManifest(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'module.json must be an object' }
	const m = /** @type {Record<string, unknown>} */ (raw)
	if (!isValidModuleName(m.name)) return { ok: false, error: 'module.json name is missing or invalid' }
	if (typeof m.version !== 'string' || !VERSION_RE.test(m.version)) return { ok: false, error: 'module.json version is missing or invalid' }
	const main = m.main === undefined ? 'register.js' : m.main
	if (!isSafeMain(main)) return { ok: false, error: 'module.json main must be a relative .js path inside the module' }
	if (m.title !== undefined && (typeof m.title !== 'string' || m.title.length > 80)) return { ok: false, error: 'module.json title must be a string ≤ 80 chars' }
	if (m.description !== undefined && (typeof m.description !== 'string' || m.description.length > 500)) {
		return { ok: false, error: 'module.json description must be a string ≤ 500 chars' }
	}
	if (m.requiresCore !== undefined && (typeof m.requiresCore !== 'string' || !parseRange(m.requiresCore))) {
		return { ok: false, error: 'module.json requiresCore is not a version range (e.g. ">=2026.11.01")' }
	}
	if (m.defaultEnabled !== undefined && typeof m.defaultEnabled !== 'boolean') return { ok: false, error: 'module.json defaultEnabled must be a boolean' }
	return {
		ok: true,
		manifest: {
			name: m.name,
			version: m.version,
			title: typeof m.title === 'string' && m.title.trim() ? m.title.trim() : m.name,
			description: typeof m.description === 'string' ? m.description : '',
			main,
			requiresCore: typeof m.requiresCore === 'string' ? m.requiresCore.trim() : '',
			defaultEnabled: m.defaultEnabled === true,
		},
	}
}

/**
 * Read and validate `<dir>/module.json`. Never throws.
 * @param {string} dir
 */
function readManifest(dir) {
	const file = path.join(dir, 'module.json')
	try {
		const st = fs.lstatSync(file)
		if (!st.isFile()) return { ok: false, error: 'module.json is not a regular file' }
		if (st.size > MAX_MANIFEST_BYTES) return { ok: false, error: 'module.json is too large' }
		return validateManifest(JSON.parse(fs.readFileSync(file, 'utf8')))
	} catch (e) {
		return { ok: false, error: e && e.code === 'ENOENT' ? 'module.json missing' : `module.json unreadable: ${e?.message || e}` }
	}
}

/** @param {string} v → numeric components ('' → []) */
const versionParts = (v) => (String(v || '').match(/\d+/g) || []).map((x) => parseInt(x, 10))

/** @returns {number} <0, 0, >0 */
function compareVersions(a, b) {
	const pa = versionParts(a)
	const pb = versionParts(b)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] || 0) - (pb[i] || 0)
		if (d) return d < 0 ? -1 : 1
	}
	return 0
}

/**
 * A range is one or more space-separated comparators, all of which must hold: `>=2026.11.01 <2027`. A bare version
 * means `>=` (a minimum). `*` or empty = any core.
 * @param {string} range
 * @returns {Array<[string, string]> | null}
 */
function parseRange(range) {
	const s = String(range || '').trim()
	if (!s || s === '*') return []
	const out = []
	for (const tok of s.split(/\s+/)) {
		const m = /^(>=|<=|>|<|=)?(\d+(?:[._-]\d+)*)$/.exec(tok)
		if (!m) return null
		out.push([m[1] || '>=', m[2]])
	}
	return out
}

/**
 * @param {string} range manifest.requiresCore
 * @param {string|null} coreVersion
 * @returns {boolean} true when compatible (an unknown core version never blocks)
 */
function satisfiesCore(range, coreVersion) {
	const cmp = parseRange(range)
	if (!cmp) return false
	if (!coreVersion || !versionParts(coreVersion).length) return true
	return cmp.every(([op, v]) => {
		const c = compareVersions(coreVersion, v)
		return op === '>=' ? c >= 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : op === '<' ? c < 0 : c === 0
	})
}

/** The running core's version: BUILD_STAMP (release) or package.json. */
function coreVersion() {
	return readBuildStampFromDir(REPO_ROOT)
}

module.exports = { isValidModuleName, validateManifest, readManifest, compareVersions, satisfiesCore, coreVersion }
