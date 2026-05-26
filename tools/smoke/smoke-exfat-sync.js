'use strict'

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert')
const { validateMap, isExcluded, loadExfatSyncMapFromDisk } = require('../../src/system/exfat-sync')

const REPO_EXFAT_MAP = path.join(__dirname, '../../config/exfat-sync.json')

test('isExcluded matches path segments and prefixes', () => {
	assert.strictEqual(isExcluded('node_modules/foo/bar.js', ['node_modules']), true)
	assert.strictEqual(isExcluded('src/index.js', ['node_modules']), false)
	assert.strictEqual(isExcluded('media/drive/x', ['media']), true)
})

test('validateMap accepts WO-47 shape', () => {
	const m = validateMap({
		version: 1,
		pairs: [
			{
				id: 't',
				exfat: 'drop-config/highascg.config.json',
				project: '/home/casparcg/highascg/highascg.config.json',
				direction: 'both',
				exclude: [],
			},
		],
	})
	assert.strictEqual(m.pairs.length, 1)
})

test('repo config/exfat-sync.json has modular-config and no sim-highascg', () => {
	const raw = JSON.parse(fs.readFileSync(REPO_EXFAT_MAP, 'utf8'))
	const m = validateMap(raw)
	const ids = m.pairs.map((p) => p.id)
	assert.ok(ids.includes('modular-config'), `expected modular-config pair, got ${ids.join(',')}`)
	assert.ok(!ids.includes('sim-highascg'), 'sim-highascg must not be in production map')
})

test('loadExfatSyncMapFromDisk finds a map file', () => {
	const l = loadExfatSyncMapFromDisk()
	assert.ok(l.mapPath, `expected map file, got loadError=${l.loadError}`)
	assert.ok(Array.isArray(l.map.pairs) && l.map.pairs.length >= 1)
})
