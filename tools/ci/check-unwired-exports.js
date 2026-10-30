#!/usr/bin/env node
/**
 * WO-367 — fail on exports that NOTHING anywhere references.
 *
 * The failure class this exists for: code that is fully written, reviewed, and marked DONE, but
 * never wired to a caller. Three shipped on 28.07.26 alone (`6e53abe` WO-360's missing-media
 * marks, `9d2f6dd` a duplicate WO-342 handler, `185d200` INFO CONFIG refresh) — all invisible to
 * the offline suite, the 500-line gate and the boot check.
 *
 * eslint's `no-unused-vars` (capped in `npm run lint`, the other half of WO-367) covers
 * import-but-never-call and module-local dead code. It cannot answer the module-graph question:
 * "does anything import this export?" That is this script.
 *
 * DELIBERATELY CONSERVATIVE: a name counts as referenced if it appears ANYWHERE outside the file
 * that exports it — a static import, a re-export, a namespace member access (`Actions.addCable`),
 * a dynamic `import()` result, or even a smoke test's source-text assertion. So this never argues
 * about resolution; it only catches the total orphan, which is exactly the observed failure. A
 * name shared by two modules therefore covers both — accepted: false negatives are fine, false
 * positives would make the gate a nuisance and get it switched off.
 *
 * A RATCHET, not a cleanup order. The first run found 701 orphan exports — real (spot-checked:
 * `syncFaderUIFromGain`, `resolveV4l2Device`, `VIRTUAL_CAMERA_DEFAULTS` are each referenced only
 * inside their own file), but far too many to fix in the change that introduces the gate. They
 * are recorded in `unwired-exports-baseline.json`; only a NEW orphan fails. Entries that become
 * wired (or get deleted) are reported so the baseline can shrink — `--update` rewrites it. The
 * baseline is allowed to go down, never up: adding to it by hand is how this gate would rot.
 *
 * Usage: node tools/ci/check-unwired-exports.js [--list] [--update]
 * Exit 1 when an orphan export appears that is not already in the baseline.
 */

'use strict'

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.join(__dirname, '../..')

/** Where exports are GATED (an orphan here fails the build). */
const EXPORT_ROOTS = ['client/components', 'client/lib', 'src']
/** Where references are LOOKED FOR (everything that can reasonably call into the above). */
// WO-836: + test/ (its unit tests are real consumers) and the root index.js (the boot entry that requires src/)
const REFERENCE_ROOTS = ['client', 'src', 'tools', 'template', 'scripts', 'test', 'index.js']

const SKIP_DIR = /(^|\/)(node_modules|dist|dist-web|vendor|assets|fonts|\.git|coverage)(\/|$)/
const CODE_EXT = /\.(js|cjs|mjs|jsx|ts|html)$/

const BASELINE_FILE = path.join(__dirname, 'unwired-exports-baseline.json')

function walk(dir, out = []) {
	let entries
	try {
		// a root may be a single file (index.js)
		if (fs.statSync(dir).isFile()) return CODE_EXT.test(dir) ? [...out, dir] : out
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return out
	}
	for (const e of entries) {
		const full = path.join(dir, e.name)
		const rel = path.relative(REPO_ROOT, full)
		if (SKIP_DIR.test(rel)) continue
		if (e.isDirectory()) walk(full, out)
		else if (CODE_EXT.test(e.name)) out.push(full)
	}
	return out
}

/** Named exports declared in a source file. `export default` is out of scope (it has no name). */
function exportedNames(src) {
	const names = new Set()
	const decl = /export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g
	for (const m of src.matchAll(decl)) names.add(m[1])
	// export { a, b as c }  /  export { a } from './x'
	for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
		for (const part of m[1].split(',')) {
			const as = /\s*([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)\s*/.exec(part)
			const plain = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(part)
			if (as) names.add(as[2])
			else if (plain) names.add(plain[1])
		}
	}
	// CommonJS: module.exports = { a, b } (one line or many) / exports.a =
	for (const name of cjsObjectExportNames(src)) names.add(name)
	for (const m of src.matchAll(/exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1])
	names.delete('default')
	return names
}

/**
 * WO-836: names in every `module.exports = { ... }` literal. The old regex needed a newline before the closing brace, so a
 * single-line `module.exports = { a, b }` yielded no names at all (413 src files were never gated) and, worse, a multi-line
 * literal containing a nested `}` was cut at the first one. This walks the braces (strings, comments and nested
 * brackets skipped) and reads the key of each TOP-LEVEL entry: `a`, `a: expr`, `'a': expr`, `async a() {}`; spreads and
 * computed keys are ignored.
 * @param {string} src
 * @returns {string[]}
 */
