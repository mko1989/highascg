#!/usr/bin/env node
'use strict'

/**
 * CI guard: one canonical escapeHtml in client/ (WO-103).
 */
const fs = require('fs')
const path = require('path')

const REPO = path.resolve(__dirname, '../..')
const CLIENT = path.join(REPO, 'client')

const ALLOW = new Set([
	path.join(CLIENT, 'lib/dom-escape.js'),
	path.join(CLIENT, 'setup.html'),
])

function walk(dir, out = []) {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		if (ent.name === 'node_modules' || ent.name === 'tools') continue
		const full = path.join(dir, ent.name)
		if (ent.isDirectory()) walk(full, out)
		else if (ent.name.endsWith('.js') || ent.name.endsWith('.html')) out.push(full)
	}
	return out
}

const hits = []
for (const file of walk(CLIENT)) {
	if (file.includes(`${path.sep}electron-launcher${path.sep}`)) continue
	const text = fs.readFileSync(file, 'utf8')
	if (/function\s+escapeHtml\s*\(/.test(text) && !ALLOW.has(file)) {
		hits.push(path.relative(REPO, file))
	}
}

if (hits.length) {
	console.error('Duplicate escapeHtml definitions (use client/lib/dom-escape.js):')
	for (const h of hits) console.error(`  ${h}`)
	process.exit(1)
}
console.log('OK: no duplicate escapeHtml in client/')
