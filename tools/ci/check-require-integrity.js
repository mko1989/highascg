#!/usr/bin/env node
/**
 * WO-98 / WO-99 repo integrity guardrail.
 * - Fails on Syncthing sync-conflict copies in the tree.
 * - Fails on known stray artifact filenames.
 * - Fails when a relative require() from src/client/index.js cannot be resolved.
 */
'use strict'

const fs = require('fs')
const path = require('path')

const REPO_ROOT = path.resolve(__dirname, '../..')

const SCAN_ROOTS = ['src', 'client', 'index.js', 'tools']
const JS_SCAN_DIRS = ['src', 'client', 'tools']
const REQUIRE_RE = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g

/** @type {string[]} */
const errors = []

function walk(dir, onFile) {
	if (!fs.existsSync(dir)) return
	let st
	try {
		st = fs.lstatSync(dir)
	} catch {
		return
	}
	if (!st.isDirectory()) {
		if (st.isFile()) onFile(dir)
		return
	}
	for (const name of fs.readdirSync(dir)) {
		if (name === 'node_modules' || name === '.git') continue
		walk(path.join(dir, name), onFile)
	}
}

function findSyncConflicts() {
	/** @type {string[]} */
	const hits = []
	walk(REPO_ROOT, (fp) => {
		const base = path.basename(fp)
		if (base.includes('.sync-conflict-')) hits.push(path.relative(REPO_ROOT, fp))
	})
	return hits
}

function findStrayArtifacts() {
	/** @type {string[]} */
	const hits = []
	const rootArtifact = path.join(REPO_ROOT, '[object Object].tmp')
	if (fs.existsSync(rootArtifact)) hits.push('[object Object].tmp')
	walk(REPO_ROOT, (fp) => {
		const base = path.basename(fp)
		if (base.endsWith('.bak') && !fp.includes('node_modules')) {
			hits.push(path.relative(REPO_ROOT, fp))
		}
	})
	return hits
}

function collectJsFiles() {
	/** @type {string[]} */
	const files = []
	for (const rel of JS_SCAN_DIRS) {
		const abs = path.join(REPO_ROOT, rel)
		walk(abs, (fp) => {
			if (fp.endsWith('.js') && !fp.includes('.sync-conflict-')) files.push(fp)
		})
	}
	const indexJs = path.join(REPO_ROOT, 'index.js')
	if (fs.existsSync(indexJs)) files.push(indexJs)
	return files
}

function stripJsComments(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function checkRequires() {
	for (const file of collectJsFiles()) {
		const src = stripJsComments(fs.readFileSync(file, 'utf8'))
		let m
		REQUIRE_RE.lastIndex = 0
		while ((m = REQUIRE_RE.exec(src)) !== null) {
			const req = m[1]
			if (!req.startsWith('.')) continue
			const resolved = path.resolve(path.dirname(file), req)
			const candidates = [
				resolved,
				`${resolved}.js`,
				path.join(resolved, 'index.js'),
			]
			if (!candidates.some((c) => fs.existsSync(c))) {
				errors.push(
					`unresolved require in ${path.relative(REPO_ROOT, file)}: '${req}'`,
				)
			}
		}
	}
}

function main() {
	const conflicts = findSyncConflicts()
	if (conflicts.length) {
		errors.push(`found ${conflicts.length} sync-conflict file(s):`)
		for (const c of conflicts.slice(0, 20)) errors.push(`  - ${c}`)
		if (conflicts.length > 20) errors.push(`  ... and ${conflicts.length - 20} more`)
	}

	const stray = findStrayArtifacts()
	if (stray.length) {
		errors.push(`found stray artifact file(s):`)
		for (const s of stray) errors.push(`  - ${s}`)
	}

	checkRequires()

	if (errors.length) {
		console.error('[check-require-integrity] FAILED\n' + errors.join('\n'))
		process.exit(1)
	}
	console.log('[check-require-integrity] OK')
}

main()
