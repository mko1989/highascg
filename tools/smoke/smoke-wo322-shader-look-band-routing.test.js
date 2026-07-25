'use strict'

/**
 * WO-322 smoke — shaders dropped into a look composite on the MEDIA band, not the 700+ CG overlay.
 *
 * Covers (a) routing: `shaders/…` names resolve to their look-band layer while lower thirds and
 * every other template-CG name keep the 700+ overlay; (b) the tracked-host guard: a shader's
 * look-band host never enters the WO-207 tracked set (its cleanup is the look-layer teardown, not
 * the 700–899 sweep); (c) teardown source assertions: physical exits CG CLEAR before STOP (ghost
 * prevention), shaders excluded from the 700+ fade/clear loops and from
 * incomingTemplateHostLayers.
 */

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
	isShaderCgName,
	resolveTemplateCgHostLayer,
} = require('../../src/engine/cg-routing.js')
const {
	buildSceneTemplateCgAmcpLines,
	buildSceneTemplateCgClearLines,
	getTrackedTemplateHosts,
	untrackTemplateHosts,
} = require('../../src/engine/scene-template-cg.js')

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')

describe('WO-322 (a): shader name classification + host-layer routing', () => {
	it('isShaderCgName matches the shader-store casparPath prefix only', () => {
		assert.equal(isShaderCgName('shaders/sh-balatro'), true)
		assert.equal(isShaderCgName('SHADERS/sh-x'), true)
		assert.equal(isShaderCgName('lower-thirds/name'), false)
		assert.equal(isShaderCgName('scoreboard'), false)
		assert.equal(isShaderCgName(''), false)
	})

	it('a shader on a look layer resolves to that layer (both banks), not 700+', () => {
		assert.equal(resolveTemplateCgHostLayer(20, 'shaders/sh-balatro'), 20)
		// Bank-B physical layer passes through untouched (the pipeline passes job.pLayer).
		assert.equal(resolveTemplateCgHostLayer(120, 'shaders/sh-balatro'), 120)
	})

	it('lower thirds and other template CG still map to the 700+ overlay', () => {
		assert.equal(resolveTemplateCgHostLayer(20, 'lower-thirds/name'), 710)
		assert.equal(resolveTemplateCgHostLayer(20, 'countdown/timer'), 710)
		assert.equal(resolveTemplateCgHostLayer(20, 'scoreboard'), 710)
		// Bank-B logical layers still fold back to the same overlay slot for non-shaders.
		assert.equal(resolveTemplateCgHostLayer(120, 'lower-thirds/name'), 710)
		// No name at all -> overlay (pre-WO-322 behaviour, unchanged).
		assert.equal(resolveTemplateCgHostLayer(20), 710)
		// Explicit 700-band layers pass through for everyone.
		assert.equal(resolveTemplateCgHostLayer(705, 'shaders/sh-x'), 705)
	})

	it('CG ADD / CLEAR lines for a shader target the look-band layer', () => {
		const addLines = buildSceneTemplateCgAmcpLines(9, 120, { cgName: 'shaders/sh-x', data: '{}' })
		assert.ok(addLines.some((l) => l.includes('CG 9-120 ADD')), `ADD targets 9-120: ${addLines}`)
		assert.ok(!addLines.some((l) => /CG 9-7\d\d/.test(l)), 'no 700-band line for a shader')
		assert.deepEqual(buildSceneTemplateCgClearLines(9, 120, 'shaders/sh-x'), ['CG 9-120 CLEAR'])
	})
})

describe('WO-322 (b): tracked-host guard', () => {
	it('a shader ADD on the look band does NOT enter the WO-207 tracked-host set', () => {
		const ch = 97 // unlikely to collide with other tests' channels
		buildSceneTemplateCgAmcpLines(ch, 120, { cgName: 'shaders/sh-x', data: '{}' })
		assert.equal(getTrackedTemplateHosts(ch).has(120), false)
	})

	it('a 700-band template ADD still records its host (WO-207 unchanged)', () => {
		const ch = 98
		buildSceneTemplateCgAmcpLines(ch, 20, { cgName: 'lower-thirds/name', data: '{}' })
		assert.equal(getTrackedTemplateHosts(ch).has(710), true)
		untrackTemplateHosts(ch, new Set([710]))
	})
})

