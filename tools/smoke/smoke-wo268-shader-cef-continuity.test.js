'use strict'

/**
 * WO-268: shader-template CEF hardening, opt-in CEF GPU, honest CG continuity.
 * Offline-only — generator exercised as pure XML building; tracked-hosts via the exported
 * lifecycle fns; player + pipeline wiring asserted at source level.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { ConfigManager } = require('../../src/config/config-manager')
const { buildCasparGeneratorFlatConfig } = require('../../src/config/build-caspar-generator-config')
const { buildConfigXml } = require('../../src/config/config-generator')
const {
	recordTemplateHostAdded,
	getTrackedTemplateHosts,
	clearAllTrackedTemplateHosts,
	quarantineAllTrackedTemplateHosts,
	reconcileQuarantinedTemplateHosts,
} = require('../../src/engine/scene-template-cg')

const REPO = path.join(__dirname, '../..')

function src(rel) {
	return fs.readFileSync(path.join(REPO, rel), 'utf8')
}

function loadFlat() {
	const cm = new ConfigManager(path.join(REPO, 'config'), { info() {}, warn() {}, error() {} })
	cm.load()
	return buildCasparGeneratorFlatConfig(cm.get())
}

describe('WO-268 T268.1: player contract-first + WebGL2 probe (source asserts)', () => {
	const player = src('template/shaders/player.js')

	it('Caspar contract functions are installed before any GL/ShaderToyLite use', () => {
		const contractIdx = player.indexOf('window.update')
		const toyIdx = player.indexOf('new ShaderToyLite')
		assert.ok(contractIdx > 0 && toyIdx > contractIdx, 'window.update must be defined before the toy is constructed')
	})

	it('bails gracefully when webgl2 is unavailable and guards init throws', () => {
		assert.match(player, /if \(!gl\) \{/)
		assert.match(player, /WebGL2 unavailable/)
		assert.match(player, /void start\(\)\.catch/)
	})
})

describe('WO-268 T268.2: operatorTools.cefEnableGpu', () => {
	it('flat config carries operatorTools from the app config', () => {
		const flat = loadFlat()
		assert.ok(flat.operatorTools && typeof flat.operatorTools === 'object')
		assert.equal(flat.operatorTools.cefInteractiveBridge, true)
	})

	it('enable-gpu defaults false and flips only on explicit opt-in', () => {
		// Independent of the box's live config: start from an explicit no-flag baseline.
		const flat = loadFlat()
		flat.operatorTools = { ...flat.operatorTools }
		delete flat.operatorTools.cefEnableGpu
		assert.match(buildConfigXml(flat), /<enable-gpu>false<\/enable-gpu>/)
		flat.operatorTools = { ...flat.operatorTools, cefEnableGpu: true }
		assert.match(buildConfigXml(flat), /<enable-gpu>true<\/enable-gpu>/)
		flat.operatorTools = { ...flat.operatorTools, cefEnableGpu: 'nonsense' }
		assert.match(buildConfigXml(flat), /<enable-gpu>false<\/enable-gpu>/)
	})
})

describe('WO-268 T268.3: honest continuity', () => {
	it('tracked-host lifecycle: record → has → clear-all', () => {
		clearAllTrackedTemplateHosts()
		assert.equal(getTrackedTemplateHosts(9).has(700), false)
		recordTemplateHostAdded(9, 700)
		assert.equal(getTrackedTemplateHosts(9).has(700), true)
		clearAllTrackedTemplateHosts()
		assert.equal(getTrackedTemplateHosts(9).has(700), false)
	})

	it('pipeline gates continuity on tracked hosts and records after ADD', () => {
		const pipeline = src('src/engine/scene-take-lbg-amcp-pipeline.js')
		assert.match(pipeline, /isSameTemplateSpec\(job\.templateCg, currentSpec\) &&\s*\n\s*getTrackedTemplateHosts\(channel\)\.has\(continuityHostLayer\)/)
		assert.match(pipeline, /if \(!isContinuous\) recordTemplateHostAdded\(channel, continuityHostLayer\)/)
	})

	it('disconnect quarantines tracked hosts; routing setup reconciles them against INFO XML', () => {
		const idx = src('index.js')
		assert.match(idx, /quarantineAllTrackedTemplateHosts\(\)/)
		const routing = src('src/config/routing-setup.js')
		assert.match(routing, /await require\('\.\.\/engine\/scene-template-cg'\)\.reconcileQuarantinedTemplateHosts\(self\)/)
	})
})

describe('WO-268 blip reconnect: quarantined hosts verified against gathered INFO XML', () => {
	function channelXmlWithLayer(layerIdx, producer) {
		return (
			'<?xml version="1.0" encoding="utf-8"?>' +
			`<channel><framerate>50</framerate><stage><layer><layer_${layerIdx}>` +
			`<foreground><producer>${producer}</producer></foreground>` +
			`</layer_${layerIdx}></layer></stage></channel>`
		)
	}

	it('TCP-only blip: layer still runs html producer → host restored, continuity survives', async () => {
		clearAllTrackedTemplateHosts()
		recordTemplateHostAdded(9, 700)
		quarantineAllTrackedTemplateHosts()
		// Quarantined hosts must not vouch while unverified (takes do the safe full re-add).
		assert.equal(getTrackedTemplateHosts(9).has(700), false)
		// INFO CONFIG path can run setupAllRouting before the gather finishes: no XML → stays quarantined.
		await reconcileQuarantinedTemplateHosts({ gatheredInfo: { channelXml: {} } })
		assert.equal(getTrackedTemplateHosts(9).has(700), false)
		// finishConnectionGather pass: layer 700 still hosts the template → restored.
		await reconcileQuarantinedTemplateHosts({
			gatheredInfo: { channelXml: { 9: channelXmlWithLayer(700, 'html') } },
		})
		assert.equal(getTrackedTemplateHosts(9).has(700), true)
		clearAllTrackedTemplateHosts()
	})

	it('real Caspar restart: empty or missing layer → host dropped (no UPDATE against empty layer)', async () => {
		clearAllTrackedTemplateHosts()
		recordTemplateHostAdded(9, 700)
		recordTemplateHostAdded(10, 701)
		quarantineAllTrackedTemplateHosts()
		await reconcileQuarantinedTemplateHosts({
			gatheredInfo: {
				channelXml: {
					9: channelXmlWithLayer(700, 'empty'),
					10: channelXmlWithLayer(5, 'ffmpeg'),
				},
			},
		})
		assert.equal(getTrackedTemplateHosts(9).has(700), false)
		assert.equal(getTrackedTemplateHosts(10).has(701), false)
		clearAllTrackedTemplateHosts()
	})

	it('channel absent from gather → dropped (bias toward clearing when unverifiable)', async () => {
		clearAllTrackedTemplateHosts()
		recordTemplateHostAdded(9, 700)
		quarantineAllTrackedTemplateHosts()
		await reconcileQuarantinedTemplateHosts({
			gatheredInfo: { channelXml: { 2: channelXmlWithLayer(10, 'ffmpeg') } },
		})
		assert.equal(getTrackedTemplateHosts(9).has(700), false)
		clearAllTrackedTemplateHosts()
	})

	it('fresh ADD during the quarantine window supersedes the pending verdict', async () => {
		clearAllTrackedTemplateHosts()
		recordTemplateHostAdded(9, 700)
		quarantineAllTrackedTemplateHosts()
		// Operator takes the look again mid-window: full re-add re-tracks the host.
		recordTemplateHostAdded(9, 700)
		assert.equal(getTrackedTemplateHosts(9).has(700), true)
		// Stale pre-take XML claiming the layer is empty must not drop the fresh record.
		await reconcileQuarantinedTemplateHosts({
			gatheredInfo: { channelXml: { 9: channelXmlWithLayer(700, 'empty') } },
		})
		assert.equal(getTrackedTemplateHosts(9).has(700), true)
		clearAllTrackedTemplateHosts()
	})
})
