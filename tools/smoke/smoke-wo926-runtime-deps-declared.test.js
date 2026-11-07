'use strict'
/**
 * WO-926 — every package the server requires is a declared `dependencies` entry. The ISO build prunes with
 * `npm prune --omit=dev --omit=optional` (the produce path, eggs-produce-prunes-node-modules), so a module that only arrives under a dev or
 * optional dependency is missing on a stick boot: WO-825's `require('jszip')` (exceljs's, optional) made node exit
 * with MODULE_NOT_FOUND on every boot of the 01.11 ISO (box .31, 02.11).
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { builtinModules } = require('module')

const REPO = path.resolve(__dirname, '../..')
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))

/** Optional dependencies the server may load only inside a try/catch (absent on the ISO). */
const GUARDED_OPTIONAL = { naudiodon: 'src/audio/audio-devices.js' }

function jsFiles(dir, out = []) {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name)
		if (e.isDirectory()) jsFiles(p, out)
		else if (e.name.endsWith('.js')) out.push(p)
	}
	return out
}

function packageName(spec) {
	return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
}

describe('WO-926 runtime dependencies', () => {
	it('every package required by src/ and index.js is in dependencies', () => {
		const deps = new Set(Object.keys(pkg.dependencies || {}))
		const builtins = new Set(builtinModules)
		const bad = []
		for (const file of [path.join(REPO, 'index.js'), ...jsFiles(path.join(REPO, 'src'))]) {
			const rel = path.relative(REPO, file)
			const text = fs.readFileSync(file, 'utf8')
			for (const m of text.matchAll(/require\(\s*'([^'.][^']*)'\s*\)/g)) {
				const name = packageName(m[1])
				if (name.startsWith('node:') || builtins.has(name) || deps.has(name)) continue
				if (GUARDED_OPTIONAL[name] === rel) continue
				bad.push(`${rel}: ${m[1]}`)
			}
		}
		assert.deepEqual(bad, [], 'declare these in package.json "dependencies" (the ISO prunes dev + optional)')
	})

	it('jszip is a direct dependency (GDTF library, WO-825)', () => {
		assert.ok(pkg.dependencies?.jszip, 'jszip must not ride on optional exceljs')
	})
})

describe('WO-926 ISO build gate', () => {
	it('install-iso-defaults.sh starts the pruned server before the ISO is produced', () => {
		const sh = fs.readFileSync(path.join(REPO, 'tools/eggs/live-usb/install-iso-defaults.sh'), 'utf8')
		const prune = sh.indexOf('npm prune --omit=dev --omit=optional')
		const gate = sh.indexOf("run_as_caspar 'node tools/eggs/live-usb/verify-production-boot.js' || {")
		assert.ok(prune > 0 && gate > prune, 'the boot check runs after the prune')
		assert.match(fs.readFileSync(path.join(REPO, 'tools/eggs/live-usb/verify-production-boot.js'), 'utf8'), /startSandbox\(/)
	})
})
