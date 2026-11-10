'use strict'

/**
 * WO-1029 plan 07 (channels where cabled) — fixture configs for the cwc smokes. Not a test file.
 *
 * `boxConfig('7579' | '5867')`: the two real boxes' screen destinations + device graph (GET /api/device-view, 10.11,
 * reduced, no credentials: tools/smoke/fixtures/cwc/box*.config.json) on top of the factory defaults.
 * `goldenFixtures()`: every config the flag-off byte-identity guard checks (the two boxes, the WO-868 rig in both
 * states, the WO-869 pixel-mapping rig in both states, the device-view sample, a plain two-screen box).
 * `outputs(cfg)`: what the guard compares — generated casparcg.config XML and the channel map JSON, built the way
 * the product builds them (flat generator config → getChannelMap / buildConfigXml).
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const SRC = path.join(__dirname, '../../../src')
const FIX = path.join(__dirname, '../fixtures')
const defaults = require(path.join(SRC, 'config/defaults'))
const { buildConfigXml } = require(path.join(SRC, 'config/config-generator'))
const { buildCasparGeneratorFlatConfig } = require(path.join(SRC, 'config/build-caspar-generator-config'))
const { getChannelMap } = require(path.join(SRC, 'config/routing'))
const og = require(path.join(SRC, 'config/operator-gui-first'))
const { clone, addMainDestinations } = require('./config-generator-routing-fixtures')

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(FIX, rel), 'utf8'))

function onDefaults(slices) {
	const cfg = clone(defaults)
	for (const [k, v] of Object.entries(slices)) {
		if (k.startsWith('_')) continue
		cfg[k] = k === 'casparServer' || k === 'streamingChannel' ? { ...(cfg[k] || {}), ...v } : clone(v)
	}
	return cfg
}

/** @param {'7579'|'5867'} box */
function boxConfig(box) {
	return onDefaults(readJson(`cwc/box${box}.config.json`))
}

function goldenFixtures() {
	const rig = () => readJson('wo868/rig.config.json')
	const { boxConfig: wo869 } = require('../fixtures/wo869-box-config')
	const sample = onDefaults({
		screenDestinations: readJson('screen_destinations.sample.json'),
		deviceGraph: readJson('device_graph.sample.json'),
	})
	const plain = clone(defaults)
	addMainDestinations(plain, 2)
	return [
		['box7579', boxConfig('7579')],
		['box5867', boxConfig('5867')],
		['wo868-off', rig()],
		['wo868-on', og.withOperatorGuiFirst(rig(), true)],
		['wo869-on', wo869({ operatorFirst: true })],
		['wo869-off', wo869({ operatorFirst: false })],
		['device-view-sample', sample],
		['plain-2-screens', plain],
	]
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 24)

/** Generated XML + channel map JSON (functions drop out of JSON, so this is the map's data shape). */
function outputs(cfg) {
	const flat = buildCasparGeneratorFlatConfig(cfg)
	const map = getChannelMap(flat)
	return { xml: buildConfigXml(flat), map: JSON.stringify(map, null, 1), routeMap: map, flat }
}

/** Generator logs layout lines through the default logger; keep smoke output readable. */
function quiet(fn) {
	const orig = console.log
	const origInfo = console.info
	console.log = () => {}
	console.info = () => {}
	try {
		return fn()
	} finally {
		console.log = orig
		console.info = origInfo
	}
}

module.exports = { boxConfig, goldenFixtures, outputs, sha, quiet, clone }
