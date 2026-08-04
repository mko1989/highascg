'use strict'

/**
 * WO-421 smoke — config durability (review 03.08 rows 8–9, un-parked by the owner's 04.08
 * clarification that stick-driven config reset is intended eggs-produce behavior — these are
 * the parts that do NOT touch that flow):
 *  §1  a config file that exists but fails to parse is QUARANTINED (renamed .corrupt-<stamp>)
 *      before defaults take over, so the next save() cannot destroy it
 *  §3  exFAT sync copies via tmp+rename, never truncate-in-place
 *  plus the monitor-bus fps fallback: an operator-gui-only box must not fall back to
 *  576p2500 against a 50 fps GUI channel (the WO-237 audio-chop condition; the WO-237
 *  smoke pins the end-to-end behavior against the live box config)
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ROOT = path.join(__dirname, '..', '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const quietLog = { info() {}, warn() {}, error() {} }

const { ConfigManager } = require('../../src/config/config-manager')
const { copyFilePreserveTimes } = require('../../src/system/exfat-sync-fs')

test('WO-421 §1: corrupt modular file is quarantined, not left for save() to destroy', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo421-modular-'))
	try {
		fs.writeFileSync(path.join(dir, 'device_graph.json'), '{"torn": tru', 'utf8')
		const cm = new ConfigManager(dir, quietLog)
		cm.load()
		assert.equal(fs.existsSync(path.join(dir, 'device_graph.json')), false, 'corrupt file moved aside')
		const quarantined = fs.readdirSync(dir).filter((f) => f.startsWith('device_graph.json.corrupt-'))
		assert.equal(quarantined.length, 1, 'exactly one .corrupt-<stamp> copy kept')
		assert.match(fs.readFileSync(path.join(dir, quarantined[0]), 'utf8'), /torn/, 'original bytes preserved')
		assert.ok(cm.isLoaded, 'app still boots on defaults')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('WO-421 §1: corrupt monolithic config is quarantined too', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo421-mono-'))
	try {
		const file = path.join(dir, 'config.json')
		fs.writeFileSync(file, '{not json', 'utf8')
		const cm = new ConfigManager(file, quietLog)
		cm.load()
		assert.equal(fs.existsSync(file), false, 'corrupt monolithic file moved aside')
		assert.equal(fs.readdirSync(dir).filter((f) => f.startsWith('config.json.corrupt-')).length, 1)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('WO-421 §3: exFAT copy is tmp+rename and cleans up on failure', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo421-copy-'))
	try {
		const src = path.join(dir, 'src.json')
		const dst = path.join(dir, 'sub', 'dst.json')
		fs.writeFileSync(src, '{"ok":true}', 'utf8')
		copyFilePreserveTimes(src, dst)
		assert.equal(fs.readFileSync(dst, 'utf8'), '{"ok":true}')
		assert.equal(fs.readdirSync(path.dirname(dst)).filter((f) => f.includes('.tmp-')).length, 0, 'no tmp leftover')
		// Failure path: missing source throws and leaves no tmp debris next to dst.
		assert.throws(() => copyFilePreserveTimes(path.join(dir, 'missing.json'), dst))
		assert.equal(fs.readdirSync(path.dirname(dst)).filter((f) => f.includes('.tmp-')).length, 0)
		assert.equal(fs.readFileSync(dst, 'utf8'), '{"ok":true}', 'existing dst untouched by failed copy')
		// Source pin: the write path must stay rename-into-place, never copyFileSync straight to dst.
		const srcText = read('src/system/exfat-sync-fs.js')
		assert.match(srcText, /copyFileSync\(src, tmp\)/, 'copies to tmp first')
		assert.match(srcText, /renameSync\(tmp, dst\)/, 'renames into place')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('WO-421: monitor bus fps falls back to the operator-GUI channel', () => {
	const gen = read('src/config/config-generator-channels.js')
	assert.match(
		gen,
		/plan\.screens\?\.\[0\]\?\.dims\?\.fps \?\? plan\.operatorGuis\?\.\[0\]\?\.dims\?\.fps/,
		'monitor sourceFps considers operator-GUI mains when there are no plain screens',
	)
})
