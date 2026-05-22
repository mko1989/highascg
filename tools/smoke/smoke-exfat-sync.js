'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { validateMap, isExcluded, loadExfatSyncMapFromDisk } = require('../../src/system/exfat-sync')

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

test('loadExfatSyncMapFromDisk finds repo config/exfat-sync.json', () => {
	const l = loadExfatSyncMapFromDisk()
	assert.ok(l.mapPath, `expected map file, got loadError=${l.loadError}`)
	assert.ok(Array.isArray(l.map.pairs) && l.map.pairs.length >= 1)
})
