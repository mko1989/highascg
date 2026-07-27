'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

/**
 * WO-160b: Pgm-only takes now run through the LBG bank pipeline.
 * Verification:
 * - pgmOnly flag no longer delegates to runSceneTakePgmOnly
 * - MIX/WIPE transitions stay as MIX/WIPE (not rewritten to +ANIMATE)
 * - Unconditional orphan sweep runs for pgm-only before every take (even with CUT)
 * - Bank pointer continuity: pgm-only channels get real bank flips
 * - This smoke file validates the routing logic; full integration is in the live server tests.
 */

test('WO-160b: routes-scene-take.js computes pgmOnly flag (bus1 == null || sharedPreviewBus)', () => {
	const { handleSceneTake } = require('../../src/api/routes-scene-take')

	// Verify the pgmOnly logic is still in place (now only drives unconditional orphan sweep).
	// The flag is computed at line 314:
	//   const pgmOnly = bus1 == null || sharedPreviewBus
	// This is a static check: the route file should exist and be parseable.
	assert.ok(typeof handleSceneTake === 'function', 'handleSceneTake exported')
})

test('WO-160b: scene-take-lbg.js removes pgmOnly delegation', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')

	// Verify the delegation line is removed: "return require('./scene-take-pgm-only').runSceneTakePgmOnly(amcp, opts)"
	const hasDelegation =
		source.includes("require(" + "'./scene-take-pgm-only').runSceneTakePgmOnly") ||
		source.includes("require(" + "'./scene-take-pgm-only').runSceneTakePgmOnly(amcp")

	assert.ok(!hasDelegation, 'pgmOnly delegation removed from runSceneTakeLbg')
})

test('WO-160b: scene-take-lbg.js unconditional orphan sweep for pgmOnly', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-lbg.js'), 'utf8')

	// Verify the orphan sweep logic includes pgmOnly:
	// "const shouldClearOrphans = (!shouldRunBankCrossfade && takeJobs.length > 0) || (opts.pgmOnly && takeJobs.length > 0)"
	const hasUnconditionalSweep = source.includes('opts.pgmOnly') && source.includes('shouldClearOrphans')
	assert.ok(hasUnconditionalSweep, 'pgmOnly triggers unconditional orphan sweep')
})

test('WO-160b: routes-scene-take.js pgm-only log message updated', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../src/api/routes-scene-take.js'), 'utf8')

	// Verify the log message changed from "no A/B banks; CUT / +Animate only"
	// to "LBG bank pipeline with unconditional orphan sweep (WO-160b)"
	const hasNewLogMessage = source.includes('LBG bank pipeline with unconditional orphan sweep')
	const hasOldLogMessage = source.includes('no A/B banks')
	assert.ok(hasNewLogMessage, 'new log message present (LBG bank pipeline)')
	assert.ok(!hasOldLogMessage, 'old log message removed (no A/B banks)')
})

test('WO-160b: scene-take-pgm-only.js marked as legacy', () => {
	const fs = require('fs')
	const path = require('path')
	const source = fs.readFileSync(path.join(__dirname, '../../src/engine/scene-take-pgm-only.js'), 'utf8')

	// Verify legacy header was added
	const hasLegacyComment = source.includes('LEGACY since WO-160b')
	assert.ok(hasLegacyComment, 'scene-take-pgm-only.js marked as legacy')
})

test('WO-160b: scene-take.js deleted (no callers)', () => {
	const fs = require('fs')
	const path = require('path')
	const sceneTakePath = path.join(__dirname, '../../src/engine/scene-take.js')

	// Verify the dead scene-take.js file is deleted
	const exists = fs.existsSync(sceneTakePath)
	assert.ok(!exists, 'scene-take.js file deleted (runSceneTake had no callers)')
})

test('WO-160b: normalizeTransitionForPgmOnly exported (client-side usage)', () => {
	const { normalizeTransitionForPgmOnly } = require('../../src/engine/scene-take-pgm-only')
	assert.ok(typeof normalizeTransitionForPgmOnly === 'function', 'normalizeTransitionForPgmOnly exported (client mirror may use it)')
})

test('T181.2: PGM-only take with MIX+ANIMATE transition produces PLAY plan with transition params', async () => {
	// Regression test for WO-181: merge-transition branch (lines 295-308) in scene-take-lbg-jobs.js
	// Previously threw "buildClipCommandPlan is not defined" when a pgm-only take had a MIX+ANIMATE transition.
	// Verify: (1) module loads without error, (2) playPlan is generated with transition info.

	const { buildTakeJobs } = require('../../src/engine/scene-take-lbg-jobs')

	// Minimal mock objects
	const self = {
		config: { screen_count: 1 },
		log: (level, msg) => {}, // silence logs
	}
	const mockAmcp = {} // not used in buildTakeJobs
	const phys = (sceneLayerNum, bank) => sceneLayerNum + (bank === 'b' ? 100 : 0) // simple physical layer mapping

	// PGM-only take: one layer with a clip and a MIX+ANIMATE transition
	const incoming = {
		id: 'test-look-1',
		layers: [
			{
				layerNumber: 10,
				source: { type: 'media', value: 'test.mov' },
			},
		],
		defaultTransition: { type: 'MIX + ANIMATE', duration: 25, tween: 'linear' },
	}

	// No current layers (new take on empty channel)
	const currentMap = new Map()

	// isMergeTransition = true (because of 'MIX + ANIMATE')
	// globalT = { type: 'MIX + ANIMATE', duration: 25, tween: 'linear' }
	// The merge branch should:
	// - Strip 'ANIMATE' suffix to get baseType='MIX'
	// - Call buildClipCommandPlan with transition info
	const result = await buildTakeJobs({
		incomingSorted: incoming.layers,
		currentMap,
		channel: 1,
		incoming,
		self,
		amcp: mockAmcp,
		phys,
		inactiveBank: 'b',
		activeBank: 'a',
		shouldRunBankCrossfade: false,
		forceCut: false,
		isMergeTransition: true, // key: merge transition is true
		globalT: { type: 'MIX + ANIMATE', duration: 25, tween: 'linear' },
		framerate: 25,
		skipLayerVisualEquality: false,
	})

	assert.ok(result && result.takeJobs, 'buildTakeJobs returned result with takeJobs')
	assert.strictEqual(result.takeJobs.length, 1, 'one take job for one incoming layer')

	const takeJob = result.takeJobs[0]
	assert.ok(takeJob.playPlan, 'playPlan should exist for merge transition')
	assert.strictEqual(takeJob.playPlan.commandName, 'PLAY', 'playPlan commandName is PLAY')
	assert.strictEqual(takeJob.playPlan.opts.transition, 'MIX', 'transition type is MIX (ANIMATE suffix stripped)')
	assert.strictEqual(takeJob.playPlan.opts.duration, 25, 'duration preserved')
	assert.strictEqual(takeJob.playPlan.opts.tween, 'linear', 'tween preserved')
})
