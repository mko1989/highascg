'use strict'

/**
 * WO-383 — the temporal-dead-zone gate.
 *
 * Motivated by a live break: WO-381 hoisted `d?.casparChannel ?? intent?.pgmChannel` out of a
 * ternary branch in device-view-destinations-ui.js. `??` short-circuits past `intent` only while
 * `casparChannel` is set — true for host channels, false for screen destinations — so the first
 * PGM/PRV card read `intent` 24 lines before its `const`, threw, and the Devices page rendered
 * "can't access lexical declaration 'intent' before initialization" instead of its contents.
 *
 * The gate must catch that shape and stay quiet on forward references from inside callbacks, which
 * are legal and everywhere.
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { findTdzReads, scanFile } = require('../ci/check-tdz-reads')

/** @param {string} source @returns {{ line: number, name: string }[]} */
function scanSource(source) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdz-'))
	const file = path.join(dir, 'sample.js')
	fs.writeFileSync(file, source, 'utf8')
	try {
		return scanFile(file)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
}

test('catches the exact shape that broke the Devices page', () => {
	const hits = scanSource(`
		export function render(list, items) {
			for (const d of list) {
				const hostCh = d?.casparChannel ?? intent?.pgmChannel ?? null
				const intent = items.find((x) => x.id === d.id) || null
				use(hostCh, intent)
			}
		}
	`)
	assert.equal(hits.length, 1)
	assert.equal(hits[0].name, 'intent')
})

test('catches a shadowing declaration that dead-zones the reads above it', () => {
	const hits = scanSource(`
		for (const row of rows) {
			const layer = row.layer
			void (async () => {
				check(layer.number)
				const layer = await refresh()
				use(layer)
			})()
		}
	`)
	assert.deepEqual(hits.map((h) => h.name), ['layer'])
})

test('stays quiet on legal forward references from inside callbacks', () => {
	const hits = scanSource(`
		function init() {
			el.addEventListener('click', () => render())   // runs later — legal
			const render = () => { cleanup() }
			const cleanup = () => {}
			setTimeout(() => cleanup(), 10)
			function hoisted() { return later }            // function declaration, runs later
			const later = 1
			return hoisted
		}
	`)
	assert.deepEqual(hits, [])
})

test('stays quiet on ordinary declaration-then-use and on shorthand properties', () => {
	const hits = scanSource(`
		const a = 1
		const b = { a }
		const { c, d: [e] } = b
		class K {}
		const k = new K()
		export { a, b, c, e, k }
	`)
	assert.deepEqual(hits, [])
})

test('the client tree is clean — the gate passes as shipped', () => {
	const findings = findTdzReads()
	assert.deepEqual(
		findings,
		[],
		`temporal-dead-zone reads:\n${findings.map((f) => `  ${f.file}:${f.line} '${f.name}'`).join('\n')}`,
	)
})

test('the two fixes that made it clean are still in place', () => {
	const dest = fs.readFileSync(
		path.join(__dirname, '../../client/components/device-view-destinations-ui.js'),
		'utf8',
	)
	const intentDecl = dest.indexOf('const intent = intentItems.find(')
	const intentUse = dest.indexOf('intent?.pgmChannel')
	assert.ok(intentDecl > 0 && intentUse > 0)
	assert.ok(intentDecl < intentUse, 'intent must be declared before the ?? chain that can reach it')

	const compose = fs.readFileSync(path.join(__dirname, '../../client/components/scenes-compose.js'), 'utf8')
	assert.match(compose, /const updatedLayer = updated\?\.layers\?\.\[realIdx\]/)
})
