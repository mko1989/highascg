#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '../..')
const MAX = parseInt(process.env.HIGHASCG_MAX_FILE_LINES || '500', 10)
const ROOTS = ['client', 'src', 'scripts', 'tools', 'template']
const EXT = new Set(['.js', '.css', '.html', '.sh'])
const SKIP_DIRS = new Set([
	'node_modules',
	'dist-web',
	'dist',
	'dist-map',
	'cef-cache',
	'.git',
	'vendor',
	'__pycache__',
])

/* Legacy grandfather list — files that predate the limit and live outside the operator
 * service (Pages-only map viewer, WO-163). New code must NOT be added here; split instead. */
const EXEMPT = new Set(['client/components/map-explorer.js', 'client/styles/map-explorer.css'])

const warnOnly = process.argv.includes('--warn-only')
const asJson = process.argv.includes('--json')

/** @type {{ lines: number, rel: string }[]} */
const violations = []

function walk(dir) {
	let entries
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return
	}
	for (const ent of entries) {
		if (SKIP_DIRS.has(ent.name)) continue
		const abs = path.join(dir, ent.name)
		if (ent.isDirectory()) {
			walk(abs)
			continue
		}
		if (!ent.isFile()) continue
		const ext = path.extname(ent.name)
		if (!EXT.has(ext)) continue
		const buf = fs.readFileSync(abs, 'utf8')
		/* Don't count the empty tail after a final newline as a line. */
		const lines = buf === '' ? 0 : buf.split('\n').length - (buf.endsWith('\n') ? 1 : 0)
		const rel = path.relative(repoRoot, abs).replace(/\\/g, '/')
		if (lines > MAX && !EXEMPT.has(rel)) {
			violations.push({ lines, rel })
		}
	}
}

for (const root of ROOTS) {
	const abs = path.join(repoRoot, root)
	if (fs.existsSync(abs)) walk(abs)
}

violations.sort((a, b) => b.lines - a.lines)

if (asJson) {
	console.log(JSON.stringify({ max: MAX, count: violations.length, violations }, null, 2))
} else {
	console.log(`Files over ${MAX} lines: ${violations.length}`)
	for (const v of violations) {
		console.log(`  ${v.lines}\t${v.rel}`)
	}
}

if (violations.length && !warnOnly) {
	process.exit(1)
}
