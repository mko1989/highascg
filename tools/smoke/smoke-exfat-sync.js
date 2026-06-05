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

test('validateMap accepts WO-47 legacy shape', () => {
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
	assert.ok(m.volumes.usb)
})

test('validateMap accepts WO-52 multi-volume shape', () => {
	const m = validateMap({
		version: 2,
		volumes: {
			bridge: { mount: '/home/casparcg/bridge' },
			usb: { mount: '/home/casparcg/exfat' },
		},
		pairs: [
			{
				id: 'usb-media-ingest',
				volume: 'usb',
				exfat: 'media',
				project: '/home/casparcg/highascg/media',
				direction: 'to_project',
				bootPrefer: 'exfat',
			},
		],
	})
	assert.strictEqual(m.pairs[0].volume, 'usb')
	assert.strictEqual(m.pairs[0].direction, 'to_project')
})

test('repo config/exfat-sync.json has bridge + usb pairs and no sim-highascg', () => {
	const raw = JSON.parse(fs.readFileSync(REPO_EXFAT_MAP, 'utf8'))
	const m = validateMap(raw)
	const ids = m.pairs.map((p) => p.id)
	assert.ok(ids.includes('bridge-modular-config'), `expected bridge-modular-config, got ${ids.join(',')}`)
	assert.ok(ids.includes('usb-media-ingest'), `expected usb-media-ingest, got ${ids.join(',')}`)
	assert.ok(!ids.includes('sim-highascg'), 'sim-highascg must not be in production map')
	assert.ok(m.volumes.bridge && m.volumes.usb)
	const usbCfg = m.pairs.find((p) => p.id === 'usb-modular-config')
	assert.ok(usbCfg)
	assert.strictEqual(usbCfg.direction, 'to_project')
	assert.strictEqual(usbCfg.bootPrefer, 'exfat')
	assert.strictEqual(usbCfg.pushOnSave, true)
	const bridgeCfg = m.pairs.find((p) => p.id === 'bridge-modular-config')
	assert.strictEqual(bridgeCfg.direction, 'both')
})

test('loadExfatSyncMapFromDisk finds a map file', () => {
	const l = loadExfatSyncMapFromDisk()
	assert.ok(l.mapPath, `expected map file, got loadError=${l.loadError}`)
	assert.ok(Array.isArray(l.map.pairs) && l.map.pairs.length >= 1)
})