describe('WO-322 (c): teardown source wiring', () => {
	it('physical exit teardown emits CG CLEAR before STOP/MIXER CLEAR on every exit path', () => {
		const src = read('src/engine/scene-take-lbg-teardown.js')
		const pushes = src.match(/teardownLines\.push\(`CG \$\{cl?g?\}[^`]*` ?, ?`STOP/g) || []
		assert.equal(pushes.length, 3, `all 3 exit paths (merge-stale, merge-both-banks, normal) CG CLEAR first — found ${pushes.length}`)
	})

	it('shaders are excluded from the 700+ fade-out and CG-clear loops', () => {
		const src = read('src/engine/scene-take-lbg-teardown.js')
		const excludes = src.match(/if \(isShaderCgName\(layer\.source\?\.value\)\) continue/g) || []
		assert.equal(excludes.length, 2, 'fade-out loop + WO-196 clear loop both skip shaders')
	})

	it('incomingTemplateHostLayers stays 700-band-only (shaders excluded)', () => {
		const src = read('src/engine/scene-take-lbg.js')
		assert.match(src, /if \(spec && !isShaderCgName\(spec\.cgName\)\)/)
	})

	it('take pipelines: shader branch uses job.pLayer with no cgFade; pgm-only skips clear-on-other-channels for shaders', () => {
		const lbg = read('src/engine/scene-take-lbg-amcp-pipeline.js')
		assert.match(lbg, /isShaderCgName\(job\.templateCg\.cgName\)/)
		assert.match(lbg, /buildSceneTemplateCgAmcpLines\(channel, job\.pLayer, job\.templateCg, \{\}\)/)
		const pgm = read('src/engine/scene-take-pgm-only.js')
		assert.match(pgm, /const isShader = isShaderCgName\(job\.templateCg\.cgName\)/)
		assert.match(pgm, /const cgFade = !isShader && fadeDur > 0/)
		assert.match(pgm, /isShader \? job\.pLayer : job\.layer\.layerNumber/)
	})
})

describe('WO-322 (d): shader-only look crossfade — the ramps must not ride a nonexistent PLAY batch', () => {
	// Regression (owner report 2026-07-25): a look whose ONLY job is a shader has playPlan=null on
	// every job, so sendStaggeredTakePlays had no source PLAY lines and silently dropped the
	// crossfade suffix — the incoming bank stayed pre-hidden at OPACITY 0 (shader invisible on one
	// bank parity → "hit or miss whether it plays") and the outgoing media never got its fade-to-0
	// (hard cut at teardown instead of a mix).
	it('media → shader-only take sends the incoming OPACITY ramp after a flushing COMMIT, then the CG ADD', async () => {
		const { runSceneTakeLbgAmcpPipeline } = require('../../src/engine/scene-take-lbg-amcp-pipeline.js')
		const sent = []
		const amcp = {
			_context: {},
			batchSendChunked: async (lines) => { sent.push(...lines) },
			mixerCommit: async (ch) => { sent.push(`MIXER ${ch} COMMIT`) },
			mixerClear: async () => {},
			_send: async (line) => { sent.push(line); return {} },
		}
		const job = {
			layer: { layerNumber: 10 },
			pLayer: 110, // bank-B take: incoming above outgoing bank A
			clip: 'shaders/sh-x',
			playPlan: null,
			loadPlan: null,
			templateCg: { cgName: 'shaders/sh-x', data: '{}' },
			browserCgUrl: null,
			mixerLines: ['MIXER 1-110 FILL 0 0 1 1 0', 'MIXER 1-110 OPACITY 0 0 DEFER'],
			prePlayOpacityZeroLine: null,
			prePlayOpacityFullLine: null,
			pipOverlays: [],
			isMerge: false,
			useLoadAuto: false,
			hasLoadTransition: false,
			incomingStartsHidden: true,
			incomingIsAboveOutgoing: true,
			targetOpacity: 1,
			f: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
		}
		const currentMap = new Map([
			[10, { layerNumber: 10, source: { type: 'media', value: 'some-clip' } }],
		])
		const fadeClockRef = { start: null }
		let notified = 0
		await runSceneTakeLbgAmcpPipeline(amcp, fadeClockRef, {
			self: { log: () => {} },
			channel: 1,
			incomingGb: null,
			incomingGbEnabled: false,
			sameGbTemplateType: false,
			incomingGbLayer: 998,
			gbWillFadeIn: false,
			takeJobs: [job],
			mergeMixerExtras: [],
			currentSceneLayers: [],
			currentMap,
			shouldRunBankCrossfade: true,
			isMergeTransition: false,
			fadeDur: 25,
			fadeTw: null,
			phys: (n, bank) => (bank === 'b' ? Number(n) + 100 : Number(n)),
			activeBank: 'a',
			inactiveBank: 'b',
			exitMedia: [],
			gbWillFadeOut: false,
			currentGbLayer: 998,
			framerate: 50,
			fadeWatcher: null,
			notifyProgramTransitionStarted: () => { notified++ },
			incoming: { layers: [{ layerNumber: 10, source: { type: 'template', value: 'shaders/sh-x' } }] },
			timelineFadeInPhys: [],
		})

		const rampIdx = sent.findIndex((l) => l === 'MIXER 1-110 OPACITY 1 25')
		assert.ok(rampIdx >= 0, `incoming crossfade ramp was sent: ${JSON.stringify(sent)}`)
		const commitBeforeRamp = sent.slice(0, rampIdx).includes('MIXER 1 COMMIT')
		assert.ok(commitBeforeRamp, 'a MIXER COMMIT flushes the deferred pre-hide before the ramp starts')
		assert.ok(sent.some((l) => /^CG 1-110 ADD/.test(l)), `shader CG ADD landed on the bank-mapped layer: ${JSON.stringify(sent)}`)
		assert.ok(fadeClockRef.start != null, 'fade clock started (teardown waits for the mix window)')
		assert.equal(notified, 1, 'program-transition-started notified exactly once')
	})
})