function cjsObjectExportNames(src) {
	const out = []
	const start = /module\.exports\s*=\s*\{/g
	let m
	while ((m = start.exec(src))) {
		let i = m.index + m[0].length
		let depth = 1
		let entryStart = i
		const entries = []
		const flush = (end) => {
			const e = src.slice(entryStart, end).trim()
			if (e) entries.push(e)
			entryStart = end + 1
		}
		while (i < src.length && depth > 0) {
			const c = src[i]
			if (c === '"' || c === "'" || c === '`') {
				for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++
			} else if (c === '/' && src[i + 1] === '/') {
				while (i < src.length && src[i] !== '\n') i++
			} else if (c === '/' && src[i + 1] === '*') {
				const end = src.indexOf('*/', i + 2)
				i = end < 0 ? src.length : end + 1
			} else if (c === '{' || c === '(' || c === '[') depth++
			else if (c === '}' || c === ')' || c === ']') {
				depth--
				if (depth === 0) flush(i)
			} else if (c === ',' && depth === 1) flush(i)
			i++
		}
		for (const e of entries) {
			const body = e.replace(/^(?:\s*\/\/[^\n]*\n|\s*\/\*[\s\S]*?\*\/)+/, '').trim()
			if (body.startsWith('...') || body.startsWith('[')) continue
			const key = /^(?:async\s+|get\s+|set\s+|\*\s*)?(?:([A-Za-z_$][\w$]*)|'([^']+)'|"([^"]+)")\s*(?:[,:(]|$)/.exec(body)
			const name = key && (key[1] || key[2] || key[3])
			if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.push(name)
		}
	}
	return out
}

/** Every identifier-shaped token in a file — the reference side of the check. */
function tokens(src) {
	const set = new Set()
	for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) set.add(m[0])
	return set
}

function loadBaseline() {
	try {
		const j = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
		return new Set(Array.isArray(j?.entries) ? j.entries : [])
	} catch {
		return new Set()
	}
}

/**
 * @param {{root?: string, exportRoots?: string[], referenceRoots?: string[]}} [opts]
 * @returns {{orphans: string[], scanned: number}} orphans as sorted `relative/path.js: name`
 */
function findOrphans(opts = {}) {
	const root = opts.root || REPO_ROOT
	const exportRoots = opts.exportRoots || EXPORT_ROOTS
	const referenceRoots = opts.referenceRoots || REFERENCE_ROOTS

	const referenceFiles = referenceRoots.flatMap((r) => walk(path.join(root, r)))
	/** @type {Map<string, Set<string>>} file → tokens */
	const tokensByFile = new Map()
	for (const f of referenceFiles) {
		try {
			tokensByFile.set(f, tokens(fs.readFileSync(f, 'utf8')))
		} catch {
			/* unreadable file is not this gate's problem */
		}
	}

	const exportFiles = exportRoots.flatMap((r) => walk(path.join(root, r)))
	const orphans = []
	for (const f of exportFiles) {
		let src
		try {
			src = fs.readFileSync(f, 'utf8')
		} catch {
			continue
		}
		const rel = path.relative(root, f)
		for (const name of exportedNames(src)) {
			let referenced = false
			for (const [otherFile, toks] of tokensByFile) {
				if (otherFile === f) continue
				if (toks.has(name)) {
					referenced = true
					break
				}
			}
			if (!referenced) orphans.push(`${rel}: ${name}`)
		}
	}
	orphans.sort()
	return { orphans, scanned: exportFiles.length }
}

function main() {
	const listOnly = process.argv.includes('--list')
	const update = process.argv.includes('--update')

	const { orphans, scanned: exportFileCount } = findOrphans()

	if (update) {
		fs.writeFileSync(
			BASELINE_FILE,
			`${JSON.stringify({ note: 'WO-367 ratchet — pre-existing orphan exports. This list may SHRINK, never grow. Regenerate with: node tools/ci/check-unwired-exports.js --update', count: orphans.length, entries: orphans }, null, '\t')}\n`
		)
		console.log(`[check-unwired-exports] baseline rewritten: ${orphans.length} entr(ies)`)
		return 0
	}

	const baseline = loadBaseline()
	const fresh = orphans.filter((o) => !baseline.has(o))
	const current = new Set(orphans)
	const resolved = [...baseline].filter((b) => !current.has(b))

	if (listOnly) {
		for (const o of orphans) console.log(`  ${o}`)
		console.log(`[check-unwired-exports] ${orphans.length} orphan export(s), ${fresh.length} not in baseline`)
		return 0
	}

	if (resolved.length) {
		// Not a failure: deleting a file or wiring a symbol must never turn CI red.
		console.log(
			`[check-unwired-exports] ${resolved.length} baseline entr(ies) no longer orphaned — shrink the baseline with: node tools/ci/check-unwired-exports.js --update`
		)
	}

	if (!fresh.length) {
		console.log(
			`[check-unwired-exports] ${exportFileCount} files scanned — no NEW orphan exports (${orphans.length} in baseline)`
		)
		return 0
	}

	console.error(`[check-unwired-exports] ${fresh.length} export(s) nothing anywhere references:\n`)
	for (const o of fresh) console.error(`  ${o}`)
	console.error(
		'\nWire it up or delete it. This is the WO-367 gate: code that is written, reviewed and marked DONE\n' +
			'but never called has shipped three times (6e53abe, 9d2f6dd, 185d200).'
	)
	return 1
}

if (require.main === module) process.exit(main())

module.exports = { findOrphans, exportedNames, cjsObjectExportNames, BASELINE_FILE }
